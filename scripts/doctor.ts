/**
 * PostFlow doctor: one command that checks every part of the system and says what to fix.
 *   npm run doctor              full check (sources polled, LLM pinged)
 *   npm run doctor -- --no-llm --no-sources     fast structural check
 *   npm run doctor -- --github  also poll the GitHub sources (costs rate limit)
 */
import { loadDotEnv } from "./load-env";
loadDotEnv();

import { execSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const checkLlm = !args.has("--no-llm");
const checkSources = !args.has("--no-sources");
const checkGithub = args.has("--github");

let failures = 0;
let warnings = 0;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function ok(label: string, detail = "") {
  console.log(`${green("✓")} ${label}${detail ? ` — ${detail}` : ""}`);
}
function warn(label: string, fix: string) {
  warnings++;
  console.log(`${yellow("!")} ${label}\n    fix: ${fix}`);
}
function fail(label: string, fix: string) {
  failures++;
  console.log(`${red("✗")} ${label}\n    fix: ${fix}`);
}
function section(name: string) {
  console.log(`\n${name}\n${"-".repeat(name.length)}`);
}

async function main() {
  console.log("PostFlow doctor\n=================");

  // --- Environment --------------------------------------------------------
  section("Environment (.env)");
  const e = process.env;
  if (!e.DATABASE_URL) fail("DATABASE_URL is not set", "copy .env.example to .env and fill it in");
  if (!e.APP_PASSWORD_HASH) fail("APP_PASSWORD_HASH is not set", "run: npm run hash-password -- 'your password'");
  if ((e.SESSION_SECRET ?? "").length < 32) warn("SESSION_SECRET looks short", "generate 32+ chars: openssl rand -base64 48");
  if ((e.TOKEN_ENCRYPTION_KEY ?? "").length < 40) warn("TOKEN_ENCRYPTION_KEY looks short", "generate 32 bytes: openssl rand -base64 32");
  if (!e.FIREWORKS_API_KEY || !e.FIREWORKS_MODEL) warn("AI is not configured (FIREWORKS_API_KEY / FIREWORKS_MODEL)", "set both in .env; discovery will collect but not analyze");
  if (!e.GITHUB_TOKEN) warn("GITHUB_TOKEN is not set", "GitHub discovery sources share a strict anonymous rate limit; create a read-only token at github.com/settings/tokens");
  if (!e.LINKEDIN_CLIENT_ID || !e.LINKEDIN_CLIENT_SECRET) warn("LinkedIn app credentials are not set", "see SETUP.md → LinkedIn (needed to publish)");
  if (!e.X_CLIENT_ID) warn("X app credentials are not set", "see SETUP.md → X (needed to publish)");
  console.log(`${green("✓")} .env loaded (${e.APP_URL ?? "APP_URL unset"})`);

  // --- Database -----------------------------------------------------------
  section("Database");
  try {
    const { db, schema, closeDb } = await import("../src/server/db/client");
    const tables = await db().execute<{ n: number }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    const n = Number(tables[0]?.n ?? 0);
    if (n < 20) fail(`Only ${n} tables exist`, "run: npm run db:migrate");
    else ok("connected and migrated", `${n} tables`);
    const owner = await db().query.users.findFirst();
    if (!owner) fail("No owner user", "run: npm run db:seed");
    else ok("owner user", owner.email);

    const srcs = await db().query.sources.findMany();
    const enabled = srcs.filter((s) => s.enabled);
    const withErrors = enabled.filter((s) => s.lastError);
    ok("sources", `${enabled.length} enabled, ${srcs.length - enabled.length} disabled`);
    for (const s of withErrors) {
      const fix = /rate limit/i.test(s.lastError ?? "")
        ? "add a GITHUB_TOKEN to .env (raises the GitHub API rate limit)"
        : "check the URL in Settings, or disable it";
      warn(`source "${s.name}" last failed: ${s.lastError}`, fix);
    }

    const awaiting = await db().query.drafts.findMany({ where: (d, { eq }) => eq(d.status, "awaiting_approval") });
    const scheduled = await db().query.scheduledPosts.findMany({ where: (p, { eq }) => eq(p.state, "scheduled") });
    ok("workload", `${awaiting.length} drafts awaiting approval, ${scheduled.length} posts scheduled`);
    for (const sp of scheduled.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()).slice(0, 3)) {
      console.log(`    • ${sp.platform}: ${sp.scheduledAt.toLocaleString()}`);
    }

    const { usageSince } = await import("../src/server/llm");
    const u = await usageSince(new Date(Date.now() - 24 * 3_600_000));
    ok("AI usage (24h)", `${u.calls} calls, ${((u.inputTokens + u.outputTokens) / 1000).toFixed(1)}k tokens${u.estCostUsd > 0 ? `, ~$${u.estCostUsd.toFixed(2)}` : ""}`);

    // --- Platform accounts ------------------------------------------------
    section("Publishing accounts");
    const accounts = await db().query.platformAccounts.findMany();
    for (const p of ["linkedin", "x"] as const) {
      const acct = accounts.find((a) => a.platform === p);
      const name = p === "x" ? "X" : "LinkedIn";
      const configured = p === "x" ? Boolean(e.X_CLIENT_ID) : Boolean(e.LINKEDIN_CLIENT_ID && e.LINKEDIN_CLIENT_SECRET);
      if (acct?.status === "connected" && acct.accessTokenEnc) ok(`${name} connected`, `${acct.handle ?? acct.displayName ?? ""}${acct.expiresAt ? `, token until ${acct.expiresAt.toLocaleDateString()}` : ""}`);
      else if (acct?.status === "error") fail(`${name} account error: ${acct.lastError ?? "unknown"}`, "open Settings and reconnect the account");
      else if (configured) warn(`${name} app configured but no account connected`, "open Settings → Connect");
      else warn(`${name} cannot publish yet`, "follow SETUP.md, then connect in Settings");
    }

    // --- LLM ping ---------------------------------------------------------
    if (checkLlm && e.FIREWORKS_API_KEY && e.FIREWORKS_MODEL) {
      section("AI model");
      try {
        const { fireworksProvider, modelFor, reasoningEffortFor } = await import("../src/server/llm");
        const model = modelFor("routine")!;
        const res = await fireworksProvider.complete({
          model,
          system: "You are a health check.",
          user: 'Reply with the JSON {"ok": true} and nothing else.',
          jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
          schemaName: "ping",
          maxTokens: 32,
          temperature: 0,
          reasoningEffort: reasoningEffortFor("routine"),
        });
        if (/"ok"\s*:\s*true/i.test(res.text)) ok("model responds", model);
        else warn(`model replied but not as expected: ${res.text.slice(0, 80)}`, "verify FIREWORKS_MODEL in .env is a current model id");
      } catch (err) {
        fail(`AI ping failed: ${(err as Error).message}`, "check FIREWORKS_API_KEY and FIREWORKS_MODEL in .env (fireworks.ai/models)");
      }
    }

    // --- Sources reachability ---------------------------------------------
    if (checkSources && enabled.length) {
      section(`Sources (polling ${enabled.filter((s) => checkGithub || s.kind !== "github_search").length} feeds${checkGithub ? "" : "; GitHub sources skipped, add --github"})`);
      const { collectSource } = await import("../src/server/discovery/collect");
      const list = enabled.filter((s) => checkGithub || s.kind !== "github_search");
      const queue = [...list];
      let good = 0;
      const bad: { name: string; error: string }[] = [];
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (queue.length) {
            const s = queue.shift()!;
            try {
              const entries = await collectSource(s);
              const newest = entries.map((x) => x.publishedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
              if (entries.length === 0) {
                warnings++;
                console.log(`${yellow("!")} ${s.name} — reachable but returned 0 items`);
              } else {
                good++;
                console.log(`${green("✓")} ${s.name} — ${entries.length} items${newest ? `, newest ${newest.toISOString().slice(0, 10)}` : ""}`);
              }
            } catch (err) {
              bad.push({ name: s.name, error: (err as Error).message.slice(0, 100) });
              console.log(`${red("✗")} ${s.name} — ${(err as Error).message.slice(0, 100)}`);
            }
          }
        }),
      );
      if (bad.length) fail(`${bad.length} source(s) failing`, "fix or disable them in Settings");
      else ok(`${good} sources healthy`);
    }

    await closeDb();
  } catch (err) {
    fail(`database check failed: ${(err as Error).message}`, "is Postgres running? try: npm run db:start");
  }

  // --- Processes ----------------------------------------------------------
  section("Processes");
  const running = (pattern: string) => {
    try {
      return execSync(`pgrep -fl '${pattern}'`, { encoding: "utf8" }).trim().length > 0;
    } catch {
      return false;
    }
  };
  if (running("worker/index.ts")) ok("worker is running", "handles discovery, scheduling and publishing");
  else fail("worker is not running", "start it with: npm run worker (or run everything with npm run desk)");
  if (running("next start") || running("next-server") || running("next dev")) ok("web app is running");
  else warn("web app is not running", "start it with: npm start (or run everything with npm run desk)");
  try {
    const res = await fetch(`${(e.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/login`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) ok("web app responds", e.APP_URL);
    else warn(`web app returned HTTP ${res.status}`, "check the web app log");
  } catch {
    warn("web app does not respond", `start it or check APP_URL (${e.APP_URL})`);
  }

  // --- Summary ------------------------------------------------------------
  console.log("\n=================");
  if (failures === 0 && warnings === 0) console.log(green("All checks passed. The desk is ready."));
  else if (failures === 0) console.log(yellow(`${warnings} warning(s) to look at — most commonly the LinkedIn/X setup in SETUP.md.`));
  else console.log(red(`${failures} problem(s) and ${warnings} warning(s). See the fix lines above.`));
  process.exit(failures ? 1 : 0);
}

await main();
