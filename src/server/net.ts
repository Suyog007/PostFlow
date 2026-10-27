import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

const UA = "Mozilla/5.0 (compatible; PostFlowBot/0.2; +personal-use)";

/** URLs come from untrusted feeds: refuse local and private-network targets. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.includes(":")) return false;
  if (!h.includes(".")) return false;
  return true;
}

function clean(raw: string, max: number) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, max);
}

/** Fetch a public page and return its readable text, or null. Bounded and best-effort. */
export async function fetchArticleText(url: string, maxChars = 9000): Promise<string | null> {
  return (await fetchArticle(url, maxChars))?.text ?? null;
}

type Article = { title: string; text: string } | null;
let articleImpl: (url: string, maxChars: number) => Promise<Article> = realFetchArticle;
export function fetchArticle(url: string, maxChars = 9000): Promise<Article> {
  return articleImpl(url, maxChars);
}
export function setFetchArticleForTests(fn: (url: string) => Promise<Article>) {
  articleImpl = fn;
}

async function realFetchArticle(url: string, maxChars: number): Promise<Article> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    const html = (await res.text()).slice(0, 800_000);
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    const parsed = new Readability(dom.window.document).parse();
    const text = clean(parsed?.textContent ?? dom.window.document.body?.textContent ?? "", maxChars);
    const title = (parsed?.title ?? dom.window.document.title ?? "").trim().slice(0, 200);
    return text.length >= 300 ? { title: title || new URL(url).hostname, text } : null;
  } catch {
    return null;
  }
}

export function normalizeUrl(raw: string): string {
  try {
    let u = new URL(raw);
    // Bing News feed links point at a click tracker; the article's own address is in ?url=.
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.searchParams.get("url")) u = new URL(u.searchParams.get("url")!);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ref_src|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}
