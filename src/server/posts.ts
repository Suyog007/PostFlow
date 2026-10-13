import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import { addEvent } from "./events";
import { runChecks } from "./checks";

export class PostError extends Error {}

async function load(id: string) {
  const p = await db().query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!p) throw new PostError("Post not found.");
  return p;
}

/** Removing is the owner's veto: it never publishes afterwards. */
export async function removePost(id: string) {
  const p = await load(id);
  if (p.status === "publishing") throw new PostError("It is being published right now.");
  if (!["scheduled", "failed", "unconfirmed", "expired"].includes(p.status)) throw new PostError(`A ${p.status} post cannot be removed.`);
  await db().update(schema.posts).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.posts.id, id));
  await addEvent("removed", `Removed a ${p.platform} post from ${p.scheduledAt.toISOString()}.`, id);
}

export async function restorePost(id: string) {
  const p = await load(id);
  if (p.status !== "cancelled" && p.status !== "failed" && p.status !== "expired") throw new PostError("Only removed or failed posts can be restored.");
  if (p.scheduledAt.getTime() < Date.now() + 60_000) throw new PostError("That time has passed. Reschedule it first.");
  if (p.expiresAt && p.expiresAt.getTime() < Date.now()) throw new PostError("This time-sensitive post has expired.");
  await db().update(schema.posts).set({ status: "scheduled", error: null, attempts: 0, claimedAt: null, updatedAt: new Date() }).where(eq(schema.posts.id, id));
}

export async function editPost(id: string, text: string) {
  const p = await load(id);
  if (!["scheduled", "failed", "cancelled"].includes(p.status)) throw new PostError(`A ${p.status} post cannot be edited.`);
  const checks = runChecks(text, p.platform as "x" | "linkedin");
  const block = checks.find((c) => c.severity === "block" && (c.code === "too_long" || c.code === "empty"));
  if (block) throw new PostError(block.message);
  await db().update(schema.posts).set({ text: text.trim(), userEdited: true, updatedAt: new Date() }).where(eq(schema.posts.id, id));
}

export async function reschedulePost(id: string, at: Date) {
  const p = await load(id);
  if (!["scheduled", "failed", "cancelled", "expired"].includes(p.status)) throw new PostError(`A ${p.status} post cannot be rescheduled.`);
  if (at.getTime() < Date.now() + 60_000) throw new PostError("Pick a time in the future.");
  if (p.expiresAt && at.getTime() > p.expiresAt.getTime()) throw new PostError("That is after this time-sensitive post goes stale.");
  const clash = await db()
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.platform, p.platform), eq(schema.posts.scheduledAt, at), inArray(schema.posts.status, ["scheduled", "publishing"])));
  if (clash.some((c) => c.id !== id)) throw new PostError("Another post already uses that exact time on this platform.");
  await db().update(schema.posts).set({ scheduledAt: at, status: "scheduled", error: null, attempts: 0, claimedAt: null, userEdited: true, updatedAt: new Date() }).where(eq(schema.posts.id, id));
}

export async function postNow(id: string) {
  const p = await load(id);
  let at = new Date(Date.now() - 1000);
  // Avoid the one-live-post-per-slot index.
  for (let i = 0; i < 20; i++) {
    const clash = await db()
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(eq(schema.posts.platform, p.platform), eq(schema.posts.scheduledAt, at), inArray(schema.posts.status, ["scheduled", "publishing"])));
    if (!clash.some((c) => c.id !== id)) break;
    at = new Date(at.getTime() - 1000);
  }
  if (!["scheduled", "failed", "cancelled"].includes(p.status)) throw new PostError(`A ${p.status} post cannot be posted now.`);
  await db().update(schema.posts).set({ scheduledAt: at, status: "scheduled", error: null, attempts: 0, claimedAt: null, updatedAt: new Date() }).where(eq(schema.posts.id, id));
}

/** The owner checked the platform and the unconfirmed post is (or is not) there. */
export async function resolveUnconfirmed(id: string, published: boolean) {
  const p = await load(id);
  if (p.status !== "unconfirmed") throw new PostError("Only unconfirmed posts can be resolved.");
  await db()
    .update(schema.posts)
    .set(published ? { status: "published", publishedAt: new Date(), updatedAt: new Date() } : { status: "failed", error: "Owner confirmed it was not posted.", updatedAt: new Date() })
    .where(eq(schema.posts.id, id));
}

export function upcoming(limit = 20) {
  return db().query.posts.findMany({
    where: and(eq(schema.posts.status, "scheduled"), gt(schema.posts.scheduledAt, new Date())),
    orderBy: schema.posts.scheduledAt,
    limit,
  });
}
