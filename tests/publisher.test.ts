import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { approveDraft, createDraft, markNotPublished, markPublishedManually, retryFailedPost, scheduleDraft } from "@/server/drafts/service";
import { flagStale, processScheduledPost, publishDue, reconcile } from "@/server/publishing/publisher";
import { setPlatformClientForTests } from "@/server/platforms/accounts";
import { getUserPreferences, saveUserPreferences } from "@/server/preferences";
import { FakeClient, connect, makeUser, resetDb } from "./helpers";

let x: FakeClient;
let li: FakeClient;

beforeEach(async () => {
  await resetDb();
  x = new FakeClient();
  li = new FakeClient();
  li.reconcileSupported = false;
  setPlatformClientForTests("x", x);
  setPlatformClientForTests("linkedin", li);
});

async function approvedScheduled(userId: string, platform: "x" | "linkedin", text: string, opts: { freshUntil?: Date } = {}) {
  const d = await createDraft({ userId, platform, parts: [text], author: "user", timeliness: opts.freshUntil ? "timely" : "evergreen", freshUntil: opts.freshUntil ?? null });
  await approveDraft(userId, d.id, d.currentRevisionId!);
  const { scheduledPostId } = await scheduleDraft(userId, d.id, new Date(Date.now() + 5 * 60_000));
  return { draftId: d.id, spId: scheduledPostId };
}

const later = () => new Date(Date.now() + 10 * 60_000);
const sp = (id: string) => db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, id) });
const draft = (id: string) => db().query.drafts.findFirst({ where: eq(schema.drafts.id, id) });

describe("publishing worker", () => {
  it("does not publish before the scheduled time", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "not yet");
    expect(await processScheduledPost(spId, new Date())).toBe("not_claimed");
    expect(x.calls).toHaveLength(0);
  });

  it("publishes once and stores the external id; re-running never sends twice", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId, draftId } = await approvedScheduled(u, "x", "hello");
    expect(await processScheduledPost(spId, later())).toBe("published");
    expect(await processScheduledPost(spId, later())).toBe("not_claimed");
    await publishDue(later());
    expect(x.calls).toHaveLength(1);
    expect((await sp(spId))!.externalId).toBe("ext-1");
    expect((await draft(draftId))!.status).toBe("published");
    const pubs = await db().query.publications.findMany({ where: eq(schema.publications.scheduledPostId, spId) });
    expect(pubs).toHaveLength(1);
    expect(pubs[0].status).toBe("success");
  });

  it("concurrent workers claim a post only once", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "race");
    const outcomes = await Promise.all([processScheduledPost(spId, later()), processScheduledPost(spId, later()), processScheduledPost(spId, later())]);
    expect(outcomes.filter((o) => o === "published")).toHaveLength(1);
    expect(x.calls).toHaveLength(1);
  });

  it("never publishes to a platform only approved on the other", async () => {
    const u = await makeUser();
    await connect(u, "x");
    await connect(u, "linkedin");
    await approvedScheduled(u, "linkedin", "LinkedIn only");
    await createDraft({ userId: u, platform: "x", parts: ["X version not approved"], author: "llm" });
    await publishDue(later());
    expect(li.calls).toHaveLength(1);
    expect(x.calls).toHaveLength(0);
  });

  it("paused platform holds posts without sending", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "paused one");
    const prefs = await getUserPreferences(u);
    prefs.platforms.x.paused = true;
    await saveUserPreferences(u, prefs);
    expect(await processScheduledPost(spId, later())).toBe("skipped_paused");
    expect(x.calls).toHaveLength(0);
    expect((await sp(spId))!.state).toBe("scheduled");
  });

  it("blocks content that no longer matches the approval", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "approved words");
    // Simulate tampering: approval revoked outside the normal edit flow.
    await db().update(schema.approvals).set({ revokedAt: new Date() });
    expect(await processScheduledPost(spId, later())).toBe("needs_review");
    expect(x.calls).toHaveLength(0);
  });

  it("flags stale time-sensitive posts instead of publishing them", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "breaking thing", { freshUntil: new Date(Date.now() + 60_000) });
    expect(await flagStale()).toBe(1);
    expect((await sp(spId))!.state).toBe("needs_review");
    await publishDue(later());
    expect(x.calls).toHaveLength(0);
  });

  it("fails clearly when the account is not connected (no simulated success)", async () => {
    const u = await makeUser();
    const { spId, draftId } = await approvedScheduled(u, "linkedin", "no account");
    expect(await processScheduledPost(spId, later())).toBe("failed");
    expect((await sp(spId))!.lastError).toMatch(/not connected/);
    expect((await draft(draftId))!.status).toBe("failed");
    expect(li.calls).toHaveLength(0);
  });
});

describe("failed publication recovery", () => {
  it("retries retryable failures with backoff, then succeeds", async () => {
    const u = await makeUser();
    await connect(u, "x");
    x.results.push({ kind: "failed", retryable: true, error: "rate limited", httpStatus: 429 });
    const { spId } = await approvedScheduled(u, "x", "retry me");
    expect(await processScheduledPost(spId, later())).toBe("retry_scheduled");
    const s = await sp(spId);
    expect(s!.state).toBe("scheduled");
    expect(s!.nextAttemptAt!.getTime()).toBeGreaterThan(later().getTime());
    // Not due again until the backoff passes.
    expect(await processScheduledPost(spId, later())).toBe("not_claimed");
    expect(await processScheduledPost(spId, new Date(s!.nextAttemptAt!.getTime() + 1000))).toBe("published");
    expect(x.calls).toHaveLength(2);
  });

  it("non-retryable failure stops, and a manual retry re-sends the same approved text", async () => {
    const u = await makeUser();
    await connect(u, "x");
    x.results.push({ kind: "failed", retryable: false, error: "duplicate content", httpStatus: 403 });
    const { spId, draftId } = await approvedScheduled(u, "x", "manual retry");
    expect(await processScheduledPost(spId, later())).toBe("failed");
    expect((await draft(draftId))!.status).toBe("failed");
    await retryFailedPost(u, spId, new Date());
    expect(await processScheduledPost(spId, later())).toBe("published");
    expect(x.calls.map((c) => c[0])).toEqual(["manual retry", "manual retry"]);
  });

  it("ambiguous result: reconciles as published when the post exists, without resending", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId, draftId } = await approvedScheduled(u, "x", "maybe posted");
    x.results.push({ kind: "ambiguous", error: "timeout" });
    expect(await processScheduledPost(spId, later())).toBe("unknown");
    x.existing.push({ text: "maybe posted", id: "found-1" }); // it did go out
    await reconcile(new Date(Date.now() + 5 * 60_000));
    expect((await sp(spId))!.state).toBe("published");
    expect((await sp(spId))!.externalId).toBe("found-1");
    expect((await draft(draftId))!.status).toBe("published");
    expect(x.calls).toHaveLength(1);
  });

  it("ambiguous result: retries only after confirming absence", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId } = await approvedScheduled(u, "x", "not really posted");
    x.results.push({ kind: "ambiguous", error: "502" });
    await processScheduledPost(spId, later());
    // While unknown, the worker must not resend.
    expect(await processScheduledPost(spId, later())).toBe("not_claimed");
    await reconcile(new Date(Date.now() + 5 * 60_000));
    const s = await sp(spId);
    expect(s!.state).toBe("scheduled");
    expect(await processScheduledPost(spId, new Date(s!.nextAttemptAt!.getTime() + 1000))).toBe("published");
    expect(x.calls).toHaveLength(2);
  });

  it("LinkedIn ambiguous results wait for the user to confirm", async () => {
    const u = await makeUser();
    await connect(u, "linkedin");
    const { spId, draftId } = await approvedScheduled(u, "linkedin", "li maybe");
    li.results.push({ kind: "ambiguous", error: "timeout" });
    await processScheduledPost(spId, later());
    await reconcile(new Date(Date.now() + 5 * 60_000));
    expect((await sp(spId))!.state).toBe("unknown");
    expect((await sp(spId))!.lastError).toMatch(/Check your profile/);
    await markPublishedManually(u, spId, "https://www.linkedin.com/feed/update/x");
    expect((await draft(draftId))!.status).toBe("published");
    expect(li.calls).toHaveLength(1);
  });

  it("user can confirm a post was not published, then retry", async () => {
    const u = await makeUser();
    await connect(u, "linkedin");
    const { spId } = await approvedScheduled(u, "linkedin", "li absent");
    li.results.push({ kind: "ambiguous", error: "timeout" });
    await processScheduledPost(spId, later());
    await markNotPublished(u, spId);
    await retryFailedPost(u, spId, new Date());
    expect(await processScheduledPost(spId, later())).toBe("published");
    expect(li.calls).toHaveLength(2);
  });

  it("recovers posts stuck in publishing after a crash as unknown, never as failed-and-resend", async () => {
    const u = await makeUser();
    await connect(u, "x");
    const { spId, draftId } = await approvedScheduled(u, "x", "crashed mid-send");
    // State a worker leaves behind if it dies right after claiming and sending.
    await db().update(schema.drafts).set({ status: "publishing" }).where(eq(schema.drafts.id, draftId));
    await db().update(schema.scheduledPosts).set({ state: "publishing", lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.scheduledPosts.id, spId));
    await db().insert(schema.publications).values({ scheduledPostId: spId, attemptNo: 1, platform: "x", status: "pending", startedAt: new Date(Date.now() - 60 * 60_000) });
    x.existing.push({ text: "crashed mid-send", id: "was-sent" });
    const r = await reconcile();
    expect(r.stuck).toBe(1);
    expect((await sp(spId))!.state).toBe("published");
    expect(x.calls).toHaveLength(0);
  });
});
