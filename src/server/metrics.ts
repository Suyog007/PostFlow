/**
 * Metrics read-back + format scorecard.
 * X: owned reads of public_metrics for recent posts ($0.001/resource).
 * LinkedIn: manual entry (analytics stay behind their reviewed API; the form is on the draft page).
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import { getCredentials, NotConnectedError } from "./platforms/accounts";
import { xFetchMetrics } from "./platforms/x";
import { log } from "./log";

const WINDOW_DAYS = 14;
const REFRESH_HOURS = 12;

export async function collectXMetrics(now = new Date()): Promise<{ checked: number; updated: number }> {
  const rows = await db()
    .select({ sp: schema.scheduledPosts, draft: schema.drafts })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .where(
      and(
        eq(schema.scheduledPosts.platform, "x"),
        eq(schema.scheduledPosts.state, "published"),
        gte(schema.scheduledPosts.publishedAt, new Date(now.getTime() - WINDOW_DAYS * 86_400_000)),
      ),
    );

  let updated = 0;
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byUser.get(r.draft.userId) ?? [];
    list.push(r);
    byUser.set(r.draft.userId, list);
  }

  for (const [userId, list] of byUser) {
    let creds;
    try {
      creds = await getCredentials(userId, "x");
    } catch (err) {
      if (!(err instanceof NotConnectedError)) log.warn("metrics_creds_failed", { error: (err as Error).message });
      continue;
    }
    for (const { sp } of list) {
      const pubs = await db().query.publications.findMany({
        where: and(eq(schema.publications.scheduledPostId, sp.id), eq(schema.publications.status, "success")),
      });
      const pub = pubs.sort((a, b) => b.attemptNo - a.attemptNo)[0];
      if (!pub) continue;
      const last = await db().query.metrics.findFirst({ where: eq(schema.metrics.publicationId, pub.id), orderBy: desc(schema.metrics.capturedAt) });
      if (last && now.getTime() - last.capturedAt.getTime() < REFRESH_HOURS * 3_600_000) continue;

      const ids = new Set<string>(pub.externalIds ?? []);
      if (sp.externalId) ids.add(sp.externalId);
      if (ids.size === 0) continue;
      try {
        const metrics = await xFetchMetrics([...ids], creds);
        let impressions = 0;
        let likes = 0;
        let reposts = 0;
        let replies = 0;
        const raw: Record<string, unknown> = {};
        for (const [id, m] of metrics) {
          impressions += m.impressions ?? 0;
          likes += m.likes ?? 0;
          reposts += (m.retweets ?? 0) + (m.quotes ?? 0);
          replies += m.replies ?? 0;
          raw[id] = m.raw;
        }
        if (metrics.size === 0) continue;
        await db().insert(schema.metrics).values({ publicationId: pub.id, impressions, likes, reposts, replies, raw });
        updated++;
      } catch (err) {
        log.warn("metrics_fetch_failed", { scheduledPostId: sp.id, error: (err as Error).message });
      }
    }
  }
  return { checked: rows.length, updated };
}

export interface ScorecardRow {
  platform: "linkedin" | "x";
  format: string;
  posts: number;
  withMetrics: number;
  avgLikes: number | null;
  avgReposts: number | null;
  avgReplies: number | null;
  avgImpressions: number | null;
  totalCostUsd: number;
}

/** Engagement by platform × engagement format. LinkedIn rows aggregate manual entries. */
export async function scorecard(userId: string, sinceDays = 90): Promise<ScorecardRow[]> {
  const rows = await db()
    .select({
      sp: schema.scheduledPosts,
      format: schema.draftRevisions.format,
      pub: schema.publications,
    })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .innerJoin(schema.draftRevisions, eq(schema.draftRevisions.id, schema.scheduledPosts.revisionId))
    .leftJoin(schema.publications, and(eq(schema.publications.scheduledPostId, schema.scheduledPosts.id), eq(schema.publications.status, "success")))
    .where(
      and(
        eq(schema.drafts.userId, userId),
        eq(schema.scheduledPosts.state, "published"),
        gte(schema.scheduledPosts.publishedAt, new Date(Date.now() - sinceDays * 86_400_000)),
      ),
    );

  const pubIds = rows.map((r) => r.pub?.id).filter(Boolean) as string[];
  const allMetrics = pubIds.length ? await db().query.metrics.findMany({ where: inArray(schema.metrics.publicationId, pubIds) }) : [];

  const groups = new Map<string, { row: ScorecardRow; likes: number[]; reposts: number[]; replies: number[]; impressions: number[] }>();
  for (const r of rows) {
    const key = `${r.sp.platform}:${r.format}`;
    const g =
      groups.get(key) ??
      {
        row: { platform: r.sp.platform, format: r.format, posts: 0, withMetrics: 0, avgLikes: null, avgReposts: null, avgReplies: null, avgImpressions: null, totalCostUsd: 0 },
        likes: [],
        reposts: [],
        replies: [],
        impressions: [],
      };
    g.row.posts += 1;
    g.row.totalCostUsd += r.pub?.costUsd ?? 0;
    const m = allMetrics
      .filter((mm) => mm.publicationId === r.pub?.id)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
    if (m) {
      g.row.withMetrics += 1;
      if (m.likes != null) g.likes.push(m.likes);
      if (m.reposts != null) g.reposts.push(m.reposts);
      if (m.replies != null) g.replies.push(m.replies);
      if (m.impressions != null) g.impressions.push(m.impressions);
    }
    groups.set(key, g);
  }
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return [...groups.values()]
    .map((g) => ({ ...g.row, totalCostUsd: Math.round(g.row.totalCostUsd * 1000) / 1000, avgLikes: avg(g.likes), avgReposts: avg(g.reposts), avgReplies: avg(g.replies), avgImpressions: avg(g.impressions) }))
    .sort((a, b) => b.posts - a.posts);
}

/** Latest metrics for one scheduled post's successful publication (draft detail page). */
export async function latestMetricsForScheduledPost(scheduledPostId: string) {
  const pubs = await db().query.publications.findMany({ where: eq(schema.publications.scheduledPostId, scheduledPostId) });
  const ids = pubs.map((p) => p.id);
  const latest = ids.length
    ? ((await db().query.metrics.findFirst({ where: inArray(schema.metrics.publicationId, ids), orderBy: desc(schema.metrics.capturedAt) })) ?? null)
    : null;
  return { latest, anySucceeded: pubs.some((p) => p.status === "success") };
}
/** Manual LinkedIn metrics entry: creates a synthetic publication when the post was confirmed by hand. */
export async function recordManualMetrics(
  userId: string,
  scheduledPostId: string,
  values: { impressions?: number; likes?: number; reposts?: number; replies?: number },
) {
  const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
  if (!sp) throw new Error("Scheduled post not found.");
  const draft = await db().query.drafts.findFirst({ where: eq(schema.drafts.id, sp.draftId) });
  if (!draft || draft.userId !== userId) throw new Error("Scheduled post not found.");
  let pub = await db().query.publications.findFirst({ where: and(eq(schema.publications.scheduledPostId, scheduledPostId), eq(schema.publications.status, "success")) });
  if (!pub) {
    const all = await db().query.publications.findMany({ where: eq(schema.publications.scheduledPostId, scheduledPostId) });
    const [created] = await db()
      .insert(schema.publications)
      .values({ scheduledPostId, attemptNo: all.length + 1, platform: sp.platform, status: "success", externalIds: sp.externalId ? [sp.externalId] : [], externalUrl: sp.externalUrl, finishedAt: new Date() })
      .returning();
    pub = created;
  }
  await db().insert(schema.metrics).values({
    publicationId: pub.id,
    impressions: values.impressions ?? null,
    likes: values.likes ?? null,
    reposts: values.reposts ?? null,
    replies: values.replies ?? null,
    raw: { source: "manual" },
  });
}
