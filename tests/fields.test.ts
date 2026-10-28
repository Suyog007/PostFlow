import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { settingsSchema, getSettings, saveSettings } from "../src/server/settings";
import { analystSystem, reviewerSystem, writerSystem, profileBlock } from "../src/server/prompts";
import { gate, moveText } from "../src/server/generate";
import { starterSources, syncTopicFeeds } from "../src/server/collect";
import { completeWelcome } from "../src/server/welcome";
import { normalizeUrl } from "../src/server/net";
import { DEFAULT_SOURCES } from "../src/server/sources-default";
import { FIELD_IDS, fieldOf } from "../src/lib/fields";
import { GOOD_REVIEW, me, resetDb } from "./helpers";

const as = (field: string, extra: Record<string, unknown> = {}) => settingsSchema.parse({ profile: { field, role: "x", expertise: ["glaucoma", "cataract surgery"], ...extra } });

describe("fields other than tech", () => {
  it("tech keeps the original wording", () => {
    const tech = settingsSchema.parse({});
    expect(tech.profile.field).toBe("tech");
    expect(analystSystem(tech)).toMatch(/OPPORTUNITY for builders/);
    expect(analystSystem(tech)).toContain("(developers, builders, founders)");
    expect(writerSystem(tech, "linkedin")).toMatch(/a busy developer or founder/);
    expect(writerSystem(tech, "linkedin")).not.toMatch(/never break these/);
    expect(profileBlock(tech)).not.toMatch(/Field:/);
  });

  it("a doctor's prompts are about medicine, with no developer wording", () => {
    const s = as("health", { region: "Kathmandu" });
    const all = [analystSystem(s), writerSystem(s, "linkedin"), reviewerSystem(s)].join("\n");
    expect(all).not.toMatch(/developer|builders/i);
    expect(analystSystem(s)).toMatch(/recall or safety warning/);
    expect(analystSystem(s)).toContain("the Kathmandu medical community");
    expect(writerSystem(s, "linkedin")).toMatch(/Never give medical advice/);
    expect(writerSystem(s, "linkedin")).toMatch(/General information, not medical advice/);
    expect(reviewerSystem(s)).toMatch(/rule_breaks/);
    expect(profileBlock(s)).toMatch(/Field: Healthcare & medicine/);
  });

  it("the owner's own description of their readers wins", () => {
    const s = as("health", { audience: "patients and other eye doctors" });
    expect(analystSystem(s)).toContain("(patients and other eye doctors)");
  });

  it("an accountant must name the country; a lawyer the jurisdiction", () => {
    expect(writerSystem(as("finance"), "x")).toMatch(/which country, regulator or standard/);
    expect(writerSystem(as("law"), "x")).toMatch(/jurisdiction/);
  });

  it("moves and lesson ideas use the field's words", () => {
    expect(moveText("plain", as("health"))).toMatch(/outside medicine/);
    expect(moveText("guess", as("finance"))).toMatch(/businesses or clients/);
    expect(moveText("plain", settingsSchema.parse({}))).toMatch(/outside tech/);
  });

  it("a broken field rule blocks the post", () => {
    const m = { kind: "news", pillar: "news", source: "x", label: "x", firstPerson: false } as Parameters<typeof gate>[2];
    const v = gate({ ...GOOD_REVIEW, rule_breaks: ["Tells a reader to stop their eye drops."] } as Parameters<typeof gate>[0], [], m);
    expect(v.approved).toBe(false);
    expect(v.reasons).toContain("Breaks a field rule: Tells a reader to stop their eye drops.");
  });

  it("an unknown field falls back to tech", () => {
    expect(settingsSchema.parse({ profile: { field: "astrology" } }).profile.field).toBe("tech");
    expect(fieldOf("nope").id).toBe("tech");
    for (const id of FIELD_IDS) expect(fieldOf(id).label.length).toBeGreaterThan(2);
  });
});

describe("starting feeds by field", () => {
  beforeEach(resetDb);

  it("tech gets the curated list; other fields get their own known feeds", () => {
    expect(starterSources(settingsSchema.parse({}))).toBe(DEFAULT_SOURCES);
    const health = starterSources(as("health"));
    expect(health.some((f) => f.name === "STAT News")).toBe(true);
    expect(health.some((f) => /hnrss|techcrunch/.test(f.url))).toBe(false);
  });

  it("every field, tech included, gets a news search for each topic, once", async () => {
    await saveSettings({ profile: { ...(await getSettings()).profile, field: "tech", role: "Blockchain engineer", expertise: ["Solidity", "Ethereum", "Rust"] } });
    expect(await syncTopicFeeds()).toBe(3);
    const names = async () => (await db().select().from(schema.sources).where(eq(schema.sources.userId, me()))).map((f) => f.name);
    expect(await names()).toEqual(expect.arrayContaining(["News: Solidity", "News: Ethereum", "News: Rust"]));
    // Deleted by the owner: never added back.
    await db().delete(schema.sources).where(eq(schema.sources.name, "News: Rust"));
    expect(await syncTopicFeeds()).toBe(0);
    expect(await names()).not.toContain("News: Rust");
    // A new topic gets its own feed.
    await saveSettings({ profile: { ...(await getSettings()).profile, expertise: ["Solidity", "Ethereum", "Rust", "zero-knowledge proofs"] } });
    expect(await syncTopicFeeds()).toBe(1);
    expect(await names()).toContain("News: zero-knowledge proofs");
  });

  it("the welcome step saves the field and seeds that field's feeds", async () => {
    const r = await completeWelcome({ field: "finance", role: "Chartered accountant", expertise: "VAT, payroll, audit", audience: "small-business owners in Nepal" });
    expect(r.ok).toBe(true);
    expect((await getSettings()).profile).toMatchObject({ field: "finance", audience: "small-business owners in Nepal" });
    const feeds = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    expect(feeds.map((f) => f.name)).toEqual(expect.arrayContaining(["CNBC Finance", "News: VAT", "News: payroll", "News: audit"]));
    expect(feeds.some((f) => f.url.includes("hnrss"))).toBe(false);
  });

  it("news search links resolve to the article itself", () => {
    expect(normalizeUrl("http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=1&url=https%3a%2f%2fwww.statnews.com%2f2026%2f10%2f27%2fstory%2f&c=1")).toBe("https://www.statnews.com/2026/10/27/story");
  });
});
