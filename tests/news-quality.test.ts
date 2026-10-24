import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { fillCalendar } from "../src/server/generate";
import { analyzeBatch } from "../src/server/analyze";
import { addTip, tipsSourceId } from "../src/server/tips";
import { saveSettings } from "../src/server/settings";
import { sharedPhrase } from "../src/server/checks";
import { setNewsSearchForTests } from "../src/server/verify";
import { GOOD_REVIEW, fakeLLM, resetDb, me } from "./helpers";

const NOW = new Date("2026-10-21T03:00:00Z");
const BOTH = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }, { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }];
const FAST_OFF = { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x" as const], quietStart: "23:00", quietEnd: "07:00" };

async function addItem(title: string, relevance: number, urgency = "evergreen") {
  const [it] = await db()
    .insert(schema.items)
    .values({ userId: me(), url: `https://example.com/${encodeURIComponent(title)}`, title, summary: `${title} summary text`, pillar: "news", publishedAt: new Date(NOW.getTime() - 3_600_000), relevance, urgency, analyzedAt: NOW })
    .returning();
  return it;
}

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: BOTH, horizonDays: 1, fastLane: FAST_OFF, pillars: { own_work: 0, news: 1, local: 0, learning: 0 } });
});

describe("skipping weak stories", () => {
  it("LinkedIn needs a higher score than X, so a middling story goes to X only", async () => {
    await addItem("A middling story about developer tooling changes", 7);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A middling tooling change landed. According to the report, it saves some setup time for teams." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 3 });
    const rows = await db().select().from(schema.posts);
    expect(rows.map((r) => r.platform)).toEqual(["x"]);
  });

  it("leaves the slot empty when nothing is worth posting, instead of filling it with an explainer", async () => {
    await saveSettings({ pillars: { own_work: 1, news: 1, local: 0, learning: 0 }, fillerPosts: false });
    const calls = fakeLLM(() => ({}));
    const r = await fillCalendar({ now: NOW, max: 3 });
    expect(await db().select().from(schema.posts)).toHaveLength(0);
    expect(r.idle).toBe("nothing worth posting right now");
    expect(calls.filter((c) => c.schemaName === "pick_topic")).toHaveLength(0);
  });

  it("fills with evergreen explainers only when filler is switched on", async () => {
    await saveSettings({ pillars: { own_work: 0, news: 1, local: 0, learning: 1 }, fillerPosts: true });
    fakeLLM((req) => (req.schemaName === "pick_topic" ? { topic: "Idempotency keys", angle: "one lesson" } : req.schemaName === "write_post" ? { text: "Idempotency keys make retries safe: send a key, store the result, return it again." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    expect((await db().select().from(schema.posts)).length).toBe(1);
  });

  it("with no 'my work' notes and no learning share, posts come from news only", async () => {
    await saveSettings({ pillars: { own_work: 3, news: 3, local: 0, learning: 0 } });
    await addItem("A strong story about a database release for developers", 9);
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A database release landed today. According to the notes, it speeds up backups for small teams." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 3 });
    const rows = await db().select().from(schema.posts);
    expect(rows.map((r) => r.pillar)).toEqual(["news", "news"]);
    expect(calls.filter((c) => c.schemaName === "pick_topic")).toHaveLength(0);
  });

  it("retries a slot that failed three times once the rejections are a few hours old", async () => {
    await saveSettings({ slots: [BOTH[0]] });
    await addItem("A strong story about a database release for developers", 9);
    const at = new Date("2026-10-21T03:45:00Z");
    const rejected = (hoursAgo: number) => ({ userId: me(), platform: "x", pillar: "news" as const, text: "old", status: "rejected" as const, scheduledAt: at, createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000) });
    await db().insert(schema.posts).values([rejected(1), rejected(1), rejected(1)]);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme shipped a database release today. Small teams with nightly backups get the most out of this one." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    expect((await db().select().from(schema.posts)).filter((p) => p.status === "scheduled")).toHaveLength(0);
    await db().update(schema.posts).set({ createdAt: new Date(NOW.getTime() - 5 * 3_600_000) });
    await fillCalendar({ now: NOW, max: 1 });
    expect((await db().select().from(schema.posts)).filter((p) => p.status === "scheduled")).toHaveLength(1);
  });

  it("Fill now retries recently failed slots straight away and logs the result", async () => {
    const { fillNowForUser } = await import("../src/server/tick");
    await saveSettings({ slots: [BOTH[0]], horizonDays: 3 });
    await addItem("A strong story about a database release for developers", 9);
    await addItem("Another strong story about a new open source CI runner", 9);
    const soon = await db().select().from(schema.posts);
    expect(soon).toHaveLength(0);
    // Three fresh rejections for the next slot would normally block it for hours.
    const { slotsBetween } = await import("../src/server/slots");
    const { getSettings } = await import("../src/server/settings");
    const tomorrow = slotsBetween(await getSettings(), new Date(Date.now() + 20 * 60_000), new Date(Date.now() + 3 * 86_400_000))[0].at;
    await db().insert(schema.posts).values([1, 2, 3].map(() => ({ userId: me(), platform: "x", pillar: "news" as const, text: "old", status: "rejected" as const, scheduledAt: tomorrow })));
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme shipped a database release today. Small teams with nightly backups get the most out of this one." } : GOOD_REVIEW));
    const r = await fillNowForUser(me(), { budgetMs: 30_000 });
    expect(r?.produced).toBeGreaterThanOrEqual(1);
    const live = (await db().select().from(schema.posts)).filter((p) => p.status === "scheduled");
    expect(live.map((p) => p.scheduledAt.getTime())).toContain(tomorrow.getTime());
    const done = await db().select().from(schema.events);
    expect(done.some((e) => e.kind === "fill_done" && /Filled the calendar/.test(e.message))).toBe(true);
  });

  it("does not waste rewrites on a story the reviewer finds not worth posting", async () => {
    await addItem("A boring story about developer tooling changes today", 9);
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A boring change landed. According to the report, nothing much happened for builders." } : { ...GOOD_REVIEW, worth_posting: 3, issues: ["A recap with no point."] }));
    await fillCalendar({ now: NOW, max: 1 });
    expect(calls.filter((c) => c.schemaName === "write_post")).toHaveLength(1);
    expect((await db().select().from(schema.posts))[0].status).toBe("rejected");
  });
});

describe("only verified news is posted", () => {
  it("skips a risky single-source story and posts it once others confirm", async () => {
    await saveSettings({ slots: [BOTH[0]] });
    await addItem("iFreeDomain is giving free domains for one year", 9);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "iFreeDomain is offering free domains for a year, according to its own page and Techpana. Handy for side projects." } : GOOD_REVIEW));
    setNewsSearchForTests(async () => []);
    await fillCalendar({ now: NOW, max: 1 });
    expect(await db().select().from(schema.posts)).toHaveLength(0);
    // another publisher picks it up; the failed check is old enough to retry
    await db().update(schema.items).set({ verifiedAt: new Date(Date.now() - 2 * 3_600_000) });
    setNewsSearchForTests(async () => [{ domain: "techpana.com", title: "Free domain for a year from iFreeDomain, new offer", url: "https://techpana.com/x" }]);
    await fillCalendar({ now: NOW, max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("scheduled");
    expect((p.review as { verification: { ok: boolean } }).verification.ok).toBe(true);
  });
});

describe("tips", () => {
  it("get a minimum score of 8 so a story you saw yourself is not buried", async () => {
    await addTip("https://ifreedomain.com/offer");
    const tipsId = await tipsSourceId();
    fakeLLM(() => ({ items: [{ id: "0", relevance: 5, urgency: "breaking", angle: "free domains" }] }));
    await analyzeBatch();
    const [it] = await db().select().from(schema.items);
    expect(it.sourceId).toBe(tipsId);
    expect(it.relevance).toBe(8);
  });
});

describe("fill now", () => {
  it("fills at least 5 days ahead even when autopilot plans 3", async () => {
    const { fillNowForUser } = await import("../src/server/tick");
    await saveSettings({ slots: [BOTH[0]], horizonDays: 3 });
    for (const t of ["Acme ships Postgres backups in seconds", "Bolt open-sources its CI runner", "Cinder cuts edge cold starts to 8ms", "Relay queues reach general availability", "Keyring moves auth sessions into signed cookies", "Vectorly indexes now update in place"]) await addItem(t, 9);
    const lines = ["Acme shipped a database release; nightly backup jobs get much shorter.", "Bolt opened its CI runner source, which matters most to teams paying per minute.", "Edge runtimes got cold starts under ten milliseconds, per the Cinder team.", "Queues without a broker to babysit: Relay made its service generally available.", "Keyring moved auth sessions into signed cookies, so small apps drop a whole table.", "Vectorly indexes now update in place, no more nightly rebuilds for search apps."];
    let n = 0;
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: lines[n++ % lines.length] } : GOOD_REVIEW));
    await fillNowForUser(me(), { budgetMs: 60_000 });
    const live = (await db().select().from(schema.posts)).filter((p) => p.status === "scheduled");
    const furthest = Math.max(...live.map((p) => p.scheduledAt.getTime()));
    expect(furthest - Date.now()).toBeGreaterThan(4 * 86_400_000);
    // About one slot a day: five days ahead holds four or five, depending on the time of day this runs.
    expect(live.length).toBeGreaterThanOrEqual(4);
  });
});

describe("big stories", () => {
  it("the scorer is told when many outlets run a story, and the story is written about once per platform", async () => {
    const srcs = await db().insert(schema.sources).values(["Register", "Ars", "NewStack", "TechCrunch"].map((n) => ({ userId: me(), name: n, url: `https://${n.toLowerCase()}.example.com/rss` }))).returning();
    const titles = ["PHP2Shell exploit bypasses remote code execution protections", "Hackers got a head start on the PHP2Shell vulnerability", "AI found a critical PHP flaw, the PHP2Shell fix took months", "PHP2Shell: patch now, site owners warned"];
    for (const [i, t] of titles.entries())
      await db().insert(schema.items).values({ userId: me(), sourceId: srcs[i].id, url: `https://${["theregister.com", "arstechnica.com", "thenewstack.io", "techcrunch.com"][i]}/php${i}`, title: t, summary: `${t}. Upgrade PHP today.`, pillar: "news", publishedAt: new Date(Date.now() - (i + 1) * 3_600_000) });
    const calls = fakeLLM((req) => (req.schemaName === "analyze_items" ? { items: titles.map((_, i) => ({ id: String(i), relevance: 9, urgency: "week", angle: "patch now" })) } : req.schemaName === "write_post" ? { text: "PHP2Shell hit PHP itself, per The Register. If you run PHP anywhere, patching beats reading about it." } : GOOD_REVIEW));
    await analyzeBatch();
    expect(calls[0].user).toMatch(/covered by 3 other outlets/);
    await saveSettings({ slots: [BOTH[0]], horizonDays: 3 });
    // The web search finds nothing; the other outlets in your own feeds confirm the story.
    setNewsSearchForTests(async () => []);
    await fillCalendar({ max: 3 });
    const all = await db().select().from(schema.posts);
    const live = all.filter((p) => p.status === "scheduled");
    expect(live).toHaveLength(1);
  });
});

describe("must-know stories", () => {
  it("are labelled by the scorer and get two versions: a normal take and a plain explainer you can switch to", async () => {
    // Slots at a fixed small hour and two days of window: some slot always falls inside, whatever time the test runs.
    await saveSettings({ slots: BOTH.map((b) => ({ ...b, time: "00:30" })), horizonDays: 2 });
    await db().insert(schema.items).values({ userId: me(), url: "https://theregister.com/php2shell", title: "PHP2Shell lets attackers run code on unpatched PHP servers", summary: "A flaw in PHP lets attackers run code. Patch to 8.4.9.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000) });
    let calls = fakeLLM(() => ({ items: [{ id: "0", relevance: 9, urgency: "week", angle: "PHP servers can be taken over; patch now", kind: "must_know" }] }));
    await analyzeBatch();
    expect((await db().select().from(schema.items))[0].kind).toBe("must_know");
    const normal = ["PHP2Shell is the reminder that old runtimes are attack surface too, per The Register. Patch to 8.4.9 before the weekend.", "The Register says PHP2Shell gives attackers code execution on unpatched PHP. Worth a look at every forgotten PHP box you own."];
    const simple = ["Think of PHP2Shell as a spare key under every PHP doormat, per The Register: strangers can run their own code on unpatched servers. Update to 8.4.9.", "PHP had a bug that let a stranger run their own code on your server, per The Register. If your site runs PHP, update to 8.4.9 today."];
    let n = 0;
    let e = 0;
    calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: req.user.includes("Explain it simply") ? simple[e++ % 2] : normal[n++ % 2] } : GOOD_REVIEW));
    await fillCalendar({ max: 2 });
    const writes = calls.filter((c) => c.schemaName === "write_post");
    expect(writes.some((w) => w.user.includes("Explain it simply"))).toBe(true);
    expect(writes.some((w) => !w.user.includes("Explain it simply"))).toBe(true);
    expect(writes.find((w) => w.user.includes("Explain it simply") && w.system.includes("LinkedIn"))!.system).toContain("at most 700 characters");
    const posts = await db().select().from(schema.posts);
    expect(posts.length).toBe(2);
    const p = posts[0];
    const alt = (p.review as { alternative: { text: string; move: string; approved: boolean } }).alternative;
    expect(alt.move).toBe("explain");
    expect(alt.approved).toBe(true);
    expect(normal).toContain(p.text);

    const { swapToAlternative } = await import("../src/server/generate");
    await swapToAlternative(p.id);
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(after.text).toBe(alt.text);
    expect((after.review as { move: string; alternative: { text: string } }).move).toBe("explain");
    expect((after.review as { alternative: { text: string } }).alternative.text).toBe(p.text);
    // And back again.
    await swapToAlternative(p.id);
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0].text).toBe(p.text);
  });

  it("when only the explainer passes review, it is the one scheduled", async () => {
    await saveSettings({ slots: [{ ...BOTH[0], time: "00:30" }], horizonDays: 2 });
    await db().insert(schema.items).values({ userId: me(), url: "https://theregister.com/php2shell", title: "PHP2Shell lets attackers run code on unpatched PHP servers", summary: "A flaw in PHP lets attackers run code. Patch to 8.4.9.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "week", kind: "must_know", analyzedAt: new Date() });
    fakeLLM((req) =>
      req.schemaName === "write_post"
        ? { text: req.user.includes("Explain it simply") ? "PHP had a bug that let a stranger run their own code on your server, per The Register. Update to 8.4.9 today." : "PHP2Shell is bad, per The Register. Patch to 8.4.9 soon." }
        : req.user.includes("let a stranger") ? GOOD_REVIEW : { ...GOOD_REVIEW, worth_posting: 3, issues: ["Says nothing."] },
    );
    await fillCalendar({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("scheduled");
    expect(p.text).toMatch(/let a stranger/);
    expect((p.review as { alternative: { approved: boolean } }).alternative.approved).toBe(false);
  });
});

describe("must-know stories and a full calendar", () => {
  it("take the slot of an unapproved news post, never an approved or edited one", async () => {
    // A slot every six hours, so the first ones always fall well before the story goes stale.
    await saveSettings({ slots: ["00:00", "06:00", "12:00", "18:00"].map((time) => ({ ...BOTH[0], time })), horizonDays: 3 });
    const slots = (await import("../src/server/slots")).slotsBetween(await (await import("../src/server/settings")).getSettings(), new Date(Date.now() + 20 * 60_000), new Date(Date.now() + 3 * 86_400_000));
    // Every slot before the story goes stale is taken: the first by an approved post, the rest by unapproved ones.
    for (const [i, sl] of slots.entries())
      await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", text: `Ordinary news post ${i} about a tooling release with a take.`, status: "scheduled", scheduledAt: sl.at, approvedAt: i === 0 ? new Date() : null, expiresAt: new Date(Date.now() + 6 * 86_400_000) });
    await db().insert(schema.items).values({ userId: me(), url: "https://theregister.com/php2shell", title: "PHP2Shell lets attackers run code on unpatched PHP servers", summary: "A flaw in PHP lets attackers run code. Patch to 8.4.9.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "breaking", kind: "must_know", analyzedAt: new Date() });
    let n = 0;
    const texts = ["PHP2Shell is a reminder that old runtimes are attack surface too, per The Register. Patch to 8.4.9.", "PHP had a bug that let a stranger run their own code on your server, per The Register. Update to 8.4.9 today."];
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: texts[n++ % 2] } : GOOD_REVIEW));
    await fillCalendar({ max: 2 });
    const live = (await db().select().from(schema.posts)).filter((p) => p.status === "scheduled").sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    expect(live[0].approvedAt).not.toBeNull(); // the approved post kept its slot
    expect(live[1].text).toMatch(/PHP/); // the next slot went to the must-know story
    expect(live.length).toBe(slots.length);
  });
});

describe("stock opinion phrases", () => {
  it("blocks the templates that make every post sound machine-written", async () => {
    const { runChecks } = await import("../src/server/checks");
    for (const t of ["Acme shipped X. I\u2019d expect teams to try it.", "Acme shipped X. In my view this matters.", "Acme shipped X, so a wave of tools will follow.", "Acme shipped X. I expect teams to adopt it."]) {
      expect(runChecks(t, "x").some((c) => c.code === "stock_opinion" && c.severity === "block")).toBe(true);
    }
    expect(runChecks("Acme shipped X. Small teams with big nightly backups should look first.", "x").some((c) => c.code === "stock_opinion")).toBe(false);
  });

  it("each news post gets a move, and the next post gets a different one", async () => {
    await saveSettings({ slots: [BOTH[0]], horizonDays: 3 });
    await addItem("Acme ships Postgres backups in seconds", 9);
    await addItem("Bolt open-sources its CI runner", 9);
    const texts = ["Acme shipped a database release today. Small teams with big nightly backups should look first.", "Bolt put its CI runner on GitHub, which matters most to teams paying per build minute."];
    let k = 0;
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: texts[k++ % 2] } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 2 });
    const moves = (await db().select().from(schema.posts)).map((p) => (p.review as { move?: string }).move);
    expect(moves).toHaveLength(2);
    expect(new Set(moves).size).toBe(2);
    expect(calls.filter((c) => c.schemaName === "write_post").every((c) => c.user.includes("THIS POST'S MOVE"))).toBe(true);
  });
});

describe("lessons for your audience", () => {
  it("a learning share writes short, simple lessons, and the writer is told how to teach", async () => {
    await saveSettings({ slots: [{ ...BOTH[0], time: "00:30" }], horizonDays: 2, pillars: { own_work: 0, news: 0, local: 0, learning: 1 } });
    const calls = fakeLLM((req) =>
      req.schemaName === "pick_topic"
        ? { topic: "What an index does in a database", angle: "a book's index, for rows" }
        : req.schemaName === "write_post"
          ? { text: "Your query is slow and the table is fine.\nAn index is a sorted shortcut to rows, like a book's index for pages.\nAdd one where you filter or join a lot. #postgres" }
          : GOOD_REVIEW,
    );
    await fillCalendar({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p).toMatchObject({ pillar: "learning", status: "scheduled", topic: "What an index does in a database" });
    const topic = calls.find((c) => c.schemaName === "pick_topic")!;
    expect(topic.system).toMatch(/easy for a beginner to follow/);
    const write = calls.find((c) => c.schemaName === "write_post")!;
    expect(write.system).toMatch(/Teach exactly ONE idea/);
    expect(write.system).toMatch(/HOOK \(line 1\)/);
  });

  it("writeLesson takes the next free slot on every connected platform, with your topic if you give one", async () => {
    const { writeLesson } = await import("../src/server/generate");
    await saveSettings({ slots: BOTH.map((b) => ({ ...b, time: "00:30" })), horizonDays: 2 });
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A cache is a shortcut you trust until it is stale.\nIt remembers an answer so you do not ask twice.\nCheck how it expires before you rely on it." } : GOOD_REVIEW));
    const ids = await writeLesson({ topic: "what a cache is" });
    expect(ids).toHaveLength(2);
    expect(calls.some((c) => c.schemaName === "pick_topic")).toBe(false); // the topic was yours
    const rows = await db().select().from(schema.posts);
    expect(rows.map((r) => r.platform).sort()).toEqual(["linkedin", "x"]);
    expect(rows.every((r) => r.topic === "what a cache is" && r.pillar === "learning")).toBe(true);
  });

  it("a removed slot can be filled with a lesson at the same time and platform", async () => {
    const { refillSlot } = await import("../src/server/generate");
    await saveSettings({ slots: [{ ...BOTH[0], time: "00:30" }], horizonDays: 2 });
    const at = new Date(Date.now() + 30 * 3_600_000);
    const [gone] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", text: "A post I removed.", status: "cancelled", scheduledAt: at }).returning();
    fakeLLM((req) =>
      req.schemaName === "pick_topic" ? { topic: "What a queue is", angle: "a line at a counter" } : req.schemaName === "write_post" ? { text: "A queue is a line for work.\nProducers add jobs; workers take them one at a time.\nUse one when a task can wait." } : GOOD_REVIEW,
    );
    const id = await refillSlot(gone.id, "lesson");
    const row = (await db().select().from(schema.posts).where(eq(schema.posts.id, id)))[0];
    expect(row).toMatchObject({ platform: "x", pillar: "learning", status: "scheduled" });
    expect(row.scheduledAt.getTime()).toBe(at.getTime());
    await expect(refillSlot(id, "lesson")).rejects.toThrow(/not empty/);
  });
});

describe("hooks for reach", () => {
  it("the writer is asked for a hook first, plain-language explanation and no invented advice; the reviewer checks the opener", async () => {
    const { writerSystem, REVIEWER_SYSTEM } = await import("../src/server/prompts");
    const { getSettings } = await import("../src/server/settings");
    const sys = writerSystem(await getSettings(), "linkedin");
    expect(sys).toMatch(/HOOK \(line 1, at most 14 words\)/);
    expect(sys).toMatch(/Do NOT give advice, steps, experiments or recommendations of your own/);
    expect(sys).toMatch(/3 to 5 short lines, 300 to 600 characters/);
    expect(REVIEWER_SYSTEM).toMatch(/FIRST LINE make a busy developer stop scrolling/);
    const { MOVES } = await import("../src/server/generate");
    expect(Object.keys(MOVES)).not.toContain("try"); // "the first thing you would try" made the writer invent experiments
    expect(Object.keys(MOVES)).toContain("plain");
  });
});

describe("hashtags", () => {
  it("X gets one or two specific hashtags by default, LinkedIn none, and the reviewer is told which", async () => {
    await saveSettings({ slots: BOTH.map((b) => ({ ...b, time: "00:30" })), horizonDays: 2 });
    await addItem("Acme ships Postgres backups in seconds", 9);
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme says Postgres backups now take seconds. Small teams with big nightly jobs should look first. #postgres" } : GOOD_REVIEW));
    await fillCalendar({ max: 4 });
    const writes = calls.filter((c) => c.schemaName === "write_post");
    expect(writes.find((w) => w.system.includes("Platform: X"))!.system).toMatch(/Finish with 1 or 2 hashtags/);
    expect(writes.find((w) => w.system.includes("Platform: LinkedIn"))!.system).toMatch(/No hashtags\./);
    const reviews = calls.filter((c) => c.schemaName === "review_post");
    expect(reviews.find((r) => r.user.startsWith("Platform: X"))!.user).toContain("Hashtags allowed here: yes");
    expect(reviews.find((r) => r.user.startsWith("Platform: LinkedIn"))!.user).toContain("Hashtags allowed here: no");
  });

  it("LinkedIn hashtags can be switched on (up to 3), and too many are blocked", async () => {
    const { runChecks } = await import("../src/server/checks");
    const { writerSystem } = await import("../src/server/prompts");
    const { getSettings } = await import("../src/server/settings");
    await saveSettings({ hashtags: { linkedin: true, x: false } });
    const s = await getSettings();
    expect(writerSystem(s, "linkedin")).toMatch(/up to 3 hashtags/);
    expect(writerSystem(s, "x")).toMatch(/No hashtags\./);
    expect(runChecks("A decent post about Postgres backups that finished faster. #postgres #devops #databases", "linkedin").some((c) => c.code === "hashtags")).toBe(false);
    expect(runChecks("A decent post about Postgres backups that finished faster. #postgres #devops #databases #sre", "linkedin").some((c) => c.code === "hashtags")).toBe(true);
    expect(runChecks("A decent post about Postgres backups that finished faster. #postgres #devops #databases", "x").some((c) => c.code === "hashtags")).toBe(true);
  });
});

describe("repeated phrasing", () => {
  it("finds a shared run of six words", () => {
    expect(sharedPhrase("I would expect small teams to ship focused products first.", "Honestly I would expect small teams to ship it faster.")).toBe("i would expect small teams to");
    expect(sharedPhrase("Totally different wording here today.", "Another unrelated sentence about nothing similar.")).toBeNull();
  });
});
