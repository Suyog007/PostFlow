import "server-only";
import { DateTime } from "luxon";
import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { requireActiveUser } from "@/server/auth";
import { activePlatforms, approvalGate, entitlementOf } from "@/server/billing/plans";
import { cardUrl, wantsImage } from "@/server/post-images";

export type Post = typeof schema.posts.$inferSelect;
export type DayState = "waiting" | "done" | "empty";

const LIVE = ["scheduled", "publishing", "published", "unconfirmed", "failed"] as const;

/** Everything Home and This week show: the person, their week (Monday to Sunday) and the posts waiting for them. */
export async function loadWeek(offset = 0) {
  const user = await requireActiveUser();
  const s = await getSettings();
  const tz = s.timezone;
  const approvalOn = approvalGate(s, entitlementOf(user).features.autoMode).blocks;
  const needsOk = (p: Post) => approvalOn && p.status === "scheduled" && !p.approvedAt && p.scheduledAt.getTime() > Date.now();
  const mine = eq(schema.posts.userId, user.id);

  const now = DateTime.now().setZone(tz);
  const start = now.startOf("week").plus({ weeks: offset });
  const end = start.plus({ weeks: 1 });
  const posts = await db()
    .select()
    .from(schema.posts)
    .where(and(mine, gte(schema.posts.scheduledAt, start.toJSDate()), lt(schema.posts.scheduledAt, end.toJSDate()), inArray(schema.posts.status, [...LIVE])))
    .orderBy(schema.posts.scheduledAt);
  // Waiting posts can be in next week too: Home asks about all of them, soonest first.
  const waiting = (
    await db().select().from(schema.posts).where(and(mine, eq(schema.posts.status, "scheduled"), gte(schema.posts.scheduledAt, new Date()))).orderBy(schema.posts.scheduledAt).limit(20)
  ).filter(needsOk);
  const nextUp = (
    await db().select().from(schema.posts).where(and(mine, eq(schema.posts.status, "scheduled"), gte(schema.posts.scheduledAt, new Date()))).orderBy(schema.posts.scheduledAt).limit(20)
  ).find((p) => !needsOk(p));

  const shown = [...posts, ...waiting, ...(nextUp ? [nextUp] : [])];
  const withPicture = shown.length
    ? new Set((await db().select({ id: schema.postImages.postId }).from(schema.postImages).where(inArray(schema.postImages.postId, shown.map((p) => p.id)))).map((r) => r.id))
    : new Set<string>();
  const itemIds = shown.map((p) => p.itemId).filter((x): x is string => !!x);
  const sourceRows = itemIds.length
    ? await db().select({ id: schema.items.id, name: schema.sources.name }).from(schema.items).leftJoin(schema.sources, eq(schema.items.sourceId, schema.sources.id)).where(inArray(schema.items.id, itemIds))
    : [];
  const sourceByItem = new Map(sourceRows.map((r) => [r.id, r.name]));

  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const connected = accounts.some((a) => a.status === "connected");
  const active = await activePlatforms(user.id);
  const [{ n: everPosts }] = await db().select({ n: count() }).from(schema.posts).where(mine);
  const [lastFill] = await db().select().from(schema.events).where(and(eq(schema.events.userId, user.id), inArray(schema.events.kind, ["fill", "fill_done"]))).orderBy(desc(schema.events.at)).limit(1);

  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const onDay = (d: DateTime) => posts.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hasSame(d, "day"));
  const dayState = (d: DateTime): DayState => {
    const list = onDay(d);
    if (!list.length) return "empty";
    return list.some(needsOk) ? "waiting" : "done";
  };

  return {
    user,
    s,
    tz,
    now,
    start,
    days,
    posts,
    waiting,
    nextUp,
    approvalOn,
    needsOk,
    onDay,
    dayState,
    connected,
    firstRun: Number(everPosts) === 0 && active.length > 0,
    filling: lastFill?.kind === "fill" && Date.now() - lastFill.at.getTime() < 15 * 60_000,
    name: s.profile.name || user.name || user.email,
    role: [s.profile.role, s.profile.region].filter(Boolean).join(" · "),
    thumbFor: (p: Post) => (withPicture.has(p.id) && wantsImage(p, s) ? cardUrl(p) : undefined),
    /** Where the story came from, by name: the feed's name, else the article's website. */
    sourceOf: (p: Post) => {
      const named = p.itemId ? sourceByItem.get(p.itemId) : null;
      // Found sources are saved as "JAMA Ophthalmology · Journal": show the name, and say what kind it is.
      if (named) {
        const [name, kind] = named.split(" · ");
        return { name, url: p.sourceUrl, label: kind === "Journal" ? "From the journal" : kind === "Research" ? "From the research" : kind === "Official" ? "From" : "From the news" };
      }
      if (!p.sourceUrl) return null;
      try {
        return { name: new URL(p.sourceUrl).hostname.replace(/^www\./, ""), url: p.sourceUrl, label: "From the news" };
      } catch {
        return null;
      }
    },
  };
}

export type Week = Awaited<ReturnType<typeof loadWeek>>;

/** "Today", "Tomorrow", "Friday" or "Fri 13" in a list. */
export function dayLabel(d: DateTime, now: DateTime, short = false) {
  if (d.hasSame(now, "day")) return "Today";
  if (d.hasSame(now.plus({ days: 1 }), "day")) return "Tomorrow";
  return short ? d.toFormat("ccc d") : d.toFormat("cccc");
}

/** The first sentence of a post, as a short headline for a list. */
export function headline(text: string) {
  const first = text.split(/\n+/)[0].trim();
  const sentence = first.match(/^.{20,}?[.!?](\s|$)/)?.[0].trim() ?? first;
  return sentence.length > 90 ? `${sentence.slice(0, 88).trimEnd()}…` : sentence;
}
