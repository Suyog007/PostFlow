import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import {
  addRevision,
  approveDraft,
  cancelScheduledPost,
  createDraft,
  rejectDraft,
  reschedulePost,
  scheduleDraft,
} from "@/server/drafts/service";
import { validateParts, xWeightedLength, firstPersonActionClaim } from "@/server/drafts/state";
import { makeUser, openPrefs, resetDb } from "./helpers";

const future = (h: number) => new Date(Date.now() + h * 3_600_000);

async function newDraft(userId: string, platform: "x" | "linkedin", text: string, itemId?: string) {
  return createDraft({ userId, platform, parts: [text], author: "llm", itemId, timeliness: "evergreen" });
}

beforeEach(resetDb);

describe("approval enforcement", () => {
  it("cannot schedule without approval", async () => {
    const u = await makeUser();
    const d = await newDraft(u, "x", "hello world");
    await expect(scheduleDraft(u, d.id, future(2))).rejects.toThrow(/Approve this draft/);
  });

  it("approval binds to a revision; editing revokes it and cancels the schedule", async () => {
    const u = await makeUser();
    const d = await newDraft(u, "linkedin", "Original text");
    await approveDraft(u, d.id, d.currentRevisionId!);
    const { scheduledPostId } = await scheduleDraft(u, d.id, future(3));

    const rev2 = await addRevision(u, d.id, ["Edited text"], "user");
    const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    expect(sp!.state).toBe("cancelled");
    const draft = await db().query.drafts.findFirst({ where: eq(schema.drafts.id, d.id) });
    expect(draft!.status).toBe("awaiting_approval");
    const approvals = await db().query.approvals.findMany({ where: eq(schema.approvals.draftId, d.id) });
    expect(approvals.every((a) => a.revokedAt)).toBe(true);
    await expect(scheduleDraft(u, d.id, future(3))).rejects.toThrow();

    // Approving a stale revision id is refused.
    await expect(approveDraft(u, d.id, d.currentRevisionId!)).rejects.toThrow(/newer revision/);
    await approveDraft(u, d.id, rev2.id);
    await expect(scheduleDraft(u, d.id, future(3))).resolves.toBeTruthy();
  });

  it("rejects invalid platform content at approval", async () => {
    const u = await makeUser();
    const d = await newDraft(u, "x", "x".repeat(300));
    await expect(approveDraft(u, d.id, d.currentRevisionId!)).rejects.toThrow(/limit is 280/);
  });

  it("another user cannot approve or schedule", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const d = await newDraft(u, "x", "mine");
    await expect(approveDraft(other, d.id, d.currentRevisionId!)).rejects.toThrow(/not found/);
  });
});

describe("independent platform queues", () => {
  it("approving LinkedIn does not approve or schedule X for the same discovery", async () => {
    const u = await makeUser();
    const [item] = await db()
      .insert(schema.items)
      .values({ title: "Story", normalizedTitle: "story", canonicalUrl: "https://e.test/s", contentHash: "h" })
      .returning();
    const li = await newDraft(u, "linkedin", "LinkedIn take", item.id);
    const x = await newDraft(u, "x", "X take", item.id);
    await approveDraft(u, li.id, li.currentRevisionId!);
    await scheduleDraft(u, li.id, future(5));

    const xDraft = await db().query.drafts.findFirst({ where: eq(schema.drafts.id, x.id) });
    expect(xDraft!.status).toBe("awaiting_approval");
    expect(await db().query.approvals.findMany({ where: eq(schema.approvals.draftId, x.id) })).toHaveLength(0);
    expect(await db().query.scheduledPosts.findMany({ where: eq(schema.scheduledPosts.draftId, x.id) })).toHaveLength(0);

    // Different dates per platform.
    await approveDraft(u, x.id, x.currentRevisionId!);
    await scheduleDraft(u, x.id, future(1));
    const rows = await db().query.scheduledPosts.findMany();
    expect(new Set(rows.map((r) => r.platform))).toEqual(new Set(["linkedin", "x"]));
  });

  it("limits apply per platform", async () => {
    const u = await makeUser(openPrefs({ maxPerDay: 1, minIntervalMinutes: 0 }));
    const a = await newDraft(u, "x", "first x");
    const b = await newDraft(u, "x", "second x");
    const c = await newDraft(u, "linkedin", "linkedin one");
    for (const d of [a, b, c]) await approveDraft(u, d.id, d.currentRevisionId!);
    const when = future(2);
    await scheduleDraft(u, a.id, when);
    await expect(scheduleDraft(u, b.id, new Date(when.getTime() + 60_000))).rejects.toThrow(/Daily limit/);
    await expect(scheduleDraft(u, c.id, when)).resolves.toBeTruthy();
  });

  it("pausing one platform does not affect the other", async () => {
    const prefs = openPrefs();
    prefs.platforms.x.paused = true;
    const u = await makeUser(prefs);
    const x = await newDraft(u, "x", "x post");
    const li = await newDraft(u, "linkedin", "li post");
    for (const d of [x, li]) await approveDraft(u, d.id, d.currentRevisionId!);
    await expect(scheduleDraft(u, x.id, new Date(), { publishNow: true })).rejects.toThrow(/paused/);
    await expect(scheduleDraft(u, li.id, new Date(), { publishNow: true })).resolves.toBeTruthy();
  });
});

describe("duplicate prevention and schedule management", () => {
  it("identical text cannot be scheduled twice on the same platform", async () => {
    const u = await makeUser();
    const a = await newDraft(u, "x", "same words");
    const b = await newDraft(u, "x", "same words");
    for (const d of [a, b]) await approveDraft(u, d.id, d.currentRevisionId!);
    await scheduleDraft(u, a.id, future(2));
    await expect(scheduleDraft(u, b.id, future(4))).rejects.toThrow(/Identical text/);
  });

  it("a draft cannot hold two live schedules", async () => {
    const u = await makeUser();
    const a = await newDraft(u, "x", "only once");
    await approveDraft(u, a.id, a.currentRevisionId!);
    await scheduleDraft(u, a.id, future(2));
    await expect(scheduleDraft(u, a.id, future(4))).rejects.toThrow(/already scheduled/);
  });

  it("reschedule and cancel keep the approval", async () => {
    const u = await makeUser();
    const a = await newDraft(u, "linkedin", "reschedulable");
    await approveDraft(u, a.id, a.currentRevisionId!);
    const { scheduledPostId } = await scheduleDraft(u, a.id, future(2));
    await reschedulePost(u, scheduledPostId, future(6));
    let sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    expect(Math.abs(sp!.scheduledAt.getTime() - future(6).getTime())).toBeLessThan(5000);
    await cancelScheduledPost(u, scheduledPostId);
    sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    expect(sp!.state).toBe("cancelled");
    const d = await db().query.drafts.findFirst({ where: eq(schema.drafts.id, a.id) });
    expect(d!.status).toBe("approved");
    // Can be scheduled again.
    await expect(scheduleDraft(u, a.id, future(8))).resolves.toBeTruthy();
  });

  it("rejecting cancels pending schedules and records history", async () => {
    const u = await makeUser();
    const a = await newDraft(u, "x", "to reject");
    await approveDraft(u, a.id, a.currentRevisionId!);
    const { scheduledPostId } = await scheduleDraft(u, a.id, future(2));
    await rejectDraft(u, a.id, "changed my mind");
    const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    expect(sp!.state).toBe("cancelled");
    const events = await db().query.draftEvents.findMany({ where: eq(schema.draftEvents.draftId, a.id) });
    expect(events.map((e) => e.action)).toEqual(["created", "approved", "scheduled", "rejected"]);
  });
});

describe("platform validation", () => {
  it("counts URLs as 23 and wide characters as 2 on X", () => {
    expect(xWeightedLength("see https://example.com/a/very/long/path/that/is/long")).toBe(4 + 23);
    expect(xWeightedLength("नेपाल")).toBe(5); // Devanagari counts as 1 per code point
    expect(xWeightedLength("日本")).toBe(4);
    expect(validateParts("linkedin", ["a", "b"])).toContain("LinkedIn posts must be a single post.");
  });
});

describe("personal-experience guard", () => {
  it("flags absorbed first-person actions", () => {
    expect(firstPersonActionClaim("In my repo, a hook stops bad imports.")).toBe("my repo");
    expect(firstPersonActionClaim("I tested this on our benchmark and it worked.")).toBe("I tested");
    expect(firstPersonActionClaim("Yesterday I built a small tool to check this.")).toBe("I built");
    expect(firstPersonActionClaim("Our team shipped a rewrite of the pipeline.")).toBe("Our team");
  });

  it("keeps legitimate opinion language and attributed actions", () => {
    expect(firstPersonActionClaim("I think the interesting part is the cost curve.")).toBeNull();
    expect(firstPersonActionClaim("I'm watching whether this holds up.")).toBeNull();
    expect(firstPersonActionClaim("Geoffrey Huntley built a pre-commit hook for his repo.")).toBeNull();
    expect(firstPersonActionClaim("The team used looped transformers to raise scores.")).toBeNull();
  });
});
