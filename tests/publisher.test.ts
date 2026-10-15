import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { publishDue } from "../src/server/publisher";
import { removePost, editPost, reschedulePost } from "../src/server/posts";
import { saveSettings } from "../src/server/settings";
import { connectAccount, fakePlatform, resetDb } from "./helpers";

const NOW = new Date("2026-10-21T04:00:00Z");

async function addPost(over: Partial<typeof schema.posts.$inferInsert> = {}) {
  const [p] = await db()
    .insert(schema.posts)
    .values({ platform: "x", pillar: "own_work", text: "Hello world, this is a post.", status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z"), ...over })
    .returning();
  return p;
}
const get = async (id: string) => (await db().query.posts.findFirst({ where: eq(schema.posts.id, id) }))!;

describe("publishDue", () => {
  beforeEach(async () => {
    await resetDb();
    await connectAccount("x");
    await connectAccount("linkedin");
  });

  it("publishes due posts exactly once", async () => {
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["123"], url: "https://x.com/i/web/status/123" }));
    const p = await addPost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect((await publishDue({ now: NOW })).published).toBe(0);
    expect(sent).toHaveLength(1);
    expect(await get(p.id)).toMatchObject({ status: "published", externalId: "123" });
  });

  it("leaves future posts alone", async () => {
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    await addPost({ scheduledAt: new Date("2026-10-21T09:00:00Z") });
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
  });

  it("never publishes a post the owner removed", async () => {
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    const p = await addPost();
    await removePost(p.id);
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
    expect((await get(p.id)).status).toBe("cancelled");
  });

  it("does nothing while paused", async () => {
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    await addPost();
    await saveSettings({ paused: true });
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
  });

  it("drops stale time-sensitive posts instead of posting late", async () => {
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    const p = await addPost({ expiresAt: new Date("2026-10-21T03:50:00Z") });
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
    expect((await get(p.id)).status).toBe("expired");
  });

  it("moves a very late evergreen post to the next free slot", async () => {
    await saveSettings({ slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }] });
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    const p = await addPost({ scheduledAt: new Date("2026-10-20T03:45:00Z") }); // 25h late
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
    const after = await get(p.id);
    expect(after.status).toBe("scheduled");
    expect(after.scheduledAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("marks ambiguous results unconfirmed and never retries them", async () => {
    const sent = fakePlatform("x", () => ({ kind: "ambiguous", error: "timeout" }));
    const p = await addPost();
    await publishDue({ now: NOW });
    await publishDue({ now: new Date(NOW.getTime() + 3_600_000) });
    expect(sent).toHaveLength(1);
    expect((await get(p.id)).status).toBe("unconfirmed");
  });

  it("retries retryable failures with backoff, then gives up", async () => {
    const sent = fakePlatform("x", () => ({ kind: "failed", retryable: true, error: "rate limited" }));
    const p = await addPost();
    await publishDue({ now: NOW });
    expect((await get(p.id)).status).toBe("scheduled");
    await publishDue({ now: new Date(NOW.getTime() + 60_000) }); // inside backoff
    expect(sent).toHaveLength(1);
    await publishDue({ now: new Date(NOW.getTime() + 11 * 60_000) });
    await publishDue({ now: new Date(NOW.getTime() + 22 * 60_000) });
    expect(sent).toHaveLength(3);
    expect((await get(p.id)).status).toBe("failed");
  });

  it("fails visibly when the account is not connected", async () => {
    await db().delete(schema.platformAccounts);
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    const p = await addPost();
    await publishDue({ now: NOW });
    expect(sent).toHaveLength(0);
    expect(await get(p.id)).toMatchObject({ status: "failed", error: "X is not connected." });
  });

  it("publishes each platform independently", async () => {
    const x = fakePlatform("x", () => ({ kind: "failed", retryable: false, error: "nope" }));
    const li = fakePlatform("linkedin", () => ({ kind: "success", externalIds: ["urn:li:share:1"] }));
    await addPost({ platform: "x" });
    await addPost({ platform: "linkedin", text: "LinkedIn version of the post, longer and with detail." });
    const r = await publishDue({ now: NOW });
    expect(r.published).toBe(1);
    expect(x).toHaveLength(1);
    expect(li).toHaveLength(1);
  });
});

describe("owner edits", () => {
  beforeEach(resetDb);

  it("marks edited posts and rejects over-long X text", async () => {
    const p = await addPost();
    await editPost(p.id, "My own wording of this post.");
    expect(await get(p.id)).toMatchObject({ userEdited: true, text: "My own wording of this post." });
    await expect(editPost(p.id, "a".repeat(300))).rejects.toThrow(/280/);
  });

  it("refuses to reschedule past a time-sensitive expiry and into a taken slot", async () => {
    const future = new Date(Date.now() + 3 * 3_600_000);
    const p = await addPost({ scheduledAt: future, expiresAt: new Date(Date.now() + 5 * 3_600_000) });
    await expect(reschedulePost(p.id, new Date(Date.now() + 9 * 3_600_000))).rejects.toThrow(/stale/);
    const other = new Date(Date.now() + 4 * 3_600_000);
    await addPost({ scheduledAt: other });
    await expect(reschedulePost(p.id, other)).rejects.toThrow(/Another post/);
  });
});
