import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";

type PostLike = { itemId: string | null; review: unknown };
export interface StoryDate {
  /** Like "Wed 21 Oct, 14:05" in the owner's timezone. */
  when: string;
  /** Like "3 days ago". */
  ago: string;
  publisher: string | null;
}

/**
 * When the story behind a news post happened, so the owner can judge whether it is still fresh.
 * Shown in Telegram and in the app only; it is never written into the post itself.
 */
export async function storyDate(p: PostLike, tz: string, now = new Date()): Promise<StoryDate | null> {
  const mat = (p.review as { material?: { publishedAt?: string | null; publisher?: string | null } } | null)?.material;
  let at = mat?.publishedAt ? new Date(mat.publishedAt) : null;
  let publisher = mat?.publisher ?? null;
  // Posts written before the date was recorded on them: look it up from the story itself.
  if (!at && p.itemId) {
    const [row] = await db()
      .select({ at: schema.items.publishedAt, url: schema.items.url, name: schema.sources.name })
      .from(schema.items)
      .leftJoin(schema.sources, eq(schema.sources.id, schema.items.sourceId))
      .where(eq(schema.items.id, p.itemId))
      .limit(1);
    if (row) {
      at = row.at;
      publisher = publisher ?? row.name ?? new URL(row.url).hostname.replace(/^www\./, "");
    }
  }
  if (!at || isNaN(at.getTime())) return null;
  const d = DateTime.fromJSDate(at, { zone: tz });
  return { when: d.toFormat("ccc d LLL, HH:mm"), ago: d.toRelative({ base: DateTime.fromJSDate(now, { zone: tz }) }) ?? "", publisher };
}

/** One line for Telegram: "📰 Story from Wed 21 Oct, 14:05 (3 days ago) · The Register". */
export async function storyLine(p: PostLike, tz: string, now = new Date()): Promise<string> {
  const d = await storyDate(p, tz, now);
  return d ? `📰 Story from ${d.when} (${d.ago})${d.publisher ? ` · ${d.publisher}` : ""}` : "";
}
