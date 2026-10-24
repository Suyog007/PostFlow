import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { publishDue } from "../src/server/publisher";
import { removePost, editPost, reschedulePost } from "../src/server/posts";
import { saveSettings } from "../src/server/settings";
import { connectAccount, fakePlatform, resetDb, me } from "./helpers";

const NOW = new Date("2026-10-21T04:00:00Z");

async function addPost(over: Partial<typeof schema.posts.$inferInsert> = {}) {
  const [p] = await db()
    .insert(schema.posts)
    .values({ userId: me(), platform: "x", pillar: "own_work", text: "Hello world, this is a post.", status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z"), ...over })
    .returning();
  return p;
}
const get = async (id: string) => (await db().query.posts.findFirst({ where: eq(schema.posts.id, id) }))!;

describe("publishDue", () => {
  beforeEach(async () => {
    await resetDb();
    await connectAccount("x");
    await connectAccount("linkedin");
    // These tests cover publishing mechanics, so run in auto mode (no approval step).
    await saveSettings({ requireApproval: false });
  });

  it("an unapproved post is skipped once its time passes, and an approved one still goes out", async () => {
    await saveSettings({ requireApproval: true });
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["9"] }));
    const unapproved = await addPost();
    const approved = await addPost({ scheduledAt: new Date("2026-10-21T03:44:00Z"), approvedAt: new Date("2026-10-21T02:00:00Z") });
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(sent).toHaveLength(1);
    expect(await get(approved.id)).toMatchObject({ status: "published" });
    expect(await get(unapproved.id)).toMatchObject({ status: "expired", error: "Not approved before its time, so it was skipped." });
    // Approving it afterwards does not make it publish late: its time has passed.
    await db().update(schema.posts).set({ approvedAt: NOW }).where(eq(schema.posts.id, unapproved.id));
    expect((await publishDue({ now: NOW })).published).toBe(0);
    // And autopilot does not write another post for that slot.
    expect((await db().select().from(schema.events)).some((e) => e.kind === "skipped")).toBe(true);
  });

  it("a future unapproved post is left alone until its time", async () => {
    await saveSettings({ requireApproval: true });
    fakePlatform("x", () => ({ kind: "success", externalIds: ["9"] }));
    const later = await addPost({ scheduledAt: new Date("2026-10-21T09:00:00Z") });
    await publishDue({ now: NOW });
    expect((await get(later.id)).status).toBe("scheduled");
  });

  it("auto mode publishes without approval, as before", async () => {
    await saveSettings({ requireApproval: false });
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["9"] }));
    await addPost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a platform that is not connected is skipped quietly: one notice a day, the rest carries on", async () => {
    await db().delete(schema.platformAccounts);
    const _db = db;
    const [a, b] = [await addPost(), await addPost({ scheduledAt: new Date("2026-10-21T03:44:00Z") })];
    await publishDue({ now: NOW });
    expect((await get(a.id)).status).toBe("failed");
    expect((await get(b.id)).status).toBe("failed");
    const notices = (await _db().select().from(schema.events)).filter((e) => e.kind === "not_connected_x");
    expect(notices).toHaveLength(1);
  });

  describe("heads-up before posting", () => {
    async function withTelegram<T>(fn: (sent: { text: string; buttons?: { text: string }[][] }[]) => Promise<T>) {
      process.env.TELEGRAM_BOT_TOKEN = "123:test";
      const { resetEnvCache } = await import("../src/server/env");
      resetEnvCache();
      const sent: { text: string; buttons?: { text: string }[][] }[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
        const b = JSON.parse(init?.body ?? "{}");
        if (b.text) sent.push({ text: b.text, buttons: b.reply_markup?.inline_keyboard });
        return new Response(JSON.stringify({ ok: true }));
      }) as typeof fetch;
      try {
        return await fn(sent);
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.TELEGRAM_BOT_TOKEN;
        resetEnvCache();
      }
    }

    it("sends one message about ten minutes before, with Approve and Remove, and not for far-off or already-reminded posts", async () => {
      await saveSettings({ requireApproval: true });
      fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
      const soon = await addPost({ scheduledAt: new Date(NOW.getTime() + 8 * 60_000), text: "A post going out in eight minutes." });
      await addPost({ scheduledAt: new Date(NOW.getTime() + 3 * 3_600_000), text: "A post going out much later." });
      await withTelegram(async (sent) => {
        await publishDue({ now: NOW });
        const r = sent.filter((m) => m.text.includes("Going out"));
        expect(r).toHaveLength(1);
        expect(r[0].text).toContain("A post going out in eight minutes.");
        expect(r[0].text).toContain("in about 8 minutes");
        expect(r[0].text).toContain("Not approved yet. If you do nothing it is skipped.");
        expect(r[0].buttons!.flat().map((b) => b.text)).toEqual(["✅ Approve", "🗑 Remove", "🔁 Another story", "✍️ New wording", "🚀 Post now"]);
        await publishDue({ now: new Date(NOW.getTime() + 60_000) });
        expect(sent.filter((m) => m.text.includes("Going out"))).toHaveLength(1); // only once
      });
      expect((await get(soon.id)).remindedAt).not.toBeNull();
    });

    it("an approved post's reminder says so, and the posted message follows when it goes out", async () => {
      await saveSettings({ requireApproval: true });
      fakePlatform("x", () => ({ kind: "success", externalIds: ["1"], url: "https://x.com/me/status/1" }));
      const p = await addPost({ scheduledAt: new Date(NOW.getTime() + 6 * 60_000), text: "Approved and ready.", approvedAt: NOW });
      await withTelegram(async (sent) => {
        await publishDue({ now: NOW });
        expect(sent.find((m) => m.text.includes("Going out"))!.text).toContain("Approved. It goes out on time unless you remove it.");
        await publishDue({ now: new Date(NOW.getTime() + 7 * 60_000) });
        const done = sent.find((m) => m.text.startsWith("✅ Posted on X"))!;
        expect(done.text).toContain("Approved and ready.");
        expect(done.text).toContain("https://x.com/me/status/1");
      });
      expect((await get(p.id)).status).toBe("published");
    });

    it("a rescheduled post gets a fresh heads-up", async () => {
      fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
      const base = Date.now();
      const p = await addPost({ scheduledAt: new Date(base + 8 * 60_000) });
      await withTelegram(async (sent) => {
        await publishDue({ now: new Date(base) });
        const { reschedulePost } = await import("../src/server/posts");
        await reschedulePost(p.id, new Date(base + 3 * 3_600_000));
        await publishDue({ now: new Date(base + 60_000) });
        expect(sent.filter((m) => m.text.includes("Going out"))).toHaveLength(1); // far off again: nothing new yet
        await publishDue({ now: new Date(base + 3 * 3_600_000 - 8 * 60_000) });
        expect(sent.filter((m) => m.text.includes("Going out"))).toHaveLength(2);
      });
    });
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
