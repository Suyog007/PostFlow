import Parser from "rss-parser";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { DEFAULT_SOURCES } from "./sources-default";
import { isPublicHttpUrl, normalizeUrl } from "./net";
import { addEvent } from "./events";

const parser = new Parser({ timeout: 15_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; PostFlowBot/0.2)" } });

/** Inserts the default feeds the first time only (never re-adds ones the owner deleted). */
export async function seedSourcesIfEmpty() {
  const [row] = await db().select({ n: sql<number>`count(*)` }).from(schema.sources);
  if (Number(row.n) > 0) return;
  await db()
    .insert(schema.sources)
    .values(DEFAULT_SOURCES.map((s) => ({ name: s.name, url: s.url, pillar: s.pillar, enabled: s.enabled ?? true })))
    .onConflictDoNothing();
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
  const stale = new Date(Date.now() - minIntervalMinutes * 60_000);
  const feeds = await db()
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.enabled, true), or(isNull(schema.sources.lastFetchedAt), lt(schema.sources.lastFetchedAt, stale))))
    .orderBy(asc(schema.sources.lastFetchedAt))
    .limit(maxFeeds);

  const result: CollectResult = { fetched: 0, inserted: 0, errors: 0 };
  const oldest = Date.now() - maxAgeDays * 86_400_000;
  for (const feed of feeds) {
    result.fetched++;
    try {
      if (!isPublicHttpUrl(feed.url)) throw new Error("Feed URL is not a public http(s) address.");
      const parsed = await parser.parseURL(feed.url);
      const rows = (parsed.items ?? [])
        .slice(0, 30)
        .map((it) => {
          const link = it.link ? normalizeUrl(it.link) : "";
          const when = it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : new Date();
          const summary = stripHtml(it.contentSnippet ?? it.content ?? it.summary ?? "").slice(0, 1200);
          return { link, title: stripHtml(it.title ?? ""), when: isNaN(when.getTime()) ? new Date() : when, summary };
        })
        .filter((r) => r.link && isPublicHttpUrl(r.link) && r.title.length > 8 && r.when.getTime() > oldest)
        .map((r) => ({ sourceId: feed.id, url: r.link, title: r.title.slice(0, 300), summary: r.summary, pillar: feed.pillar, publishedAt: r.when }));
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
  await db().delete(schema.items).where(and(lt(schema.items.publishedAt, new Date(Date.now() - 14 * 86_400_000)), inArray(schema.items.status, ["new", "skipped"])));
  return result;
}
