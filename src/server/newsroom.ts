import { and, count, eq, gte, isNotNull, max } from "drizzle-orm";
import { db, schema } from "./db/client";
import type { Settings } from "./settings";
import { aiUsage, AUTOPILOT_SHARE } from "./llm";

export interface NewsroomStatus {
  state: "paused" | "starting" | "working" | "stalled" | "resting";
  headline: string;
  detail: string;
}

/**
 * What autopilot is doing for this account right now, in words a user understands, so open
 * slots read as "being worked on" rather than "waiting for you".
 */
export async function newsroomStatus(userId: string, s: Settings, opts: { beat: Date | null; now?: Date } = { beat: null }): Promise<NewsroomStatus> {
  const now = opts.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const usage = await aiUsage(userId);
  if (!s.paused && usage.used >= Math.floor(usage.cap * AUTOPILOT_SHARE)) {
    return {
      state: "resting",
      headline: "Autopilot is resting until more of today's AI allowance frees up.",
      detail: `${usage.used} of ${usage.cap} AI calls used in the last 24 hours. The rest is kept for what you ask for, so Telegram commands, "Find another story" and "Fill now" still work. Writing restarts by itself as older calls drop out of the 24-hour window.`,
    };
  }
  if (s.paused) return { state: "paused", headline: "Autopilot is paused.", detail: "Nothing new is read or written until you resume it from the sidebar." };

  const [feeds] = await db()
    .select({ n: count(), read: max(schema.sources.lastFetchedAt) })
    .from(schema.sources)
    .where(and(eq(schema.sources.userId, userId), eq(schema.sources.enabled, true)));
  const [found] = await db().select({ n: count() }).from(schema.items).where(and(eq(schema.items.userId, userId), gte(schema.items.createdAt, dayAgo)));
  const [scored] = await db()
    .select({ n: count() })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), isNotNull(schema.items.analyzedAt), gte(schema.items.analyzedAt, dayAgo)));
  const bar = Math.min(s.minRelevance, s.linkedinMinRelevance);
  const [strong] = await db()
    .select({ n: count() })
    .from(schema.items)
    .where(and(eq(schema.items.userId, userId), gte(schema.items.relevance, bar), gte(schema.items.analyzedAt, dayAgo)));
  const [held] = await db()
    .select({ n: count() })
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, userId), eq(schema.posts.status, "rejected"), gte(schema.posts.createdAt, dayAgo)));

  const nFeeds = Number(feeds.n);
  const nFound = Number(found.n);
  const nScored = Number(scored.n);
  const nStrong = Number(strong.n);
  const nHeld = Number(held.n);
  const lastRead = feeds.read ? new Date(feeds.read) : null;
  const beatFresh = !!opts.beat && now.getTime() - opts.beat.getTime() < 30 * 60_000;

  if (!beatFresh) {
    return { state: "stalled", headline: "Autopilot has not checked in recently.", detail: "Posts are not being written right now. Press Fill now to run it once; if this stays, the scheduler needs a look." };
  }
  if (!nFeeds || !lastRead) {
    return {
      state: "starting",
      headline: "Getting started: reading your news for the first time.",
      detail: "PostFlow is collecting stories from your feeds and topics. First posts usually appear within 15 to 30 minutes. You don't need to do anything.",
    };
  }
  const parts = [`Read ${nFound} new ${nFound === 1 ? "story" : "stories"} from ${nFeeds} ${nFeeds === 1 ? "source" : "sources"} in the last 24 hours`];
  if (nScored) parts.push(`${nStrong} strong enough to post`);
  if (nHeld) parts.push(`${nHeld} ${nHeld === 1 ? "draft" : "drafts"} held back by the fact-checker`);
  return {
    state: "working",
    headline: "Working on it: open slots fill by themselves.",
    detail: `${parts.join(", ")}. PostFlow checks for news every few minutes and only writes when a story is worth it, so some slots stay empty on quiet days. You don't need to do anything; add a note or press Fill now if you want posts sooner.`,
  };
}
