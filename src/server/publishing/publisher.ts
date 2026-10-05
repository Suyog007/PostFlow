import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { getPlatformClient, getCredentials, markAccountError, NotConnectedError } from "../platforms/accounts";
import { ReconcileNotSupported, type PublishMedia, type PublishResult } from "../platforms/types";
import { loadMediaRefs } from "../images/store";
import { getUserPreferences } from "../preferences";
import { logEvent, setStatus } from "../drafts/service";
import { nudgeItemInterest } from "../feedback";
import { log } from "../log";

const MAX_AUTO_ATTEMPTS = 4;
const STALE_LOCK_MINUTES = 10;
const RECONCILE_MIN_AGE_MS = 90_000;

export type ProcessOutcome =
  | "published"
  | "failed"
  | "retry_scheduled"
  | "unknown"
  | "needs_review"
  | "skipped_paused"
  | "not_claimed";

/**
 * Atomically claims a due post: scheduled -> publishing, and the draft -> publishing.
 * Uses row locks so two workers (or "publish now" racing the worker) never both send.
 */
async function claim(scheduledPostId: string, now: Date) {
  return db().transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select sp.id, sp.draft_id from scheduled_posts sp
      where sp.id = ${scheduledPostId} and sp.state = 'scheduled'
        and sp.scheduled_at <= ${now.toISOString()}::timestamptz
        and (sp.next_attempt_at is null or sp.next_attempt_at <= ${now.toISOString()}::timestamptz)
      for update skip locked`);
    if (locked.length === 0) return null;
    const draftId = locked[0].draft_id as string;
    await tx.execute(sql`select id from drafts where id = ${draftId} for update`);
    const draft = await tx.query.drafts.findFirst({ where: eq(schema.drafts.id, draftId) });
    if (!draft) return null;
    const [sp] = await tx
      .update(schema.scheduledPosts)
      .set({ state: "publishing", lockedAt: now, attempts: sql`${schema.scheduledPosts.attempts} + 1`, updatedAt: now })
      .where(eq(schema.scheduledPosts.id, scheduledPostId))
      .returning();
    if (draft.status !== "publishing") await setStatus(tx, draftId, draft.status, "publishing");
    return { sp, draft };
  });
}

/** Re-verify everything that makes this publication legitimate. Returns a reason when blocked. */
async function verifyAuthorization(sp: typeof schema.scheduledPosts.$inferSelect, draft: typeof schema.drafts.$inferSelect, now: Date) {
  if (draft.currentRevisionId !== sp.revisionId) return "The draft was edited after it was scheduled.";
  const approval = await db().query.approvals.findFirst({ where: eq(schema.approvals.id, sp.approvalId) });
  if (!approval || approval.revokedAt) return "The approval for this text was revoked.";
  if (approval.revisionId !== sp.revisionId) return "Approval does not match the scheduled revision.";
  const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, sp.revisionId) });
  if (!rev || rev.contentHash !== approval.contentHash || rev.contentHash !== sp.contentHash) {
    return "The text no longer matches what was approved.";
  }
  if (draft.platform !== sp.platform) return "Platform mismatch.";
  if (draft.freshUntil && now > draft.freshUntil) {
    return "This time-sensitive post is past its freshness window. Review it before publishing.";
  }
  return null;
}

async function finish(
  spId: string,
  draftId: string,
  patch: Partial<typeof schema.scheduledPosts.$inferInsert>,
  draftTo: "published" | "failed" | "scheduled" | "publishing",
  event: string,
  details: Record<string, unknown>,
) {
  await db().transaction(async (tx) => {
    await tx.update(schema.scheduledPosts).set({ ...patch, lockedAt: null, updatedAt: new Date() }).where(eq(schema.scheduledPosts.id, spId));
    const draft = await tx.query.drafts.findFirst({ where: eq(schema.drafts.id, draftId) });
    if (draft && draft.status !== draftTo) await setStatus(tx, draftId, draft.status, draftTo);
    await logEvent(tx, draftId, event, draft?.status ?? null, draftTo, "worker", details);
  });
}

/** Publish one scheduled post if it is due and claimable. Safe to call concurrently. */
export async function processScheduledPost(scheduledPostId: string, now = new Date()): Promise<ProcessOutcome> {
  const claimed = await claim(scheduledPostId, now);
  if (!claimed) return "not_claimed";
  const { sp, draft } = claimed;

  const prefs = await getUserPreferences(draft.userId);
  if (prefs.platforms[sp.platform].paused) {
    // Put it back untouched; paused platforms never publish.
    await finish(sp.id, draft.id, { state: "scheduled", attempts: sp.attempts - 1 }, "scheduled", "skipped_paused", {});
    return "skipped_paused";
  }

  // Never resend if an earlier attempt succeeded or is unresolved.
  const prior = await db().query.publications.findMany({ where: eq(schema.publications.scheduledPostId, sp.id) });
  const prevSuccess = prior.find((p) => p.status === "success");
  if (prevSuccess) {
    await finish(sp.id, draft.id, { state: "published", externalId: prevSuccess.externalIds[0], externalUrl: prevSuccess.externalUrl, publishedAt: prevSuccess.finishedAt ?? now }, "published", "published", { reconciledFrom: "prior_attempt" });
    return "published";
  }
  if (prior.some((p) => p.status === "ambiguous" || p.status === "pending")) {
    await finish(sp.id, draft.id, { state: "unknown", lastError: "A previous attempt has an unconfirmed result." }, "publishing", "needs_reconcile", {});
    return "unknown";
  }

  const blocked = await verifyAuthorization(sp, draft, now);
  if (blocked) {
    await finish(sp.id, draft.id, { state: "needs_review", reviewReason: blocked }, "scheduled", "blocked_for_review", { reason: blocked });
    return "needs_review";
  }

  let creds;
  try {
    creds = await getCredentials(draft.userId, sp.platform);
  } catch (err) {
    const msg = err instanceof NotConnectedError ? err.message : `Could not load account credentials: ${(err as Error).message}`;
    await finish(sp.id, draft.id, { state: "failed", lastError: msg }, "failed", "publish_failed", { error: msg });
    return "failed";
  }

  const rev = (await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, sp.revisionId) }))!;
  const attemptNo = prior.length + 1;
  // Load the revision's images (bound at approval time) for upload.
  const mediaRefs = rev.media ?? [];
  const media: PublishMedia[] = [];
  if (mediaRefs.length) {
    const loaded = await loadMediaRefs(draft.userId, mediaRefs);
    for (const ref of mediaRefs) {
      const hit = loaded.find((l) => l.row.id === ref.mediaId);
      if (hit) media.push({ data: hit.data, mime: hit.row.mime, alt: ref.alt || hit.row.alt });
    }
  }
  // Record the attempt BEFORE calling the API, so a crash mid-request is detectable.
  const [pub] = await db()
    .insert(schema.publications)
    .values({ scheduledPostId: sp.id, attemptNo, platform: sp.platform, status: "pending" })
    .returning();

  let result: PublishResult;
  try {
    result = await getPlatformClient(sp.platform).publish(rev.parts, creds, {
      media,
      linkInReply: sp.platform === "x" && prefs.platforms.x.linkInReply,
    });
  } catch (err) {
    result = { kind: "ambiguous", error: `Unexpected error: ${(err as Error).message}` };
  }
  log.info("publish_attempt", { scheduledPostId: sp.id, platform: sp.platform, attemptNo, result: result.kind, media: media.length });

  if (result.kind === "success") {
    await db()
      .update(schema.publications)
      .set({ status: "success", externalIds: result.externalIds, externalUrl: result.url ?? null, httpStatus: result.httpStatus ?? null, costUsd: result.costUsd ?? null, finishedAt: new Date() })
      .where(eq(schema.publications.id, pub.id));
    await finish(sp.id, draft.id, { state: "published", externalId: result.externalIds[0], externalUrl: result.url ?? null, publishedAt: new Date(), lastError: null }, "published", "published", { externalIds: result.externalIds, url: result.url });
    await afterPublished(draft);
    return "published";
  }

  if (result.kind === "ambiguous") {
    await db()
      .update(schema.publications)
      .set({ status: "ambiguous", error: result.error, httpStatus: result.httpStatus ?? null, externalIds: result.partialIds ?? [], finishedAt: new Date() })
      .where(eq(schema.publications.id, pub.id));
    await finish(sp.id, draft.id, { state: "unknown", lastError: `${result.error} Confirming whether it was posted…` }, "publishing", "publish_ambiguous", { error: result.error });
    return "unknown";
  }

  await db()
    .update(schema.publications)
    .set({ status: "failed", error: result.error, httpStatus: result.httpStatus ?? null, externalIds: result.partialIds ?? [], finishedAt: new Date() })
    .where(eq(schema.publications.id, pub.id));
  if (result.authError) await markAccountError(draft.userId, sp.platform, result.error);

  if (result.retryable && sp.attempts < MAX_AUTO_ATTEMPTS) {
    const delaySec = result.retryAfterSeconds ?? 60 * 2 ** (sp.attempts - 1);
    const next = new Date(now.getTime() + delaySec * 1000);
    await finish(sp.id, draft.id, { state: "scheduled", nextAttemptAt: next, lastError: result.error }, "scheduled", "retry_scheduled", { error: result.error, nextAttemptAt: next.toISOString() });
    return "retry_scheduled";
  }
  await finish(sp.id, draft.id, { state: "failed", lastError: result.error }, "failed", "publish_failed", { error: result.error, partialIds: result.partialIds });
  return "failed";
}

async function afterPublished(draft: typeof schema.drafts.$inferSelect) {
  await db().insert(schema.feedback).values({ userId: draft.userId, action: "published", draftId: draft.id, itemId: draft.itemId, ideaId: draft.ideaId });
  if (draft.ideaId) {
    await db()
      .update(schema.ideas)
      .set({ usedCount: sql`${schema.ideas.usedCount} + 1`, lastUsedAt: new Date(), status: "used", updatedAt: new Date() })
      .where(eq(schema.ideas.id, draft.ideaId));
  }
  // Publishing is the strongest approval signal: nudge the topic weight.
  await nudgeItemInterest(draft.userId, draft.itemId, 0.05);
}

/** Publish everything that is due. */
export async function publishDue(now = new Date()) {
  const due = await db()
    .select({ id: schema.scheduledPosts.id })
    .from(schema.scheduledPosts)
    .where(
      and(
        eq(schema.scheduledPosts.state, "scheduled"),
        lte(schema.scheduledPosts.scheduledAt, now),
        or(isNull(schema.scheduledPosts.nextAttemptAt), lte(schema.scheduledPosts.nextAttemptAt, now)),
      ),
    )
    .orderBy(schema.scheduledPosts.scheduledAt)
    .limit(20);
  const outcomes: Record<string, number> = {};
  for (const { id } of due) {
    const o = await processScheduledPost(id, now);
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }
  return outcomes;
}

/**
 * Resolve posts whose result is unknown, and recover posts stuck in "publishing" after a crash.
 * We only retry when the platform confirms the post does not exist.
 */
export async function reconcile(now = new Date()) {
  // A worker that died mid-request leaves state=publishing: treat as ambiguous.
  const stuck = await db()
    .update(schema.scheduledPosts)
    .set({ state: "unknown", lastError: "Publishing was interrupted. Confirming whether it was posted…", lockedAt: null, updatedAt: now })
    .where(and(eq(schema.scheduledPosts.state, "publishing"), lt(schema.scheduledPosts.lockedAt, new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000))))
    .returning({ id: schema.scheduledPosts.id });
  if (stuck.length) {
    await db()
      .update(schema.publications)
      .set({ status: "ambiguous", error: "Interrupted", finishedAt: now })
      .where(and(inArray(schema.publications.scheduledPostId, stuck.map((s) => s.id)), eq(schema.publications.status, "pending")));
  }

  const unknown = await db().query.scheduledPosts.findMany({ where: eq(schema.scheduledPosts.state, "unknown") });
  const results: Record<string, string> = {};
  for (const sp of unknown) {
    const draft = await db().query.drafts.findFirst({ where: eq(schema.drafts.id, sp.draftId) });
    if (!draft) continue;
    const attempts = await db().query.publications.findMany({ where: eq(schema.publications.scheduledPostId, sp.id) });
    const last = attempts.sort((a, b) => b.attemptNo - a.attemptNo)[0];
    if (last && now.getTime() - last.startedAt.getTime() < RECONCILE_MIN_AGE_MS) continue; // let the platform settle
    if (last?.externalIds?.length) {
      // Partial thread: something was definitely posted. Never auto-retry.
      await finish(sp.id, draft.id, { state: "failed", lastError: `Partially published (${last.externalIds.length} part(s)). Check the platform before doing anything else.` }, "failed", "reconciled_partial", {});
      results[sp.id] = "partial";
      continue;
    }
    const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, sp.revisionId) });
    try {
      const creds = await getCredentials(draft.userId, sp.platform);
      const found = await getPlatformClient(sp.platform).findRecentPost(rev!.parts[0], last?.startedAt ?? sp.updatedAt, creds);
      if (found) {
        if (last) {
          await db().update(schema.publications).set({ status: "success", externalIds: [found.externalId], externalUrl: found.url ?? null }).where(eq(schema.publications.id, last.id));
        }
        await finish(sp.id, draft.id, { state: "published", externalId: found.externalId, externalUrl: found.url ?? null, publishedAt: last?.startedAt ?? now, lastError: null }, "published", "reconciled_published", { externalId: found.externalId });
        await afterPublished(draft);
        results[sp.id] = "published";
      } else {
        if (last) await db().update(schema.publications).set({ status: "failed", error: `${last.error ?? ""} (confirmed not posted)` }).where(eq(schema.publications.id, last.id));
        // Confirmed absent: safe to try again, unless we have exhausted attempts.
        const retry = sp.attempts < MAX_AUTO_ATTEMPTS;
        await finish(
          sp.id,
          draft.id,
          retry ? { state: "scheduled", nextAttemptAt: new Date(now.getTime() + 60_000), lastError: "Confirmed not posted; retrying." } : { state: "failed", lastError: "Confirmed not posted after several attempts." },
          retry ? "scheduled" : "failed",
          "reconciled_absent",
          {},
        );
        results[sp.id] = retry ? "retry" : "failed";
      }
    } catch (err) {
      if (err instanceof ReconcileNotSupported) {
        // Leave as unknown with clear guidance; the user confirms manually from the UI.
        const msg = "We could not confirm whether this was posted. Check your profile, then mark it as published or not published.";
        if (sp.lastError !== msg) {
          await db().update(schema.scheduledPosts).set({ lastError: msg, updatedAt: now }).where(eq(schema.scheduledPosts.id, sp.id));
        }
        results[sp.id] = "manual";
      } else {
        results[sp.id] = `error: ${(err as Error).message}`;
      }
    }
  }
  return { stuck: stuck.length, results };
}

/** Flag time-sensitive posts that will be stale by their scheduled time. Never publishes or moves them. */
export async function flagStale(now = new Date()) {
  const rows = await db()
    .select({ sp: schema.scheduledPosts, draft: schema.drafts })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .where(and(eq(schema.scheduledPosts.state, "scheduled"), sql`${schema.drafts.freshUntil} is not null and ${schema.drafts.freshUntil} < ${schema.scheduledPosts.scheduledAt}`));
  for (const { sp, draft } of rows) {
    const reason = "This time-sensitive post will be stale by its scheduled time. Publish sooner, reschedule, or cancel.";
    await db()
      .update(schema.scheduledPosts)
      .set({ state: "needs_review", reviewReason: reason, updatedAt: now })
      .where(and(eq(schema.scheduledPosts.id, sp.id), eq(schema.scheduledPosts.state, "scheduled")));
    await logEvent(db(), draft.id, "flagged_stale", draft.status, draft.status, "system", { reason });
  }
  return rows.length;
}
