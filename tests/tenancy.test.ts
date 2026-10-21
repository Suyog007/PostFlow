import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { approvePost, editPost, loadPost, PostError, removePost, upcoming } from "../src/server/posts";
import { getSettings, saveSettings } from "../src/server/settings";
import { publishDue } from "../src/server/publisher";
import { handleTelegramUpdate } from "../src/server/telegram-inbound";
import { recentEvents, addEvent } from "../src/server/events";
import { startOAuth, completeOAuth } from "../src/server/platforms/accounts";
import { tick } from "../src/server/tick";
import { actAs, addUser, connectAccount, fakePlatform, me, resetDb } from "./helpers";

const NOW = new Date("2026-10-21T04:00:00Z");

async function postFor(userId: string, over: Partial<typeof schema.posts.$inferInsert> = {}) {
  const [p] = await db()
    .insert(schema.posts)
    .values({ userId, platform: "x", pillar: "own_work", text: "A post that belongs to one user only.", status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z"), ...over })
    .returning();
  return p;
}

describe("one account cannot reach another's data", () => {
  let alice: string;
  let bob: string;
  beforeEach(async () => {
    await resetDb();
    alice = me();
    bob = (await addUser({ email: "bob@example.com", telegramChatId: "77" })).id;
  });

  it("posts: another user's post is 'not found' for every action", async () => {
    const p = await postFor(alice);
    actAs(bob);
    await expect(loadPost(p.id)).rejects.toThrow(PostError);
    await expect(removePost(p.id)).rejects.toThrow("Post not found.");
    await expect(editPost(p.id, "hijacked")).rejects.toThrow("Post not found.");
    await expect(approvePost(p.id)).rejects.toThrow("Post not found.");
    expect(await upcoming()).toHaveLength(0);
    const after = await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) });
    expect(after).toMatchObject({ status: "scheduled", text: "A post that belongs to one user only." });
  });

  it("settings and the activity feed are per user", async () => {
    await saveSettings({ paused: true, profile: { ...(await getSettings()).profile, name: "Alice" } });
    await addEvent("note", "alice did a thing");
    actAs(bob);
    const s = await getSettings();
    expect(s.paused).toBe(false);
    expect(s.profile.name).toBe("");
    expect(await recentEvents()).toHaveLength(0);
  });

  it("the publisher only publishes the current user's posts, with their own account", async () => {
    await saveSettings({ requireApproval: false });
    await connectAccount("x");
    await postFor(alice);
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    actAs(bob);
    await saveSettings({ requireApproval: false });
    expect((await publishDue({ now: NOW })).published).toBe(0);
    expect(sent).toHaveLength(0);
    actAs(alice);
    expect((await publishDue({ now: NOW })).published).toBe(1);
  });

  it("a Telegram chat can only act on its own account's posts", async () => {
    const p = await postFor(alice, { scheduledAt: new Date(Date.now() + 3_600_000) });
    // Bob's chat (77) presses a Remove button carrying Alice's post id.
    await handleTelegramUpdate({ callback_query: { id: "1", data: `rm:${p.id}`, message: { chat: { id: 77 } } } });
    expect((await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) }))!.status).toBe("scheduled");
    // Notes from Bob's chat land in Bob's account.
    await handleTelegramUpdate({ message: { chat: { id: 77 }, text: "Bob shipped a new onboarding flow that cut drop-off in half." } });
    const notes = await db().select().from(schema.notes);
    expect(notes.map((n) => n.userId)).toEqual([bob]);
  });

  it("an OAuth callback cannot attach an account to someone else's sign-in", async () => {
    process.env.X_CLIENT_ID = "test-client";
    const { resetEnvCache } = await import("../src/server/env");
    resetEnvCache();
    const url = new URL(await startOAuth("x")); // started by Alice
    actAs(bob);
    await expect(completeOAuth("x", url.searchParams.get("state")!, "code")).rejects.toThrow(/expired or is invalid/);
    delete process.env.X_CLIENT_ID;
    resetEnvCache();
  });

  it("without a user, per-user code refuses to run", async () => {
    actAs(null);
    await expect(getSettings()).rejects.toThrow("Not signed in.");
  });

  it("the scheduler publishes for every active account and skips lapsed ones", async () => {
    const carol = (await addUser({ email: "carol@example.com", subscriptionStatus: "canceled" })).id;
    for (const u of [alice, bob, carol]) {
      actAs(u);
      await saveSettings({ requireApproval: false, slots: [] });
      await connectAccount("x");
      await postFor(u, { scheduledAt: new Date(Date.now() - 60_000) });
    }
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    actAs(null);
    const r = await tick({ budgetMs: 30_000 });
    expect(r.users).toBe(2);
    expect(r.published).toBe(2);
    expect(sent).toHaveLength(2);
    const carolPost = (await db().select().from(schema.posts).where(eq(schema.posts.userId, carol)))[0];
    expect(carolPost.status).toBe("scheduled");
  });
});
