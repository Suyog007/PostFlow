import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema, type DB } from "../db/client";
import type { MediaRef } from "../db/schema";
import { sha256, randomToken } from "../crypto";
import { assertTransition, isEditable, normalizeParts, validateParts, type DraftStatus } from "./state";
import { checkSlot, type SlotContext, type Violation } from "../scheduling/rules";
import { getUserPreferences } from "../preferences";
import { qualityFor } from "./validator";
import { nudgeItemInterest } from "../feedback";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Platform = "linkedin" | "x";

export class DomainError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

export const LIVE_STATES = ["scheduled", "publishing", "unknown", "needs_review"] as const;

/** Hash of everything that defines "this exact post": text, engagement format, and bound images. */
export function contentHash(platform: Platform, parts: string[], extra?: { media?: MediaRef[]; format?: string }) {
  const mediaIds = (extra?.media ?? []).map((m) => m.mediaId).join(",");
  return sha256(`${platform}\n${parts.join("\n␞\n")}\n${extra?.format ?? "post"}\n${mediaIds}`);
}

async function logEvent(
  tx: Tx | DB,
  draftId: string,
  action: string,
  from: string | null,
  to: string | null,
  actor: "user" | "worker" | "system",
  details: Record<string, unknown> = {},
) {
  await tx.insert(schema.draftEvents).values({ draftId, action, fromStatus: from, toStatus: to, actor, details });
}

async function setStatus(tx: Tx, draftId: string, from: DraftStatus, to: DraftStatus) {
  assertTransition(from, to);
  const res = await tx
    .update(schema.drafts)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(schema.drafts.id, draftId), eq(schema.drafts.status, from)))
    .returning({ id: schema.drafts.id });
  if (res.length !== 1) throw new DomainError("This post was changed elsewhere. Reload and try again.");
}

async function lockDraft(tx: Tx, draftId: string, userId: string) {
  const rows = await tx.execute(sql`select id from drafts where id = ${draftId} and user_id = ${userId} for update`);
  if (rows.length === 0) throw new DomainError("Draft not found.");
  const draft = await tx.query.drafts.findFirst({ where: eq(schema.drafts.id, draftId) });
  return draft!;
}

// ---------------------------------------------------------------------------
// Creating and revising
// ---------------------------------------------------------------------------

export interface NewDraftInput {
  userId: string;
  platform: Platform;
  parts: string[];
  author: "user" | "llm";
  itemId?: string | null;
  ideaId?: string | null;
  intakeId?: string | null;
  angle?: string | null;
  instruction?: string | null;
  review?: unknown;
  timeliness?: "breaking" | "timely" | "evergreen";
  freshUntil?: Date | null;
  format?: string;
  media?: MediaRef[];
}

export async function createDraft(input: NewDraftInput) {
  const parts = normalizeParts(input.parts);
  if (parts.length === 0) throw new DomainError("The post is empty.");
  const format = input.format ?? "post";
  const media = input.media ?? [];
  const review = { ...(typeof input.review === "object" && input.review ? (input.review as Record<string, unknown>) : {}), quality: await qualityFor(input.userId, input.platform, parts) };
  return db().transaction(async (tx) => {
    const [draft] = await tx
      .insert(schema.drafts)
      .values({
        userId: input.userId,
        platform: input.platform,
        itemId: input.itemId ?? null,
        ideaId: input.ideaId ?? null,
        intakeId: input.intakeId ?? null,
        angle: input.angle ?? null,
        status: "awaiting_approval",
        timeliness: input.timeliness ?? "timely",
        freshUntil: input.freshUntil ?? null,
      })
      .returning();
    const [rev] = await tx
      .insert(schema.draftRevisions)
      .values({
        draftId: draft.id,
        revisionNo: 1,
        parts,
        format,
        media,
        contentHash: contentHash(input.platform, parts, { format, media }),
        author: input.author,
        instruction: input.instruction ?? null,
        review,
      })
      .returning();
    await tx.update(schema.drafts).set({ currentRevisionId: rev.id }).where(eq(schema.drafts.id, draft.id));
    await logEvent(tx, draft.id, "created", null, "awaiting_approval", input.author === "user" ? "user" : "system", {
      revisionNo: 1,
    });
    return { ...draft, currentRevisionId: rev.id };
  });
}

/**
 * Adds a new immutable revision. Any approval of an earlier revision is revoked and any live
 * schedule is cancelled, so the published text is always exactly the approved text.
 * `opts` carries the engagement format and bound media (both are part of the revision identity).
 */
export async function addRevision(
  userId: string,
  draftId: string,
  partsIn: string[],
  author: "user" | "llm",
  instruction?: string | null,
  review?: unknown,
  opts?: { format?: string; media?: MediaRef[] },
) {
  const parts = normalizeParts(partsIn);
  if (parts.length === 0) throw new DomainError("The post is empty.");
  const draftRow = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)) });
  if (!draftRow) throw new DomainError("Draft not found.");
  const quality = await qualityFor(userId, draftRow.platform, parts).catch(() => undefined);
  const mergedReview =
    quality || review ? { ...(typeof review === "object" && review ? (review as Record<string, unknown>) : {}), ...(quality ? { quality } : {}) } : review;
  return db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    if (!isEditable(draft.status)) throw new DomainError("Published posts cannot be edited. Create a new draft instead.");
    const current = draft.currentRevisionId
      ? await tx.query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, draft.currentRevisionId) })
      : undefined;
    const format = opts?.format ?? current?.format ?? "post";
    const media = opts?.media ?? (opts?.format ? [] : current?.media ?? []);
    const hash = contentHash(draft.platform, parts, { format, media });
    if (current && current.contentHash === hash) return current; // no-op edit

    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.draftRevisions.revisionNo}), 0)` })
      .from(schema.draftRevisions)
      .where(eq(schema.draftRevisions.draftId, draftId));
    const [rev] = await tx
      .insert(schema.draftRevisions)
      .values({ draftId, revisionNo: Number(max) + 1, parts, format, media, contentHash: hash, author, instruction: instruction ?? null, review: mergedReview ?? null })
      .returning();
    await tx.update(schema.drafts).set({ currentRevisionId: rev.id, updatedAt: new Date() }).where(eq(schema.drafts.id, draftId));

    const revoked = await tx
      .update(schema.approvals)
      .set({ revokedAt: new Date(), revokedReason: "content edited" })
      .where(and(eq(schema.approvals.draftId, draftId), isNull(schema.approvals.revokedAt)))
      .returning({ id: schema.approvals.id });
    const cancelled = await tx
      .update(schema.scheduledPosts)
      .set({ state: "cancelled", reviewReason: "content edited after approval", updatedAt: new Date() })
      .where(and(eq(schema.scheduledPosts.draftId, draftId), inArray(schema.scheduledPosts.state, ["scheduled", "needs_review"])))
      .returning({ id: schema.scheduledPosts.id });

    if (draft.status !== "awaiting_approval" && draft.status !== "draft") {
      await setStatus(tx, draftId, draft.status, "awaiting_approval");
    }
    await logEvent(tx, draftId, "revised", draft.status, "awaiting_approval", author === "user" ? "user" : "system", {
      revisionNo: rev.revisionNo,
      instruction: instruction ?? undefined,
      approvalsRevoked: revoked.length,
      schedulesCancelled: cancelled.length,
    });
    if (author === "user") {
      await tx.insert(schema.feedback).values({ userId, action: "edited", draftId, itemId: draft.itemId });
    }
    return rev;
  });
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** Approves exactly the given revision. It must be the draft's current revision. */
export async function approveDraft(userId: string, draftId: string, revisionId: string) {
  const { approval, itemId } = await db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    if (draft.currentRevisionId !== revisionId) {
      throw new DomainError("This draft has a newer revision. Review the latest text before approving.");
    }
    const rev = await tx.query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, revisionId) });
    if (!rev || rev.draftId !== draftId) throw new DomainError("Revision not found.");
    const errors = validateParts(draft.platform, rev.parts);
    if (errors.length) throw new DomainError(errors.join(" "));

    const existing = await tx.query.approvals.findFirst({
      where: and(eq(schema.approvals.revisionId, revisionId), isNull(schema.approvals.revokedAt)),
    });
    if (existing) return { approval: existing, itemId: draft.itemId };
    if (draft.status !== "draft" && draft.status !== "awaiting_approval") {
      throw new DomainError(`A ${draft.status.replace(/_/g, " ")} post cannot be approved.`);
    }

    const target: DraftStatus = "approved";
    await setStatus(tx, draftId, draft.status, target);
    const [approval] = await tx
      .insert(schema.approvals)
      .values({ draftId, revisionId, contentHash: rev.contentHash, approvedBy: userId })
      .returning();
    await logEvent(tx, draftId, "approved", draft.status, target, "user", { revisionNo: rev.revisionNo });
    await tx.insert(schema.feedback).values({ userId, action: "approved", draftId, itemId: draft.itemId });
    return { approval, itemId: draft.itemId };
  });
  // Approval-feedback ranking (best-effort, after commit).
  await nudgeItemInterest(userId, itemId, 0.04);
  return approval;
}

export async function rejectDraft(userId: string, draftId: string, reason?: string) {
  const itemId = await db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    await cancelLiveSchedules(tx, draftId, "draft rejected");
    await tx
      .update(schema.approvals)
      .set({ revokedAt: new Date(), revokedReason: "rejected" })
      .where(and(eq(schema.approvals.draftId, draftId), isNull(schema.approvals.revokedAt)));
    if (draft.status !== "rejected") {
      await setStatus(tx, draftId, draft.status, "rejected");
      await logEvent(tx, draftId, "rejected", draft.status, "rejected", "user", { reason });
      await tx.insert(schema.feedback).values({ userId, action: "rejected", draftId, itemId: draft.itemId, details: { reason } });
    }
    return draft.itemId;
  });
  await nudgeItemInterest(userId, itemId, -0.03);
}

export async function reopenDraft(userId: string, draftId: string) {
  return db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    await setStatus(tx, draftId, draft.status, "awaiting_approval");
    await logEvent(tx, draftId, "reopened", draft.status, "awaiting_approval", "user");
  });
}

async function cancelLiveSchedules(tx: Tx, draftId: string, reason: string) {
  const publishing = await tx.query.scheduledPosts.findFirst({
    where: and(eq(schema.scheduledPosts.draftId, draftId), inArray(schema.scheduledPosts.state, ["publishing", "unknown"])),
  });
  if (publishing) {
    throw new DomainError("This post is being published or its result is being confirmed. Wait for it to finish.");
  }
  await tx
    .update(schema.scheduledPosts)
    .set({ state: "cancelled", reviewReason: reason, updatedAt: new Date() })
    .where(and(eq(schema.scheduledPosts.draftId, draftId), inArray(schema.scheduledPosts.state, ["scheduled", "needs_review"])));
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Verifies there is a live approval for the draft's current revision whose hash matches. */
export async function getValidApproval(tx: Tx | DB, draftId: string) {
  const draft = await tx.query.drafts.findFirst({ where: eq(schema.drafts.id, draftId) });
  if (!draft?.currentRevisionId) return null;
  const rev = await tx.query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, draft.currentRevisionId) });
  if (!rev) return null;
  const approval = await tx.query.approvals.findFirst({
    where: and(eq(schema.approvals.revisionId, rev.id), isNull(schema.approvals.revokedAt)),
    orderBy: desc(schema.approvals.approvedAt),
  });
  if (!approval || approval.contentHash !== rev.contentHash) return null;
  return { draft, revision: rev, approval };
}

export async function platformSlotContext(
  tx: Tx | DB,
  userId: string,
  platform: Platform,
  now: Date,
  excludeDraftId?: string,
): Promise<SlotContext> {
  const prefs = await getUserPreferences(userId);
  const rows = await tx
    .select({ at: sql<Date>`coalesce(${schema.scheduledPosts.publishedAt}, ${schema.scheduledPosts.scheduledAt})` })
    .from(schema.scheduledPosts)
    .innerJoin(schema.drafts, eq(schema.drafts.id, schema.scheduledPosts.draftId))
    .where(
      and(
        eq(schema.drafts.userId, userId),
        eq(schema.scheduledPosts.platform, platform),
        inArray(schema.scheduledPosts.state, ["scheduled", "publishing", "unknown", "published"]),
        excludeDraftId ? ne(schema.scheduledPosts.draftId, excludeDraftId) : undefined,
        sql`coalesce(${schema.scheduledPosts.publishedAt}, ${schema.scheduledPosts.scheduledAt}) > ${new Date(now.getTime() - 8 * 86_400_000).toISOString()}::timestamptz`,
      ),
    );
  return {
    rules: prefs.platforms[platform],
    timezone: prefs.timezone,
    now,
    existing: rows.map((r) => new Date(r.at)),
  };
}

export interface ScheduleResult {
  scheduledPostId: string;
  warnings: Violation[];
}

/**
 * Schedule an approved revision. `publishNow` schedules for the current moment; the caller then
 * hands it to the publisher. Hard rule violations (limits, interval) block; soft ones are returned.
 */
export async function scheduleDraft(
  userId: string,
  draftId: string,
  at: Date,
  opts: { publishNow?: boolean; now?: Date } = {},
): Promise<ScheduleResult> {
  const now = opts.now ?? new Date();
  return db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    if (!["approved", "failed"].includes(draft.status)) {
      throw new DomainError(
        draft.status === "scheduled" ? "This post is already scheduled. Reschedule it instead." : "Approve this draft before scheduling it.",
      );
    }
    const valid = await getValidApproval(tx, draftId);
    if (!valid) throw new DomainError("No valid approval for the current text. Approve it first.");

    const ctx = await platformSlotContext(tx, userId, draft.platform, now, draftId);
    if (opts.publishNow && ctx.rules.paused) {
      throw new DomainError(`${draft.platform === "x" ? "X" : "LinkedIn"} publishing is paused. Resume it in Settings first.`);
    }
    const when = opts.publishNow ? now : at;
    const violations = checkSlot(when, ctx, { freshUntil: draft.freshUntil, publishNow: opts.publishNow });
    const hard = violations.filter((v) => v.hard);
    if (hard.length) throw new DomainError(hard.map((v) => v.message).join(" "), hard);

    // A published post with identical text on this platform would be a duplicate.
    const dup = await tx.query.scheduledPosts.findFirst({
      where: and(
        eq(schema.scheduledPosts.platform, draft.platform),
        eq(schema.scheduledPosts.contentHash, valid.revision.contentHash),
        inArray(schema.scheduledPosts.state, ["scheduled", "publishing", "unknown", "published"]),
      ),
    });
    if (dup) throw new DomainError("Identical text is already scheduled or published on this platform.");

    const [sp] = await tx
      .insert(schema.scheduledPosts)
      .values({
        draftId,
        revisionId: valid.revision.id,
        approvalId: valid.approval.id,
        platform: draft.platform,
        contentHash: valid.revision.contentHash,
        scheduledAt: when,
        idempotencyKey: `${valid.revision.id}:${randomToken(12)}`,
      })
      .returning();
    await setStatus(tx, draftId, draft.status, "scheduled");
    await logEvent(tx, draftId, opts.publishNow ? "publish_now" : "scheduled", draft.status, "scheduled", "user", {
      scheduledAt: when.toISOString(),
      revisionNo: valid.revision.revisionNo,
      warnings: violations.map((v) => v.message),
    });
    return { scheduledPostId: sp.id, warnings: violations };
  });
}

export async function reschedulePost(userId: string, scheduledPostId: string, at: Date, now = new Date()) {
  return db().transaction(async (tx) => {
    const sp = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!sp) throw new DomainError("Scheduled post not found.");
    const draft = await lockDraft(tx, sp.draftId, userId);
    const fresh = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!fresh || !["scheduled", "needs_review"].includes(fresh.state)) {
      throw new DomainError("Only posts that are waiting to be published can be rescheduled.");
    }
    const valid = await getValidApproval(tx, sp.draftId);
    if (!valid || valid.revision.id !== sp.revisionId) throw new DomainError("The approved text changed. Approve it again.");

    const ctx = await platformSlotContext(tx, userId, sp.platform, now, sp.draftId);
    const violations = checkSlot(at, ctx, { freshUntil: draft.freshUntil });
    const hard = violations.filter((v) => v.hard);
    if (hard.length) throw new DomainError(hard.map((v) => v.message).join(" "), hard);

    await tx
      .update(schema.scheduledPosts)
      .set({ scheduledAt: at, state: "scheduled", reviewReason: null, nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(schema.scheduledPosts.id, scheduledPostId), eq(schema.scheduledPosts.state, fresh.state)));
    if (draft.status !== "scheduled") await setStatus(tx, draft.id, draft.status, "scheduled");
    await logEvent(tx, draft.id, "rescheduled", draft.status, "scheduled", "user", {
      from: fresh.scheduledAt.toISOString(),
      to: at.toISOString(),
      warnings: violations.map((v) => v.message),
    });
    return { warnings: violations };
  });
}

/** Cancels a pending schedule. The draft stays approved, so it can be scheduled again. */
export async function cancelScheduledPost(userId: string, scheduledPostId: string) {
  return db().transaction(async (tx) => {
    const sp = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!sp) throw new DomainError("Scheduled post not found.");
    const draft = await lockDraft(tx, sp.draftId, userId);
    const res = await tx
      .update(schema.scheduledPosts)
      .set({ state: "cancelled", updatedAt: new Date() })
      .where(and(eq(schema.scheduledPosts.id, scheduledPostId), inArray(schema.scheduledPosts.state, ["scheduled", "needs_review"])))
      .returning({ id: schema.scheduledPosts.id });
    if (res.length === 0) throw new DomainError("This post is already publishing or finished and cannot be cancelled.");
    if (draft.status === "scheduled") await setStatus(tx, draft.id, "scheduled", "approved");
    await logEvent(tx, draft.id, "schedule_cancelled", draft.status, "approved", "user", { scheduledAt: sp.scheduledAt.toISOString() });
  });
}

/** Retry a failed post (or one whose result was confirmed absent) by scheduling it for `at`. */
export async function retryFailedPost(userId: string, scheduledPostId: string, at: Date) {
  return db().transaction(async (tx) => {
    const sp = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!sp) throw new DomainError("Scheduled post not found.");
    const draft = await lockDraft(tx, sp.draftId, userId);
    if (sp.state !== "failed") throw new DomainError("Only failed posts can be retried.");
    const valid = await getValidApproval(tx, sp.draftId);
    if (!valid || valid.revision.id !== sp.revisionId) throw new DomainError("The approved text changed. Approve it again.");
    await tx
      .update(schema.scheduledPosts)
      .set({ state: "scheduled", scheduledAt: at, nextAttemptAt: null, lastError: null, updatedAt: new Date() })
      .where(and(eq(schema.scheduledPosts.id, scheduledPostId), eq(schema.scheduledPosts.state, "failed")));
    await setStatus(tx, draft.id, draft.status, "scheduled");
    await logEvent(tx, draft.id, "retry_scheduled", draft.status, "scheduled", "user", { at: at.toISOString() });
  });
}

/**
 * For results we could not confirm automatically (e.g. LinkedIn): the user checked their
 * profile and confirms the post exists. Never called automatically.
 */
export async function markPublishedManually(userId: string, scheduledPostId: string, externalUrl?: string) {
  return db().transaction(async (tx) => {
    const sp = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!sp) throw new DomainError("Scheduled post not found.");
    const draft = await lockDraft(tx, sp.draftId, userId);
    if (!["unknown", "failed"].includes(sp.state)) throw new DomainError("Only unconfirmed or failed posts can be marked as published.");
    await tx
      .update(schema.scheduledPosts)
      .set({ state: "published", publishedAt: new Date(), externalUrl: externalUrl ?? null, lastError: null, updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, scheduledPostId));
    await setStatus(tx, draft.id, draft.status, "published");
    await logEvent(tx, draft.id, "marked_published", draft.status, "published", "user", { externalUrl });
  });
}

/** Confirmed absent on the platform: allow a safe retry. */
export async function markNotPublished(userId: string, scheduledPostId: string) {
  return db().transaction(async (tx) => {
    const sp = await tx.query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    if (!sp) throw new DomainError("Scheduled post not found.");
    const draft = await lockDraft(tx, sp.draftId, userId);
    if (sp.state !== "unknown") throw new DomainError("Only unconfirmed posts can be marked as not published.");
    await tx
      .update(schema.scheduledPosts)
      .set({ state: "failed", lastError: "Confirmed not published by user", updatedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, scheduledPostId));
    // The user checked the platform: unresolved attempts are now known failures, so a retry is safe.
    await tx
      .update(schema.publications)
      .set({ status: "failed", error: "Confirmed not published by user" })
      .where(and(eq(schema.publications.scheduledPostId, scheduledPostId), inArray(schema.publications.status, ["ambiguous", "pending"])));
    await setStatus(tx, draft.id, draft.status, "failed");
    await logEvent(tx, draft.id, "confirmed_not_published", draft.status, "failed", "user");
  });
}

export async function cancelDraft(userId: string, draftId: string) {
  return db().transaction(async (tx) => {
    const draft = await lockDraft(tx, draftId, userId);
    await cancelLiveSchedules(tx, draftId, "draft cancelled");
    await setStatus(tx, draftId, draft.status, "cancelled");
    await logEvent(tx, draftId, "cancelled", draft.status, "cancelled", "user");
  });
}

export { logEvent, setStatus };
export type { Tx };
