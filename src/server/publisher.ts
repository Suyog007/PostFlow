import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import { entitlementFor } from "./billing/plans";
import { getSettings } from "./settings";
import { getCredentials, getPlatformClient, markAccountError, NotConnectedError } from "./platforms/accounts";
import { ReconcileNotSupported, type Platform } from "./platforms/types";
import { addEvent } from "./events";
import { notifyProblem, notifyPublished, notifyText } from "./telegram";
import { nextFreeSlot } from "./slots";
import { log } from "./log";

type PostRow = typeof schema.posts.$inferSelect;

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 10 * 60_000;
/** A non-urgent post more than this late is moved to the next free slot instead of going out at an odd hour. */
const MAX_LATE_MS = 6 * 3_600_000;

async function claimNext(now: Date, requireApproval: boolean): Promise<PostRow | null> {
  const userId = await uid();
  const nowIso = now.toISOString();
  const approved = requireApproval ? sql`and approved_at is not null` : sql``;
  const backoff = new Date(now.getTime() - RETRY_BACKOFF_MS).toISOString();
  const rows = await db().execute<PostRow & Record<string, unknown>>(sql`
    update posts set status = 'publishing', claimed_at = ${nowIso}::timestamptz, attempts = attempts + 1, updated_at = ${nowIso}::timestamptz
    where id = (
      select id from posts
      where user_id = ${userId}::uuid and status = 'scheduled' and scheduled_at <= ${nowIso}::timestamptz and (claimed_at is null or claimed_at < ${backoff}::timestamptz) ${approved}
      order by scheduled_at
      limit 1
      for update skip locked
    )
    returning *`);
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  // Raw rows come back snake_case: re-read through drizzle for typed camelCase.
  return (await db().query.posts.findFirst({ where: eq(schema.posts.id, r.id as string) })) ?? null;
}

async function nextFreeSlotFor(platform: Platform, after: Date): Promise<Date | null> {
  return nextFreeSlot(await getSettings(), platform, after);
}

async function setStatus(id: string, patch: Partial<typeof schema.posts.$inferInsert>) {
  await db().update(schema.posts).set({ ...patch, updatedAt: new Date() }).where(eq(schema.posts.id, id));
}

async function publishOne(post: PostRow, now: Date): Promise<"published" | "other"> {
  const platform = post.platform as Platform;

  if (post.expiresAt && now > post.expiresAt) {
    await setStatus(post.id, { status: "expired", error: "Went stale before it could be posted." });
    await addEvent("expired", `A time-sensitive ${platform} post went stale and was dropped.`, post.id);
    await notifyText(`⌛ A time-sensitive ${platform === "x" ? "X" : "LinkedIn"} post went stale and was not posted.`);
    return "other";
  }
  if (!post.expiresAt && now.getTime() - post.scheduledAt.getTime() > MAX_LATE_MS) {
    const next = await nextFreeSlotFor(platform, now);
    if (next) {
      await setStatus(post.id, { status: "scheduled", scheduledAt: next, claimedAt: null, attempts: 0 });
      await addEvent("moved", `A late ${platform} post was moved to its next slot.`, post.id);
      return "other";
    }
    await setStatus(post.id, { status: "expired", error: "Missed its slot and no later slot is free." });
    return "other";
  }

  let creds;
  try {
    creds = await getCredentials(platform);
  } catch (err) {
    const msg = err instanceof NotConnectedError ? err.message : `Could not load credentials: ${(err as Error).message}`;
    await setStatus(post.id, { status: "failed", error: msg });
    await notifyProblem(post, msg);
    return "other";
  }

  const result = await getPlatformClient(platform).publish([post.text], creds, {});
  if (result.kind === "success") {
    await setStatus(post.id, { status: "published", publishedAt: new Date(), externalId: result.externalIds[0] ?? null, url: result.url ?? null, error: null });
    await addEvent("published", `Posted on ${platform === "x" ? "X" : "LinkedIn"}.`, post.id);
    await notifyPublished({ ...post, url: result.url ?? null });
    return "published";
  }
  if (result.kind === "ambiguous") {
    await setStatus(post.id, { status: "unconfirmed", error: result.error });
    await addEvent("unconfirmed", `Could not confirm a ${platform} post: ${result.error}`, post.id);
    await notifyProblem(post, `${result.error} Check your profile, then mark it posted or not in the app. It will not be retried automatically.`);
    return "other";
  }
  // Definite failure
  if (result.authError) await markAccountError(platform, result.error);
  if (result.retryable && post.attempts < MAX_ATTEMPTS) {
    await setStatus(post.id, { status: "scheduled", error: result.error });
    return "other";
  }
  await setStatus(post.id, { status: "failed", error: result.error });
  await addEvent("failed", `${platform} post failed: ${result.error}`, post.id);
  await notifyProblem(post, result.error);
  return "other";
}

/** Posts everything that is due. Never runs while paused. */
export async function publishDue(opts: { now?: Date; max?: number } = {}): Promise<{ published: number; handled: number }> {
  const now = opts.now ?? new Date();
  const s = await getSettings();
  if (s.paused) return { published: 0, handled: 0 };
  // Auto mode (publishing without approval) is a paid feature; without it, approval is always required.
  const requireApproval = s.requireApproval || !(await entitlementFor(await uid())).features.autoMode;
  let published = 0;
  let handled = 0;
  for (let i = 0; i < (opts.max ?? 5); i++) {
    const post = await claimNext(now, requireApproval);
    if (!post) break;
    handled++;
    try {
      if ((await publishOne(post, now)) === "published") published++;
    } catch (err) {
      // Unknown state after an exception: do not risk a double post.
      log.error("publish_exception", { postId: post.id, error: (err as Error).message });
      await setStatus(post.id, { status: "unconfirmed", error: `Unexpected error: ${(err as Error).message}`.slice(0, 300) });
    }
  }
  return { published, handled };
}

/** Crashed publishes become "unconfirmed"; X posts that did land are found on the timeline. */
export async function reconcile(now = new Date()) {
  const userId = await uid();
  await db()
    .update(schema.posts)
    .set({ status: "unconfirmed", error: "Publisher stopped mid-attempt.", updatedAt: now })
    .where(and(eq(schema.posts.userId, userId), eq(schema.posts.status, "publishing"), lt(schema.posts.claimedAt, new Date(now.getTime() - 10 * 60_000))));

  const pending = await db().query.posts.findMany({ where: and(eq(schema.posts.userId, userId), eq(schema.posts.status, "unconfirmed"), eq(schema.posts.platform, "x")), limit: 5 });
  for (const p of pending) {
    try {
      const creds = await getCredentials("x");
      const hit = await getPlatformClient("x").findRecentPost(p.text, p.claimedAt ?? p.scheduledAt, creds);
      if (hit) {
        await setStatus(p.id, { status: "published", publishedAt: new Date(), externalId: hit.externalId, url: hit.url ?? null, error: null });
        await addEvent("reconciled", "Confirmed an X post that had been uncertain.", p.id);
      }
    } catch (err) {
      if (!(err instanceof ReconcileNotSupported)) log.warn("reconcile_failed", { postId: p.id, error: (err as Error).message });
    }
  }
}

