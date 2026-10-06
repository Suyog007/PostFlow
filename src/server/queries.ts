import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

export type ItemRow = typeof schema.items.$inferSelect;
export type DraftRow = typeof schema.drafts.$inferSelect;
export type RevisionRow = typeof schema.draftRevisions.$inferSelect;
export type ScheduledRow = typeof schema.scheduledPosts.$inferSelect;

export async function latestBriefing() {
  const b = await db().query.briefings.findFirst({ orderBy: desc(schema.briefings.createdAt) });
  if (!b) return null;
  const rows = await db()
    .select({ item: schema.items, rank: schema.briefingItems.rank })
    .from(schema.briefingItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.briefingItems.itemId))
    .where(eq(schema.briefingItems.briefingId, b.id))
    .orderBy(asc(schema.briefingItems.rank));
  // Hide items the user already acted on.
  const items = rows.map((r) => r.item).filter((i) => i.status !== "dismissed");
  return { briefing: b, items: await withSources(items) };
}

export async function withSources(items: ItemRow[]) {
  if (items.length === 0) return [];
  const srcs = await db().query.itemSources.findMany({ where: inArray(schema.itemSources.itemId, items.map((i) => i.id)) });
  const scores = await db()
    .selectDistinctOn([schema.scores.itemId])
    .from(schema.scores)
    .where(inArray(schema.scores.itemId, items.map((i) => i.id)))
    .orderBy(schema.scores.itemId, desc(schema.scores.createdAt));
  const draftCounts = await db()
    .select({ draftId: schema.drafts.id, itemId: schema.drafts.itemId, platform: schema.drafts.platform, status: schema.drafts.status })
    .from(schema.drafts)
    .where(inArray(schema.drafts.itemId, items.map((i) => i.id)));
  return items.map((i) => ({
    ...i,
    sources: srcs.filter((s) => s.itemId === i.id),
    scoreRow: scores.find((s) => s.itemId === i.id) ?? null,
    drafts: draftCounts.filter((d) => d.itemId === i.id),
  }));
}
export type ItemWithSources = Awaited<ReturnType<typeof withSources>>[number];

export async function discoverList(view: "latest" | "saved" | "unanalyzed" | "filtered", limit = 60) {
  const where =
    view === "saved"
      ? eq(schema.items.status, "saved")
      : view === "unanalyzed"
        ? and(eq(schema.items.status, "new"), gte(schema.items.firstSeenAt, new Date(Date.now() - 3 * 86_400_000)))
        : view === "filtered"
          ? and(eq(schema.items.status, "filtered"), gte(schema.items.firstSeenAt, new Date(Date.now() - 3 * 86_400_000)))
          : and(eq(schema.items.status, "analyzed"), gte(schema.items.firstSeenAt, new Date(Date.now() - 7 * 86_400_000)), ne(schema.items.kind, "topic"));
  const order = view === "unanalyzed" ? [desc(schema.items.prefilterScore)] : view === "latest" ? [desc(schema.items.score)] : [desc(schema.items.firstSeenAt)];
  const items = await db().query.items.findMany({ where, orderBy: order, limit });
  return withSources(items);
}

export async function topicResearchList() {
  const items = await db().query.items.findMany({ where: eq(schema.items.kind, "topic"), orderBy: desc(schema.items.firstSeenAt), limit: 20 });
  return items;
}

export async function getItemDetail(id: string) {
  const item = await db().query.items.findFirst({ where: eq(schema.items.id, id) });
  if (!item) return null;
  const [withS] = await withSources([item]);
  const claims = await db().query.claims.findMany({ where: eq(schema.claims.itemId, id), orderBy: asc(schema.claims.createdAt) });
  const evidence = claims.length
    ? await db().query.claimEvidence.findMany({ where: inArray(schema.claimEvidence.claimId, claims.map((c) => c.id)) })
    : [];
  const drafts = await db().query.drafts.findMany({ where: eq(schema.drafts.itemId, id), orderBy: desc(schema.drafts.createdAt) });
  return { item: withS, claims: claims.map((c) => ({ ...c, evidence: evidence.filter((e) => e.claimId === c.id) })), drafts };
}

export async function draftsWithCurrent(userId: string, statuses?: DraftRow["status"][]) {
  const drafts = await db().query.drafts.findMany({
    where: and(eq(schema.drafts.userId, userId), statuses ? inArray(schema.drafts.status, statuses) : undefined),
    orderBy: desc(schema.drafts.updatedAt),
    limit: 200,
  });
  if (drafts.length === 0) return [];
  const revIds = drafts.map((d) => d.currentRevisionId).filter(Boolean) as string[];
  const revs = await db().query.draftRevisions.findMany({ where: inArray(schema.draftRevisions.id, revIds) });
  const sps = await db().query.scheduledPosts.findMany({
    where: inArray(schema.scheduledPosts.draftId, drafts.map((d) => d.id)),
    orderBy: desc(schema.scheduledPosts.createdAt),
  });
  const itemIds = drafts.map((d) => d.itemId).filter(Boolean) as string[];
  const items = itemIds.length ? await db().query.items.findMany({ where: inArray(schema.items.id, itemIds), columns: { id: true, title: true, analysis: true } }) : [];
  return drafts.map((d) => ({
    ...d,
    revision: revs.find((r) => r.id === d.currentRevisionId) ?? null,
    schedule: sps.find((s) => s.draftId === d.id && s.state !== "cancelled") ?? null,
    item: items.find((i) => i.id === d.itemId) ?? null,
  }));
}
export type DraftListRow = Awaited<ReturnType<typeof draftsWithCurrent>>[number];

export async function getDraftDetail(userId: string, id: string) {
  const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, id), eq(schema.drafts.userId, userId)) });
  if (!draft) return null;
  const revisions = await db().query.draftRevisions.findMany({ where: eq(schema.draftRevisions.draftId, id), orderBy: desc(schema.draftRevisions.revisionNo) });
  const approvals = await db().query.approvals.findMany({ where: eq(schema.approvals.draftId, id), orderBy: desc(schema.approvals.approvedAt) });
  const schedules = await db().query.scheduledPosts.findMany({ where: eq(schema.scheduledPosts.draftId, id), orderBy: desc(schema.scheduledPosts.createdAt) });
  const pubs = schedules.length
    ? await db().query.publications.findMany({ where: inArray(schema.publications.scheduledPostId, schedules.map((s) => s.id)), orderBy: desc(schema.publications.startedAt) })
    : [];
  const events = await db().query.draftEvents.findMany({ where: eq(schema.draftEvents.draftId, id), orderBy: desc(schema.draftEvents.at), limit: 100 });
  const item = draft.itemId ? (await getItemDetail(draft.itemId))?.item ?? null : null;
  const idea = draft.ideaId ? await db().query.ideas.findFirst({ where: eq(schema.ideas.id, draft.ideaId) }) : null;
  const siblings = draft.itemId
    ? await db().query.drafts.findMany({ where: and(eq(schema.drafts.itemId, draft.itemId), ne(schema.drafts.id, id)), orderBy: desc(schema.drafts.createdAt) })
    : [];
  return { draft, revisions, approvals, schedules, pubs, events, item, idea, siblings };
}

export async function calendarRange(userId: string, from: Date, to: Date) {
  const rows = await db()
    .select({ sp: schema.scheduledPosts, draft: schema.drafts, rev: schema.draftRevisions })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .innerJoin(schema.draftRevisions, eq(schema.draftRevisions.id, schema.scheduledPosts.revisionId))
    .where(
      and(
        eq(schema.drafts.userId, userId),
        ne(schema.scheduledPosts.state, "cancelled"),
        gte(sql`coalesce(${schema.scheduledPosts.publishedAt}, ${schema.scheduledPosts.scheduledAt})`, sql`${from.toISOString()}::timestamptz`),
        lt(sql`coalesce(${schema.scheduledPosts.publishedAt}, ${schema.scheduledPosts.scheduledAt})`, sql`${to.toISOString()}::timestamptz`),
      ),
    )
    .orderBy(asc(schema.scheduledPosts.scheduledAt));
  return rows.map((r) => ({ ...r.sp, when: r.sp.publishedAt ?? r.sp.scheduledAt, draftStatus: r.draft.status, parts: r.rev.parts, draftId: r.draft.id }));
}
export type CalendarEntry = Awaited<ReturnType<typeof calendarRange>>[number];

export async function upcoming(userId: string, limit = 8) {
  const rows = await db()
    .select({ sp: schema.scheduledPosts, rev: schema.draftRevisions })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .innerJoin(schema.draftRevisions, eq(schema.draftRevisions.id, schema.scheduledPosts.revisionId))
    .where(and(eq(schema.drafts.userId, userId), inArray(schema.scheduledPosts.state, ["scheduled", "publishing", "needs_review", "unknown"])))
    .orderBy(asc(schema.scheduledPosts.scheduledAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.sp, parts: r.rev.parts }));
}

export async function attention(userId: string) {
  const awaiting = await draftsWithCurrent(userId, ["awaiting_approval"]);
  const problems = await db()
    .select({ sp: schema.scheduledPosts, rev: schema.draftRevisions })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .innerJoin(schema.draftRevisions, eq(schema.draftRevisions.id, schema.scheduledPosts.revisionId))
    .where(and(eq(schema.drafts.userId, userId), inArray(schema.scheduledPosts.state, ["failed", "needs_review", "unknown"]), inArray(schema.drafts.status, ["failed", "scheduled", "publishing"])))
    .orderBy(desc(schema.scheduledPosts.updatedAt));
  const soon = await db()
    .select({ sp: schema.scheduledPosts, rev: schema.draftRevisions })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .innerJoin(schema.draftRevisions, eq(schema.draftRevisions.id, schema.scheduledPosts.revisionId))
    .where(
      and(
        eq(schema.drafts.userId, userId),
        eq(schema.scheduledPosts.state, "scheduled"),
        lte(schema.scheduledPosts.scheduledAt, sql`${new Date(Date.now() + 24 * 3_600_000).toISOString()}::timestamptz`),
      ),
    )
    .orderBy(asc(schema.scheduledPosts.scheduledAt));
  const unverified = await db().query.items.findMany({
    where: and(inArray(schema.items.status, ["saved"]), sql`exists (select 1 from claims c where c.item_id = ${schema.items.id} and c.kind = 'fact' and c.verification in ('unverified','disputed'))`),
    limit: 5,
  });
  const accounts = await db().query.platformAccounts.findMany({ where: and(eq(schema.platformAccounts.userId, userId), eq(schema.platformAccounts.status, "error")) });
  return {
    awaiting,
    problems: problems.map((r) => ({ ...r.sp, parts: r.rev.parts })),
    soon: soon.map((r) => ({ ...r.sp, parts: r.rev.parts })),
    unverified,
    accountErrors: accounts,
  };
}

export async function activeJob() {
  return db().query.jobRuns.findFirst({
    where: and(eq(schema.jobRuns.kind, "discovery"), or(eq(schema.jobRuns.status, "queued"), eq(schema.jobRuns.status, "running"))),
    orderBy: desc(schema.jobRuns.queuedAt),
  });
}

export async function lastDiscoveryRun() {
  return db().query.jobRuns.findFirst({
    where: and(eq(schema.jobRuns.kind, "discovery"), inArray(schema.jobRuns.status, ["succeeded", "failed"])),
    orderBy: desc(schema.jobRuns.queuedAt),
  });
}

export async function recentJobs(limit = 15) {
  return db().query.jobRuns.findMany({ orderBy: desc(schema.jobRuns.queuedAt), limit });
}

export async function workerSeenRecently() {
  // The worker records publish/reconcile activity only when there is work, so use job claims as heartbeat.
  const j = await db().query.jobRuns.findFirst({ where: inArray(schema.jobRuns.status, ["running", "succeeded", "failed"]), orderBy: desc(schema.jobRuns.queuedAt) });
  return j?.startedAt ?? null;
}

export async function listIdeas(userId: string) {
  return db().query.ideas.findMany({ where: and(eq(schema.ideas.userId, userId), ne(schema.ideas.status, "archived")), orderBy: [asc(schema.ideas.status), desc(schema.ideas.updatedAt)] });
}

export async function evergreenSuggestion(userId: string) {
  return db().query.ideas.findFirst({
    where: and(eq(schema.ideas.userId, userId), eq(schema.ideas.status, "active")),
    orderBy: [asc(schema.ideas.usedCount), sql`${schema.ideas.lastUsedAt} asc nulls first`, asc(schema.ideas.createdAt)],
  });
}

export async function accounts(userId: string) {
  return db().query.platformAccounts.findMany({ where: eq(schema.platformAccounts.userId, userId) });
}

export async function sourcesList() {
  return db().query.sources.findMany({ orderBy: [asc(schema.sources.kind), asc(schema.sources.name)] });
}

/** Drafts waiting for a decision, grouped by the idea they came from (one card per idea). */
export async function readyQueue(userId: string) {
  const drafts = await draftsWithCurrent(userId, ["awaiting_approval", "draft"]);
  const itemIds = [...new Set(drafts.map((d) => d.itemId).filter(Boolean) as string[])];
  const srcs = itemIds.length ? await db().query.itemSources.findMany({ where: inArray(schema.itemSources.itemId, itemIds) }) : [];
  const groups = new Map<string, { key: string; itemId: string | null; title: string; why: string | null; category: string | null; source: { url: string; publisher: string | null } | null; createdAt: Date; drafts: typeof drafts }>();
  for (const d of drafts) {
    const key = d.itemId ?? d.ideaId ?? d.id;
    const a = (d.item?.analysis ?? null) as { headline?: string; whyPost?: string; whyItMatters?: string } | null;
    const g = groups.get(key) ?? {
      key,
      itemId: d.itemId,
      title: a?.headline ?? d.item?.title ?? "Your post",
      why: a?.whyPost ?? a?.whyItMatters ?? null,
      category: null,
      source: (() => {
        const s = srcs.find((x) => x.itemId === d.itemId);
        return s ? { url: s.url, publisher: s.publisher } : null;
      })(),
      createdAt: d.createdAt,
      drafts: [] as typeof drafts,
    };
    g.drafts.push(d);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, drafts: g.drafts.sort((a, b) => a.platform.localeCompare(b.platform)) }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
export type ReadyGroup = Awaited<ReturnType<typeof readyQueue>>[number];
