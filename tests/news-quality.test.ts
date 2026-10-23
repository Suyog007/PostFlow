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
    await saveSettings({ pillars: { own_work: 1, news: 1, local: 0, learning: 1 }, fillerPosts: false });
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

  it("with no 'my work' notes and explainers off, posts come from news only", async () => {
    await saveSettings({ pillars: { own_work: 3, news: 3, local: 0, learning: 1 } });
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
    for (const t of ["database release", "CI runner", "edge runtime", "queue service", "auth library", "vector index"]) await addItem(`A strong story about a new ${t} for developers`, 9);
    const lines = ["Acme shipped a database release; nightly backup jobs get much shorter.", "Bolt opened its CI runner source, which matters most to teams paying per minute.", "Edge runtimes got cold starts under ten milliseconds, per the Cinder team.", "Queues without a broker to babysit: Relay made its service generally available.", "Keyring moved auth sessions into signed cookies, so small apps drop a whole table.", "Vectorly indexes now update in place, no more nightly rebuilds for search apps."];
    let n = 0;
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: lines[n++ % lines.length] } : GOOD_REVIEW));
    await fillNowForUser(me(), { budgetMs: 60_000 });
    const live = (await db().select().from(schema.posts)).filter((p) => p.status === "scheduled");
    const furthest = Math.max(...live.map((p) => p.scheduledAt.getTime()));
    expect(furthest - Date.now()).toBeGreaterThan(4 * 86_400_000);
    expect(live.length).toBeGreaterThanOrEqual(5);
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
    await addItem("A strong story about a database release for developers", 9);
    await addItem("Another strong story about a new open source CI runner", 9);
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme shipped a database release today. Small teams with big nightly backups should look first." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 2 });
    const moves = (await db().select().from(schema.posts)).map((p) => (p.review as { move?: string }).move);
    expect(moves).toHaveLength(2);
    expect(new Set(moves).size).toBe(2);
    expect(calls.filter((c) => c.schemaName === "write_post").every((c) => c.user.includes("THIS POST'S MOVE"))).toBe(true);
  });
});

describe("repeated phrasing", () => {
  it("finds a shared run of six words", () => {
    expect(sharedPhrase("I would expect small teams to ship focused products first.", "Honestly I would expect small teams to ship it faster.")).toBe("i would expect small teams to");
    expect(sharedPhrase("Totally different wording here today.", "Another unrelated sentence about nothing similar.")).toBeNull();
  });
});
