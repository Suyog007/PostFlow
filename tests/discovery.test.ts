import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { canonicalUrl, titleSimilarity, urlHash } from "@/server/discovery/normalize";
import { ingest, buildBriefing, storeAnalysis, isStale } from "@/server/discovery/pipeline";
import { evidenceScore, recencyScore, totalScore } from "@/server/discovery/scoring";
import { defaultPreferences } from "@/server/preferences";
import type { RawEntry } from "@/server/discovery/collect";
import type { AnalysisItem } from "@/server/llm/prompts";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

async function source() {
  const [s] = await db().insert(schema.sources).values({ name: "Test", kind: "rss", url: `https://feed.test/${Math.random()}` }).returning();
  return s.id;
}

const entry = (sourceId: string, url: string, title: string, extra: Partial<RawEntry> = {}): RawEntry => ({
  sourceId,
  url,
  title,
  excerpt: "Some excerpt text about the development.",
  publishedAt: new Date(),
  publisher: "Test",
  isPrimary: false,
  kind: "article",
  topicHint: null,
  meta: {},
  ...extra,
});

describe("URL normalization", () => {
  it("strips tracking params, www, fragments, trailing slashes; sorts query", () => {
    expect(canonicalUrl("http://www.Example.com/a/b/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/a/b?a=1&b=2");
    expect(urlHash("https://example.com/post?fbclid=123")).toBe(urlHash("https://example.com/post/"));
  });
  it("title similarity groups reports of the same story", () => {
    expect(titleSimilarity("OpenAI releases new reasoning model o5", "OpenAI releases o5, a new reasoning model")).toBeGreaterThan(0.55);
    expect(titleSimilarity("OpenAI releases new reasoning model", "Nepal budget increases IT spending")).toBeLessThan(0.1);
  });
});

describe("deduplication and grouping", () => {
  it("exact duplicate URLs are ignored; similar titles become supporting sources", async () => {
    const s = await source();
    const r1 = await ingest([
      entry(s, "https://a.test/story?utm_medium=rss", "Acme launches open-weight speech model for 40 languages"),
      entry(s, "https://www.a.test/story/", "Acme launches open-weight speech model for 40 languages"),
      entry(s, "https://b.test/x", "Acme launches open weight speech model supporting 40 languages"),
      entry(s, "https://c.test/y", "Kathmandu startup raises seed round for agritech"),
    ]);
    expect(r1).toEqual({ created: 2, merged: 1 });
    const items = await db().query.items.findMany();
    expect(items).toHaveLength(2);
    const acme = items.find((i) => i.title.startsWith("Acme"))!;
    expect(await db().query.itemSources.findMany({ where: eq(schema.itemSources.itemId, acme.id) })).toHaveLength(2);
    // Re-ingesting the same feed creates nothing.
    expect(await ingest([entry(s, "https://a.test/story", "Acme launches open-weight speech model for 40 languages")])).toEqual({ created: 0, merged: 0 });
  });
});

describe("scoring", () => {
  it("weights produce a total out of 100", () => {
    const w = defaultPreferences().weights;
    expect(totalScore({ relevance: 5, recency: 5, evidence: 5, insight: 5, audience: 5 }, w)).toBe(100);
    expect(totalScore({ relevance: 0, recency: 0, evidence: 0, insight: 0, audience: 0 }, w)).toBe(0);
    expect(totalScore({ relevance: 4, recency: 3, evidence: 2, insight: 5, audience: 1 }, w)).toBe(63);
    expect(totalScore({ relevance: 5, recency: 5, evidence: 5, insight: 5, audience: 5 }, w, [{ code: "repeat_topic", multiplier: 0.6, note: "" }])).toBe(60);
  });
  it("deterministic evidence caps and recency", () => {
    expect(evidenceScore(5, 1, false, 3)).toBe(3);
    expect(evidenceScore(1, 1, true, 2)).toBe(3);
    expect(evidenceScore(5, 4, false, 0)).toBe(1.5);
    const now = new Date();
    expect(recencyScore(new Date(now.getTime() - 3_600_000), now, "timely")).toBe(5);
    expect(recencyScore(new Date(now.getTime() - 10 * 86_400_000), now, "timely")).toBe(0.5);
  });
  it("stale news is filtered", () => {
    const p = defaultPreferences();
    expect(isStale({ kind: "article", publishedAt: new Date(Date.now() - 10 * 86_400_000), meta: {} }, p, new Date())).toBe(true);
    expect(isStale({ kind: "article", publishedAt: new Date(), meta: {} }, p, new Date())).toBe(false);
  });
});

describe("briefing", () => {
  const analysis = (headline: string, category: string, rel = 5, eventKey = headline.toLowerCase().replace(/\W+/g, "-")): AnalysisItem => ({
    ref: "i0",
    eventKey,
    skip: false,
    skipReason: null,
    category,
    timeliness: "timely",
    headline,
    summary: "s",
    whyItMatters: "w",
    opportunity: null,
    whyPost: "p",
    facts: ["fact one"],
    interpretation: [],
    uncertainty: null,
    scores: { relevance: rel, evidence: 4, insight: 4, audience: 4 },
    relevanceReason: "r",
    platforms: ["x"],
  });

  it("ranks by score, caps per category, skips items shown on earlier days, and repeats get penalized", async () => {
    const u = await makeUser();
    const prefs = { ...defaultPreferences(), briefing: { ...defaultPreferences().briefing, maxPerCategory: 2, minScore: 10 } };
    const s = await source();
    await ingest([
      entry(s, "https://t.test/1", "Alpha model beats benchmark"),
      entry(s, "https://t.test/2", "Beta agent framework released"),
      entry(s, "https://t.test/3", "Gamma tool for coding agents"),
      entry(s, "https://t.test/4", "Nepal digital payments surge"),
    ]);
    const items = await db().query.items.findMany();
    const by = (t: string) => items.find((i) => i.title.startsWith(t))!;
    const now = new Date();
    await storeAnalysis(by("Alpha"), analysis("Alpha model beats benchmark", "AI", 5), prefs, now, []);
    await storeAnalysis(by("Beta"), analysis("Beta agent framework released", "AI", 4), prefs, now, []);
    await storeAnalysis(by("Gamma"), analysis("Gamma tool for coding agents", "AI", 3), prefs, now, []);
    await storeAnalysis(by("Nepal"), analysis("Nepal digital payments surge", "Nepal economy", 3), prefs, now, [{ title: "Nepal digital payments surge again" }]);

    const b = await buildBriefing(u, prefs, now);
    const rows = await db().query.briefingItems.findMany({ where: eq(schema.briefingItems.briefingId, b.briefingId) });
    const titles = rows.sort((a, c) => a.rank - c.rank).map((r) => items.find((i) => i.id === r.itemId)!.title);
    expect(titles).toContain("Alpha model beats benchmark");
    expect(titles).not.toContain("Gamma tool for coding agents"); // third "AI" item exceeds the cap
    const nepalScore = (await db().query.scores.findFirst({ where: eq(schema.scores.itemId, by("Nepal").id) }))!;
    expect((nepalScore.penalties as { code: string }[]).map((p) => p.code)).toContain("repeat_topic");
  });

  it("shows one report per real-world event", async () => {
    const u = await makeUser();
    const prefs = { ...defaultPreferences(), briefing: { ...defaultPreferences().briefing, minScore: 10 } };
    const s = await source();
    await ingest([
      entry(s, "https://f.test/1", "Budhigandaki flood damages four hydropower projects"),
      entry(s, "https://f.test/2", "Army says landslide blocked river before Gorkha flood"),
      entry(s, "https://f.test/3", "Startup raises seed round for farm robots"),
    ]);
    const items = await db().query.items.findMany();
    const by = (t: string) => items.find((i) => i.title.startsWith(t))!;
    const now = new Date();
    await storeAnalysis(by("Budhigandaki"), analysis("Flood damages hydropower", "Nepal disaster", 5, "budhi-gandaki-flood"), prefs, now, []);
    await storeAnalysis(by("Army"), analysis("Landslide blocked river", "Nepal disaster", 5, "budhi-gandaki-flood"), prefs, now, []);
    await storeAnalysis(by("Startup"), analysis("Farm robots seed round", "Startups", 4), prefs, now, []);
    const b = await buildBriefing(u, prefs, now);
    expect(b.count).toBe(2);
  });
});
