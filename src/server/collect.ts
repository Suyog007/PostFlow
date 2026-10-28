import Parser from "rss-parser";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import { DEFAULT_SOURCES } from "./sources-default";
import { getSettings, saveSettings, type Settings } from "./settings";
import { entitlementFor } from "./billing/plans";
import { fieldOf, topicFeed } from "../lib/fields";
import type { Pillar } from "./db/schema";
import { isPublicHttpUrl, normalizeUrl } from "./net";
import { addEvent } from "./events";

const parser = new Parser({ timeout: 15_000 });

/** How many of the owner's topics get their own news search feed (outside tech). */
export const TOPIC_FEEDS = 4;

/** The starting feeds for an account's field: tech keeps the curated list; other fields get their known feeds. News on each topic is added by syncTopicFeeds. */
export function starterSources(s: Pick<Settings, "profile">): { name: string; url: string; pillar: Pillar; enabled?: boolean }[] {
  const field = fieldOf(s.profile.field);
  if (field.id === "tech") return DEFAULT_SOURCES;
  return field.feeds.map((f) => ({ ...f, pillar: "news" as const }));
}

/**
 * Adds a news search feed for each of the owner's first topics that never had one, in every field.
 * General feeds rarely cover a niche ("Solidity", "glaucoma"); without these, news never scores high
 * enough and the calendar fills with lessons only. A topic feed the owner deletes stays deleted.
 */
export async function syncTopicFeeds(): Promise<number> {
  const s = await getSettings();
  const userId = await uid();
  const done = new Set(s.topicFeedsFor.map((t) => t.toLowerCase()));
  const todo = s.profile.expertise.slice(0, TOPIC_FEEDS).filter((t) => !done.has(t.toLowerCase()));
  if (!todo.length) return 0;
  const [row] = await db().select({ n: sql<number>`count(*)` }).from(schema.sources).where(eq(schema.sources.userId, userId));
  const room = Math.max(0, (await entitlementFor(userId)).quota.feeds - Number(row.n));
  const add = todo.slice(0, room);
  if (add.length) {
    await db()
      .insert(schema.sources)
      .values(add.map((t) => ({ userId, ...topicFeed(t), name: topicFeed(t).name.slice(0, 80), pillar: "news" as const })))
      .onConflictDoNothing();
  }
  // Topics skipped for lack of room are retried when there is room again.
  await saveSettings({ topicFeedsFor: [...s.topicFeedsFor, ...add] });
  return add.length;
}

/** Inserts the starting feeds the first time only (never re-adds ones the owner deleted). */
export async function seedSourcesIfEmpty() {
  const userId = await uid();
  const [row] = await db().select({ n: sql<number>`count(*)` }).from(schema.sources).where(eq(schema.sources.userId, userId));
  if (Number(row.n) > 0) return;
  const starters = starterSources(await getSettings());
  if (!starters.length) return;
  await db()
    .insert(schema.sources)
    .values(starters.map((s) => ({ userId, name: s.name.slice(0, 80), url: s.url, pillar: s.pillar, enabled: s.enabled ?? true })))
    .onConflictDoNothing();
}

const FEED_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; PostFlowBot/0.2)", Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8" };

/**
 * Downloads a feed. fetch unpacks gzip and brotli replies, which the parser's own downloader does not
 * (Google DeepMind's feed arrived as compressed bytes and failed every time).
 */
let feedFetcher = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: FEED_HEADERS, signal: AbortSignal.timeout(15_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
  if (!isPublicHttpUrl(res.url || url)) throw new Error("Feed redirected to a non-public address.");
  return (await res.text()).slice(0, 3_000_000);
};
const fetchFeed = (url: string) => feedFetcher(url);
/** Test hook: replace the network for feeds. */
export function setFeedFetcherForTests(fn: (url: string) => Promise<string>) {
  feedFetcher = fn;
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
}

export interface CollectResult {
  fetched: number;
  inserted: number;
  errors: number;
}

/** Polls the stalest enabled feeds (bounded per run so one tick stays short). */
export async function collectFeeds(opts: { maxFeeds?: number; minIntervalMinutes?: number; maxAgeDays?: number } = {}): Promise<CollectResult> {
  const { maxFeeds = 6, minIntervalMinutes = 90, maxAgeDays = 4 } = opts;
  const userId = await uid();
  const stale = new Date(Date.now() - minIntervalMinutes * 60_000);
  const feeds = await db()
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.userId, userId), eq(schema.sources.enabled, true), or(isNull(schema.sources.lastFetchedAt), lt(schema.sources.lastFetchedAt, stale))))
    .orderBy(asc(schema.sources.lastFetchedAt))
    .limit(maxFeeds);

  const result: CollectResult = { fetched: 0, inserted: 0, errors: 0 };
  const oldest = Date.now() - maxAgeDays * 86_400_000;
  for (const feed of feeds) {
    result.fetched++;
    try {
      if (!isPublicHttpUrl(feed.url)) throw new Error("Feed URL is not a public http(s) address.");
      const parsed = await parser.parseString(await fetchFeed(feed.url));
      const rows = (parsed.items ?? [])
        .slice(0, 30)
        .map((it) => {
          const link = it.link ? normalizeUrl(it.link) : "";
          const when = it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : new Date();
          const summary = stripHtml(it.contentSnippet ?? it.content ?? it.summary ?? "").slice(0, 1200);
          return { link, title: stripHtml(it.title ?? ""), when: isNaN(when.getTime()) ? new Date() : when, summary };
        })
        .filter((r) => r.link && isPublicHttpUrl(r.link) && r.title.length > 8 && r.when.getTime() > oldest)
        .map((r) => ({ userId, sourceId: feed.id, url: r.link, title: r.title.slice(0, 300), summary: r.summary, pillar: feed.pillar, publishedAt: r.when }));
      if (rows.length) {
        const ins = await db().insert(schema.items).values(rows).onConflictDoNothing().returning({ id: schema.items.id });
        result.inserted += ins.length;
      }
      await db().update(schema.sources).set({ lastFetchedAt: new Date(), lastError: null }).where(eq(schema.sources.id, feed.id));
    } catch (err) {
      result.errors++;
      await db().update(schema.sources).set({ lastFetchedAt: new Date(), lastError: String((err as Error).message).slice(0, 200) }).where(eq(schema.sources.id, feed.id));
    }
  }
  if (result.inserted) await addEvent("collect", `Found ${result.inserted} new items from ${result.fetched} feeds.`);

  // Housekeeping: drop stale, unused items.
  await db().delete(schema.items).where(and(eq(schema.items.userId, userId), lt(schema.items.publishedAt, new Date(Date.now() - 14 * 86_400_000)), inArray(schema.items.status, ["new", "skipped"])));
  return result;
}
