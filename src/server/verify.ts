import Parser from "rss-parser";
import { and, eq, gte, ne } from "drizzle-orm";
import { storyIndex, sameStory as sameStoryInFeeds } from "./stories";
import { db, schema } from "./db/client";
import { isPublicHttpUrl } from "./net";
import { log } from "./log";

type ItemRow = typeof schema.items.$inferSelect;

export interface Mention {
  domain: string;
  title: string;
  url: string;
}

export interface Verification {
  ok: boolean;
  /** Independent publishers that reported the same story, including the original. */
  independent: number;
  needed: number;
  primary: boolean;
  risky: boolean;
  mentions: Mention[];
  reason: string;
  checkedAt: string;
}

/** Official sources announcing their own news. One of these is enough for a plain launch, but never for risky claims. */
const PRIMARY = ["openai.com", "anthropic.com", "deepmind.google", "google", "google.com", "microsoft.com", "github.blog", "github.com", "cloudflare.com", "huggingface.co", "nvidia.com", "amazon.com", "meta.com", "mistral.ai", "vercel.com", "supabase.com", "stripe.com", "ycombinator.com", "x.ai", "ollama.com"];

/** Claims that spread scams or hype: promotions, prices, money, security, law. These always need two independent sources. */
const RISKY = /\b(free|giveaway|gives? away|discount|\d+% off|price|pricing|cheaper|coupon|promo|acquir\w*|raises?|raised|funding|valuation|breach|hack\w*|vulnerab\w*|leak\w*|ban(ned|s)?|law|regulat\w*|shut(s|ting)? down|deprecat\w*|lawsuit)\b/i;

const STOP = new Set("the a an and or of to in on for with is are was were be been it its this that these those at by from as new how why what when who will can could would about after over into out up more most than then they their them you your our not but has have had says said just".split(" "));

export function registrableDomain(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {}
  host = host.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLast = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const threeLabel = tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(secondLast);
  return parts.slice(threeLabel ? -3 : -2).join(".");
}

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Same story? Enough shared significant words relative to the shorter headline. */
export function sameStory(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size < 3 || B.size < 3) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared >= 3 && shared / Math.min(A.size, B.size) >= 0.5;
}

export type NewsSearch = (query: string) => Promise<Mention[]>;

const parser = new Parser({ timeout: 15_000, customFields: { item: ["source"] } });

/** Google News RSS: free, no key, returns the same story from many publishers. The feed names the publisher but not its domain. */
export const googleNewsSearch: NewsSearch = async (query) => {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:3d`)}&hl=en-US&gl=US&ceid=US:en`;
  if (!isPublicHttpUrl(url)) return [];
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PostFlowBot/0.2)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`news search HTTP ${res.status}`);
  const feed = await parser.parseString(await res.text());
  const out: Mention[] = [];
  for (const it of feed.items ?? []) {
    const src = (it as unknown as { source?: string | { _?: string } }).source;
    const publisher = (typeof src === "object" ? src?._ : src)?.trim();
    if (!publisher || !it.title) continue;
    const title = it.title.replace(new RegExp(`\\s+-\\s+${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    out.push({ domain: publisher, title, url: it.link ?? "" });
  }
  return out;
};

/** "The Verge", "theverge.com" and "www.theverge.com" all become "theverge". */
export function publisherKey(nameOrDomain: string): string {
  const s = nameOrDomain.trim().toLowerCase();
  if (s.includes(".") && !/\s/.test(s)) return registrableDomain(s).split(".")[0];
  return s.replace(/[^a-z0-9]/g, "");
}

function samePublisher(a: string, b: string): boolean {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)));
}

let search: NewsSearch = googleNewsSearch;
export function setNewsSearchForTests(fn: NewsSearch) {
  search = fn;
}

const RECHECK_MS = 45 * 60_000;

function queryFor(title: string) {
  return title.replace(/\s+[-|–]\s+[^-|–]{2,40}$/, "").split(/\s+/).slice(0, 14).join(" ");
}

/** `matched` are reports already known to be the same story (from your own feeds), so their headlines need not match word for word. */
export function evaluate(item: Pick<ItemRow, "url" | "title" | "summary">, found: Mention[], matched: Mention[] = []): Verification {
  const origin = registrableDomain(item.url);
  const originKey = origin.split(".")[0];
  const primary = PRIMARY.some((d) => origin === d || origin.endsWith(`.${d}`));
  const risky = RISKY.test(`${item.title} ${item.summary}`);
  const others = new Map<string, Mention>();
  for (const [m, known] of [...matched.map((m) => [m, true] as const), ...found.map((m) => [m, false] as const)]) {
    const key = publisherKey(m.domain);
    if (!key || samePublisher(key, originKey) || [...others.keys()].some((k) => samePublisher(k, key)) || (!known && !sameStory(item.title, m.title))) continue;
    others.set(key, m);
  }
  const independent = 1 + others.size;
  const needed = primary && !risky ? 1 : 2;
  const ok = independent >= needed;
  const reason = ok
    ? primary && !risky
      ? `Announced by its own official source (${origin}).`
      : `Reported by ${independent} independent publishers.`
    : `Only ${independent} source${independent === 1 ? "" : "s"} so far; ${risky ? "claims about prices, offers, money or security" : "this story"} need${risky ? "" : "s"} ${needed}.`;
  return { ok, independent, needed, primary, risky, mentions: [...others.values()].slice(0, 5), reason, checkedAt: new Date().toISOString() };
}

/** Other outlets in your own feeds that ran the same story in the last few days. */
async function sameStoryInYourFeeds(item: ItemRow): Promise<Mention[]> {
  const rows = await db()
    .select({ id: schema.items.id, title: schema.items.title, url: schema.items.url, sourceId: schema.items.sourceId })
    .from(schema.items)
    .where(and(eq(schema.items.userId, item.userId), ne(schema.items.id, item.id), gte(schema.items.publishedAt, new Date(Date.now() - 4 * 86_400_000))));
  const index = storyIndex([...rows, { id: item.id, title: item.title, sourceId: item.sourceId }]);
  const origin = registrableDomain(item.url);
  return rows
    .filter((r) => registrableDomain(r.url) !== origin && sameStoryInFeeds(index, item.title, r.title))
    .map((r) => ({ domain: registrableDomain(r.url), title: r.title, url: r.url }));
}

/** Checks (and caches on the item) whether enough independent publishers carry this story. Fails closed. */
export async function ensureVerification(item: ItemRow): Promise<Verification> {
  const cached = item.verification as unknown as Verification | null;
  if (cached && item.verifiedAt && (cached.ok || Date.now() - item.verifiedAt.getTime() < RECHECK_MS)) return cached;
  const fromFeeds = await sameStoryInYourFeeds(item);
  let v: Verification;
  try {
    v = evaluate(item, await search(queryFor(item.title)), fromFeeds);
  } catch (err) {
    log.warn("verify_failed", { itemId: item.id, error: (err as Error).message });
    v = evaluate(item, [], fromFeeds);
    if (!v.ok) v = { ...v, reason: "Could not reach the news search to cross-check this story." };
  }
  await db().update(schema.items).set({ verification: v as unknown as Record<string, unknown>, verifiedAt: new Date() }).where(eq(schema.items.id, item.id));
  item.verification = v as unknown as Record<string, unknown>;
  item.verifiedAt = new Date();
  return v;
}

/** Cross-check a story that is not stored as an item (a link you handed over). Informational: it never blocks a post you asked for. */
export async function checkStory(item: { url: string; title: string; summary?: string }): Promise<Verification> {
  try {
    return evaluate({ url: item.url, title: item.title, summary: item.summary ?? "" }, await search(queryFor(item.title)));
  } catch {
    return { ...evaluate({ url: item.url, title: item.title, summary: item.summary ?? "" }, []), reason: "Could not reach the news search to cross-check this story." };
  }
}
