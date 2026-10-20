import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { fillCalendar } from "../src/server/generate";
import { analyzeBatch } from "../src/server/analyze";
import { addTip, tipsSourceId } from "../src/server/tips";
import { saveSettings } from "../src/server/settings";
import { sharedPhrase } from "../src/server/checks";
import { setNewsSearchForTests } from "../src/server/verify";
import { GOOD_REVIEW, fakeLLM, resetDb } from "./helpers";

const NOW = new Date("2026-10-21T03:00:00Z");
const BOTH = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }, { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }];
const FAST_OFF = { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x" as const], quietStart: "23:00", quietEnd: "07:00" };

async function addItem(title: string, relevance: number, urgency = "evergreen") {
  const [it] = await db()
    .insert(schema.items)
    .values({ url: `https://example.com/${encodeURIComponent(title)}`, title, summary: `${title} summary text`, pillar: "news", publishedAt: new Date(NOW.getTime() - 3_600_000), relevance, urgency, analyzedAt: NOW })
    .returning();
  return it;
}

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: BOTH, horizonDays: 1, fastLane: FAST_OFF, pillars: { own_work: 0, news: 1, nepal: 0, learning: 0 } });
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
    await saveSettings({ pillars: { own_work: 1, news: 1, nepal: 0, learning: 1 } });
    const calls = fakeLLM(() => ({}));
    const r = await fillCalendar({ now: NOW, max: 3 });
    expect(await db().select().from(schema.posts)).toHaveLength(0);
    expect(r.idle).toBe("nothing worth posting right now");
    expect(calls.filter((c) => c.schemaName === "pick_topic")).toHaveLength(0);
  });

  it("fills with evergreen explainers only when filler is switched on", async () => {
    await saveSettings({ pillars: { own_work: 0, news: 1, nepal: 0, learning: 1 }, fillerPosts: true });
    fakeLLM((req) => (req.schemaName === "pick_topic" ? { topic: "Idempotency keys", angle: "one lesson" } : req.schemaName === "write_post" ? { text: "Idempotency keys make retries safe: send a key, store the result, return it again." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    expect((await db().select().from(schema.posts)).length).toBe(1);
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

describe("repeated phrasing", () => {
  it("finds a shared run of six words", () => {
    expect(sharedPhrase("I would expect small teams to ship focused products first.", "Honestly I would expect small teams to ship it faster.")).toBe("i would expect small teams to");
    expect(sharedPhrase("Totally different wording here today.", "Another unrelated sentence about nothing similar.")).toBeNull();
  });
});
