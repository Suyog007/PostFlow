import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { handleTelegramUpdate } from "../src/server/telegram-inbound";
import { getSettings } from "../src/server/settings";
import { actAs, addUser, resetDb, me } from "./helpers";
import { resetEnvCache } from "../src/server/env";
import { telegramLinkUrl } from "../src/server/telegram";

const msg = (text: string, chat = 42) => ({ message: { chat: { id: chat }, text } });

describe("telegram inbound", () => {
  beforeEach(resetDb);

  it("saves plain text as an own-work note and routes tags", async () => {
    await handleTelegramUpdate(msg("Shipped a Rust rewrite of our parser and it is 6x faster on large files."));
    await handleTelegramUpdate(msg("#nepal Kathmandu devs are organising a meetup about local fintech APIs next week."));
    const notes = await db().select().from(schema.notes);
    expect(notes.map((n) => n.pillar).sort()).toEqual(["local", "own_work"]);
    expect(notes.find((n) => n.pillar === "local")!.text).not.toContain("#nepal");
  });

  it("ignores everyone except the owner chat", async () => {
    await handleTelegramUpdate(msg("Shipped a Rust rewrite of our parser and it is 6x faster.", 999));
    await handleTelegramUpdate(msg("/pause", 999));
    expect(await db().select().from(schema.notes)).toHaveLength(0);
    expect((await getSettings()).paused).toBe(false);
  });

  it("/pause and /resume flip the kill switch", async () => {
    await handleTelegramUpdate(msg("/pause"));
    expect((await getSettings()).paused).toBe(true);
    await handleTelegramUpdate(msg("/resume"));
    expect((await getSettings()).paused).toBe(false);
  });

  it("/queue shows full posts grouped by day, with Approve and Remove buttons", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: { text: string; buttons?: { text: string }[][] }[] = [];
    const long = "Two new PHP bugs let anyone upload and run code on a server that runs a vulnerable version. ".repeat(3).trim();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const b = JSON.parse(init?.body ?? "{}");
      if (b.text) sent.push({ text: b.text, buttons: b.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      const tomorrow = new Date(Date.now() + 26 * 3_600_000);
      const later = new Date(Date.now() + 74 * 3_600_000);
      await db().insert(schema.posts).values([
        { userId: me(), platform: "linkedin", pillar: "news", text: long, status: "scheduled", scheduledAt: new Date(Date.now() + 2 * 3_600_000) },
        { userId: me(), platform: "x", pillar: "news", text: "Second post of the first day.", status: "scheduled", scheduledAt: new Date(Date.now() + 3 * 3_600_000) },
        { userId: me(), platform: "x", pillar: "news", text: "A post for tomorrow.", status: "scheduled", scheduledAt: tomorrow, approvedAt: new Date() },
        { userId: me(), platform: "x", pillar: "news", text: "A post for later.", status: "scheduled", scheduledAt: later },
      ]);
      await handleTelegramUpdate(msg("/queue"));
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
    expect(sent[0].text).toMatch(/4 scheduled posts over 3 days/);
    const day1 = sent.find((m) => /Today|Tomorrow|^📅/.test(m.text) && m.text.includes("Second post"))!;
    expect(day1.text).toContain(long); // the whole post, not a cut-off
    expect(day1.text).toMatch(/1\. LinkedIn/);
    expect(day1.text).toMatch(/2\. X/);
    expect(day1.buttons!.length).toBe(2);
    expect(day1.buttons![0].map((b) => b.text)).toEqual(["✅ Approve 1", "🗑 Remove 1"]);
    expect(sent.some((m) => m.text.includes("Tomorrow"))).toBe(true);
    const approved = sent.find((m) => m.text.includes("A post for tomorrow"))!;
    expect(approved.text).toContain("✅ approved");
    expect(approved.buttons![0].map((b) => b.text)).toEqual(["🗑 Remove 1"]);
  });

  it("the Remove button cancels a scheduled post", async () => {
    const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "own_work", text: "t", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
    await handleTelegramUpdate({ callback_query: { id: "1", data: `rm:${p.id}`, message: { chat: { id: 42 } } } });
    expect((await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) }))!.status).toBe("cancelled");
  });

  it("links a chat with the one-time code from Settings", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_BOT_USERNAME = "PostFlowBot";
    resetEnvCache();
    try {
      const bob = await addUser({ email: "bob@example.com" });
      actAs(bob.id);
      const link = await telegramLinkUrl();
      expect(link).toMatch(/^https:\/\/t\.me\/PostFlowBot\?start=/);
      const code = new URL(link!).searchParams.get("start")!;
      // Before linking, a chat cannot do anything.
      await handleTelegramUpdate(msg("A note from a chat that is not linked yet, should be ignored.", 555));
      expect(await db().select().from(schema.notes)).toHaveLength(0);
      await handleTelegramUpdate(msg(`/start ${code}`, 555));
      const linked = await db().query.users.findFirst({ where: eq(schema.users.id, bob.id) });
      expect(linked).toMatchObject({ telegramChatId: "555", telegramLinkCode: null });
      // The code works once.
      await handleTelegramUpdate(msg(`/start ${code}`, 556));
      expect((await db().query.users.findFirst({ where: eq(schema.users.id, bob.id) }))!.telegramChatId).toBe("555");
      await handleTelegramUpdate(msg("Bob wrote about shipping the new billing page today.", 555));
      expect((await db().select().from(schema.notes)).map((n) => n.userId)).toEqual([bob.id]);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_USERNAME;
      resetEnvCache();
    }
  });

  it("a lapsed subscription cannot act through Telegram", async () => {
    await db().update(schema.users).set({ subscriptionStatus: "canceled" }).where(eq(schema.users.id, me()));
    await handleTelegramUpdate(msg("A note that should not be saved because billing lapsed."));
    expect(await db().select().from(schema.notes)).toHaveLength(0);
  });
});
