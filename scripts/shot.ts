/**
 * Screenshots pages of the locally running app for UI review.
 *
 *   npm run shot -- [--out ./shots] [--base http://localhost:3000] [paths...]
 *
 * Signs a session cookie with SESSION_SECRET (same as the web app), launches a
 * headless Chromium (Brave/Chrome) with remote debugging, and captures full-page PNGs.
 * Default paths: login, home, discover, one draft, drafts, intake, calendar, scorecard, settings.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { loadDotEnv } from "./load-env";
import { sqlClient } from "../src/server/db/client";

loadDotEnv();

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const outDir = path.resolve(argValue("--out") ?? "shots");
const base = (argValue("--base") ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--base");

const CHROMES = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const chromeBin = CHROMES.find((p) => fs.existsSync(p));
if (!chromeBin) {
  console.error("No Chromium-based browser found in /Applications.");
  process.exit(1);
}

// --- session cookie ---------------------------------------------------------

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  console.error("SESSION_SECRET missing from .env.");
  process.exit(1);
}
const sql = sqlClient();
const [owner] = await sql<{ id: string }[]>`select id from users order by created_at asc limit 1`;
if (!owner) {
  console.error("No user row yet — run the app once or npm run db:seed.");
  process.exit(1);
}
const token = await new SignJWT({ sub: owner.id })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));

// --- default pages ----------------------------------------------------------

let targets = paths;
if (targets.length === 0) {
  const [draft] = await sql<{ id: string }[]>`select id from drafts order by updated_at desc limit 1`;
  const [item] = await sql<{ id: string }[]>`select id from items order by first_seen_at desc limit 1`;
  targets = [
    "/login",
    "/",
    "/discover",
    ...(item ? [`/discover/${item.id}`] : []),
    "/drafts",
    ...(draft ? [`/drafts/${draft.id}`] : []),
    "/intake",
    "/calendar",
    "/scorecard",
    "/settings",
  ];
}

// --- headless browser over CDP ----------------------------------------------

const port = 9317;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "postflow-shot-"));
const child = spawn(chromeBin, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

async function waitForDevTools(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Browser did not start.");
}

interface CdpResult {
  [k: string]: unknown;
}
function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  const loaded: (() => void)[] = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; method?: string; result?: unknown; error?: { message: string } };
    if (m.method === "Page.loadEventFired") loaded.splice(0).forEach((r) => r());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  };
  const ready = new Promise<void>((res) => (ws.onopen = () => res()));
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const waitLoaded = (ms: number) => Promise.race([new Promise<void>((r) => loaded.push(r)), new Promise<void>((r) => setTimeout(r, ms))]);
  return { ready, send, waitLoaded, close: () => ws.close() };
}

const wsUrl = await waitForDevTools();
const c = cdp(wsUrl);
await c.ready;
await c.send("Page.enable");
await c.send("Network.enable");
const { hostname } = new URL(base);
await c.send("Network.setCookie", { name: "sd_session", value: token, domain: hostname, path: "/", httpOnly: true, sameSite: "Lax" });
const dark = args.includes("--dark");
if (dark) await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

fs.mkdirSync(outDir, { recursive: true });

async function shot(urlPath: string, name: string, width: number, height: number) {
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await c.send("Page.navigate", { url: `${base}${urlPath}` });
  await c.waitLoaded(15_000);
  await new Promise((r) => setTimeout(r, 1_800)); // hydration + data
  const { result } = (await c.send("Runtime.evaluate", { expression: "Math.min(document.body.scrollHeight + 40, 3000)", returnByValue: true })) as { result: { value: number } };
  const full = Math.max(height, Math.round(result.value));
  await c.send("Emulation.setDeviceMetricsOverride", { width, height: full, deviceScaleFactor: 1, mobile: width < 500 });
  await new Promise((r) => setTimeout(r, 400));
  const png = (await c.send("Page.captureScreenshot", { format: "png" })) as CdpResult;
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data as string, "base64"));
  console.log(`${urlPath.padEnd(46)} ${width}x${full}  →  ${file}`);
}

for (const p of targets) {
  const name = (p === "/" ? "home" : p.replace(/^\//, "").replace(/[/?=&]/g, "-")) + (dark ? "-dark" : "");
  await shot(p, name, 1440, 1000);
}
// One narrow viewport to check the mobile layout.
await shot("/", "home-mobile", 390, 844);

c.close();
child.kill();
await sql.end({ timeout: 3 });
console.log("\nDone.");
