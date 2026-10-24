import { DateTime } from "luxon";
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
      if (b.text ?? b.caption) sent.push({ text: b.text ?? b.caption, buttons: b.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      // Fixed local hours, so the first two posts always share a day whatever the clock says.
      const at = (days: number, hour: number) => DateTime.now().setZone("Asia/Kathmandu").plus({ days }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      const tomorrow = at(2, 9);
      const later = at(4, 9);
      await db().insert(schema.posts).values([
        { userId: me(), platform: "linkedin", pillar: "news", text: long, status: "scheduled", scheduledAt: at(1, 9) },
        { userId: me(), platform: "x", pillar: "news", text: "Second post of the first day.", status: "scheduled", scheduledAt: at(1, 10) },
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
    expect(day1.buttons!.length).toBe(4); // two rows per post
    expect(day1.buttons![0].map((b) => b.text)).toEqual(["✅ Approve 1", "🚀 Now 1", "🗑 Remove 1"]);
    expect(day1.buttons![1].map((b) => b.text)).toEqual(["🔁 Another story 1", "✍️ New wording 1"]);
    expect(sent.some((m) => m.text.includes("Tomorrow"))).toBe(true);
    const approved = sent.find((m) => m.text.includes("A post for tomorrow"))!;
    expect(approved.text).toContain("✅ approved");
    expect(approved.buttons![0].map((b) => b.text)).toEqual(["🚀 Now 1", "🗑 Remove 1"]);
  });

  it("Post now asks first, then publishes straight away and keeps the planned slot empty", async () => {
    const { fillCalendar } = await import("../src/server/generate");
    const { saveSettings } = await import("../src/server/settings");
    const { connectAccount, fakePlatform, fakeLLM, GOOD_REVIEW } = await import("./helpers");
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: { text: string; buttons?: { text: string; callback_data: string }[][] }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const b = JSON.parse(init?.body ?? "{}");
      if (b.text ?? b.caption) sent.push({ text: b.text ?? b.caption, buttons: b.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      await saveSettings({ requireApproval: true, slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }], horizonDays: 2, fastLane: { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x"], quietStart: "23:00", quietEnd: "07:00" } });
      await connectAccount("x");
      const out = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"], url: "https://x.com/me/status/1" }));
      const slot = new Date(Date.now() + 5 * 3_600_000);
      const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", text: "Ship this one early.", status: "scheduled", scheduledAt: slot }).returning();

      // Step 1: tapping 🚀 Now only asks. Nothing is published yet.
      await handleTelegramUpdate({ callback_query: { id: "1", data: `pn:${p.id}`, message: { chat: { id: 42 } } } });
      expect(out).toHaveLength(0);
      const ask = sent.find((m) => m.text.includes("right now, ahead of its schedule"))!;
      expect(ask.buttons![0].map((b) => b.callback_data)).toEqual([`py:${p.id}`, "no:"]);

      // Cancel does nothing.
      await handleTelegramUpdate({ callback_query: { id: "2", data: "no:", message: { chat: { id: 42 } } } });
      expect(out).toHaveLength(0);

      // Step 2: confirming publishes it, even though approval mode is on (asking is an approval).
      await handleTelegramUpdate({ callback_query: { id: "3", data: `py:${p.id}`, message: { chat: { id: 42 } } } });
      expect(out).toHaveLength(1);
      const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
      expect(after.status).toBe("published");
      expect(after.slotAt!.getTime()).toBe(slot.getTime());

      // The slot it vacated is not filled with another post.
      await db().insert(schema.items).values({ userId: me(), url: "https://example.com/a", title: "Acme ships Postgres backups in seconds", summary: "Backups got faster.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "week", analyzedAt: new Date() });
      fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme shipped faster backups, per its changelog. Small teams with big nightly jobs should look first." } : GOOD_REVIEW));
      await fillCalendar({ max: 5 });
      const planned = (await db().select().from(schema.posts)).filter((x) => x.id !== p.id && x.status === "scheduled");
      expect(planned.map((x) => x.scheduledAt.getTime())).not.toContain(slot.getTime());
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
  });

  it("/queue shows a Post now button on every post", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: { buttons?: { text: string }[][] }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const b = JSON.parse(init?.body ?? "{}");
      sent.push({ buttons: b.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", text: "One post.", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) });
      await handleTelegramUpdate(msg("/queue"));
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
    expect(sent.flatMap((m) => m.buttons ?? []).flat().map((b) => b.text)).toContain("🚀 Now 1");
  });

  describe("/fill and getting a different post", () => {
    async function capture<T>(fn: (sent: { text: string; buttons?: { text: string; callback_data: string }[][] }[]) => Promise<T>) {
      process.env.TELEGRAM_BOT_TOKEN = "123:test";
      resetEnvCache();
      const sent: { text: string; buttons?: { text: string; callback_data: string }[][] }[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
        const b = JSON.parse(init?.body ?? "{}");
        if (b.text ?? b.caption) sent.push({ text: b.text ?? b.caption, buttons: b.reply_markup?.inline_keyboard });
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

    it("/fill starts a fill and refuses to start a second one while it runs", async () => {
      await capture(async (sent) => {
        await handleTelegramUpdate(msg("/fill"));
        expect(sent[0].text).toMatch(/Filling the next 5 days.*message you when it is done/);
        await handleTelegramUpdate(msg("/fill"));
        expect(sent[1].text).toMatch(/Already filling/);
      });
      const events = await db().select().from(schema.events);
      expect(events.filter((e) => e.kind === "fill")).toHaveLength(1);
    });

    it("/fill says so when autopilot is paused", async () => {
      await handleTelegramUpdate(msg("/pause"));
      await capture(async (sent) => {
        await handleTelegramUpdate(msg("/fill"));
        expect(sent[0].text).toMatch(/paused/i);
      });
    });

    it("/learn writes a lesson and sends it back with buttons; removing a post offers to fill the slot", async () => {
      const { fakeLLM, GOOD_REVIEW } = await import("./helpers");
      const { saveSettings } = await import("../src/server/settings");
      await saveSettings({ slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "00:30" }], horizonDays: 2 });
      fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A cache is a shortcut you trust until it is stale.\nIt remembers an answer so you do not ask twice.\nCheck how it expires first. #backend" } : GOOD_REVIEW));
      await capture(async (sent) => {
        await handleTelegramUpdate(msg("/learn what a cache is"));
        expect(sent[0].text).toMatch(/Writing a short lesson on "what a cache is"/);
        const lesson = sent.find((m) => m.text.startsWith("🎓 Lesson"))!;
        expect(lesson.text).toContain("A cache is a shortcut");
        expect(lesson.buttons!.flat().map((b) => b.text)).toEqual(["✅ Approve", "🗑 Remove", "🔁 Another story", "✍️ New wording"]);

        const [p] = await db().select().from(schema.posts);
        await handleTelegramUpdate({ callback_query: { id: "5", data: `rm:${p.id}`, message: { chat: { id: 42 } } } });
        const offer = sent.find((m) => m.text.includes("Want to put something else in that slot?"))!;
        expect(offer.buttons!.flat().map((b) => b.text)).toEqual(["🎓 Fill with a lesson", "📰 Fill with news"]);
      });
    });

    it("the New wording button writes the same story again and sends it back with buttons", async () => {
      const { fakeLLM, GOOD_REVIEW } = await import("./helpers");
      const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "own_work", text: "Cut CI from 14 minutes to 4. The cache did most of it.", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
      fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Our CI used to take 14 minutes and now takes 4, mostly thanks to the dependency cache. #devops" } : GOOD_REVIEW));
      await capture(async (sent) => {
        await handleTelegramUpdate({ callback_query: { id: "9", data: `rw:${p.id}`, message: { chat: { id: 42 } } } });
        const reply = sent.find((m) => m.text.includes("New wording"))!;
        expect(reply.text).toContain("takes 4, mostly thanks to the dependency cache");
        expect(reply.buttons!.flat().map((b) => b.callback_data)).toEqual([`ok:${p.id}`, `rm:${p.id}`, `rj:${p.id}`, `rw:${p.id}`]);
      });
      const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
      expect(after.text).toContain("dependency cache");
      expect(after.status).toBe("scheduled");
    });
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

describe("when the story happened", () => {
  beforeEach(resetDb);

  it("shows the story's date and publisher in /queue and reminders, never in the post text", async () => {
    const { storyLine } = await import("../src/server/story-date");
    const [src] = await db().insert(schema.sources).values({ userId: me(), name: "The Register", url: "https://theregister.com/rss" }).returning();
    const published = new Date(Date.now() - 3 * 86_400_000);
    const [it] = await db().insert(schema.items).values({ userId: me(), sourceId: src.id, url: "https://theregister.com/gitlab", title: "GitLab patches a 12-year-old RCE", summary: "s", pillar: "news", publishedAt: published }).returning();
    const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "news", itemId: it.id, text: "GitLab fixed a bug that sat in its code for 12 years.", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
    const line = await storyLine(p, "Asia/Kathmandu");
    expect(line).toMatch(/^📰 Story from \w{3} \d{1,2} \w{3}, \d{2}:\d{2} \(3 days ago\) · The Register$/);
    expect(p.text).not.toContain("days ago");

    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
      const b = JSON.parse(init?.body ?? "{}");
      if (b.text ?? b.caption) sent.push(b.text ?? b.caption);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      await handleTelegramUpdate(msg("/queue"));
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
    expect(sent.some((t) => t.includes(line))).toBe(true);
  });

  it("a lesson has no story date, and a swapped post says so instead of 'declined'", async () => {
    const { storyLine } = await import("../src/server/story-date");
    const { rejectAndReplace } = await import("../src/server/generate");
    const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "learning", topic: "caching", text: "A cache remembers answers.", status: "declined", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
    expect(await storyLine(p, "UTC")).toBe("");
    await expect(rejectAndReplace(p.id)).rejects.toThrow(/already swapped for another story/);
  });
});

describe("/today and /tomorrow", () => {
  beforeEach(resetDb);

  async function capture(fn: () => Promise<void>) {
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: { text: string; buttons?: { text: string; callback_data: string }[][] }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
      const b = JSON.parse(init?.body ?? "{}");
      if (b.text ?? b.caption) sent.push({ text: b.text ?? b.caption, buttons: b.reply_markup?.inline_keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
    return sent;
  }

  it("each shows only that day's posts", async () => {
    const { DateTime } = await import("luxon");
    const now = DateTime.now().setZone("Asia/Kathmandu");
    const tomorrowNoon = now.plus({ days: 1 }).startOf("day").plus({ hours: 12 }).toJSDate();
    const laterToday = now.plus({ minutes: 3 });
    const sameDay = laterToday.hasSame(now, "day");
    await db().insert(schema.posts).values([
      { userId: me(), platform: "x", pillar: "news", text: "A post for tomorrow noon.", status: "scheduled", scheduledAt: tomorrowNoon },
      { userId: me(), platform: "x", pillar: "news", text: "A post three days out.", status: "scheduled", scheduledAt: now.plus({ days: 3 }).toJSDate() },
      ...(sameDay ? [{ userId: me(), platform: "linkedin", pillar: "news" as const, text: "A post for later today.", status: "scheduled" as const, scheduledAt: laterToday.toJSDate() }] : []),
    ]);

    const tomorrow = await capture(() => handleTelegramUpdate(msg("/tomorrow")));
    expect(tomorrow[0].text).toMatch(/^🗓 1 scheduled post tomorrow/);
    expect(tomorrow[1].text).toMatch(/^📅 Tomorrow · /);
    expect(tomorrow.map((m) => m.text).join("\n")).not.toMatch(/three days out|later today/);

    const today = await capture(() => handleTelegramUpdate(msg("/today")));
    if (sameDay) {
      expect(today[1].text).toContain("A post for later today.");
      expect(today.map((m) => m.text).join("\n")).not.toContain("tomorrow noon");
    } else {
      expect(today[0].text).toMatch(/Nothing scheduled for today/);
    }
  });

  it("says so when a day is empty, and a long day keeps the right buttons under each post", async () => {
    const { DateTime } = await import("luxon");
    const empty = await capture(() => handleTelegramUpdate(msg("/tomorrow")));
    expect(empty[0].text).toMatch(/Nothing scheduled for tomorrow\. Send \/fill/);

    const base = DateTime.now().setZone("Asia/Kathmandu").plus({ days: 1 }).startOf("day").plus({ hours: 8 });
    const long = "A long post about databases and caching. ".repeat(40).trim();
    const rows = await db()
      .insert(schema.posts)
      .values([0, 1, 2].map((i) => ({ userId: me(), platform: "linkedin", pillar: "news" as const, text: `${i}: ${long}`, status: "scheduled" as const, scheduledAt: base.plus({ hours: i }).toJSDate() })))
      .returning();
    const sent = await capture(() => handleTelegramUpdate(msg("/tomorrow")));
    const second = sent.find((m) => m.text.startsWith("2. LinkedIn"))!;
    const ids = second.buttons!.flat().map((b) => b.callback_data);
    const p2 = rows.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[1];
    expect(ids.every((d) => d.endsWith(p2.id))).toBe(true);
    expect(second.buttons!.length).toBe(2);
  });
});
