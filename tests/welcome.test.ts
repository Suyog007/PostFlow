import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { getSettings, settingsSchema } from "../src/server/settings";
import { completeWelcome, needsWelcome, splitTopics } from "../src/server/welcome";
import { discoverFeed, normalizeInput, setFeedFetchForTests } from "../src/server/feed-discover";
import { analystSystem } from "../src/server/prompts";
import { DEFAULT_SOURCES } from "../src/server/sources-default";
import { me, resetDb } from "./helpers";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>The Go Blog</title><item><title>x</title></item></channel></rss>`;
const HOME = `<html><head><title>Go Blog</title><link rel="alternate" type="application/atom+xml" href="/blog/feed.atom"></head><body>hi</body></html>`;

/** A tiny fake web: url -> page. */
function web(pages: Record<string, { type: string; body: string }>) {
  setFeedFetchForTests(async (url) => (pages[url] ? { url, ...pages[url] } : null));
}

describe("finding a feed from a pasted link", () => {
  afterEach(() => setFeedFetchForTests(null));

  it("accepts a feed link as is", async () => {
    web({ "https://go.dev/blog/feed.atom": { type: "application/atom+xml", body: RSS } });
    expect(await discoverFeed("https://go.dev/blog/feed.atom")).toEqual({ url: "https://go.dev/blog/feed.atom", name: "The Go Blog" });
  });

  it("finds the feed a homepage announces, even without https://", async () => {
    web({
      "https://go.dev/blog": { type: "text/html", body: HOME },
      "https://go.dev/blog/feed.atom": { type: "application/xml", body: RSS },
    });
    expect((await discoverFeed("go.dev/blog"))?.url).toBe("https://go.dev/blog/feed.atom");
  });

  it("tries common feed addresses when the page announces none", async () => {
    web({
      "https://myblog.dev/": { type: "text/html", body: "<html><title>My blog</title></html>" },
      "https://myblog.dev/rss.xml": { type: "text/xml", body: RSS },
    });
    expect((await discoverFeed("https://myblog.dev/"))?.url).toBe("https://myblog.dev/rss.xml");
  });

  it("turns a subreddit into its feed", () => {
    expect(normalizeInput("reddit.com/r/golang")).toBe("https://reddit.com/r/golang/.rss");
  });

  it("gives up on pages with no feed and on private addresses", async () => {
    web({ "https://nofeed.dev/": { type: "text/html", body: "<html></html>" } });
    expect(await discoverFeed("https://nofeed.dev/")).toBeNull();
    expect(await discoverFeed("http://localhost:3000")).toBeNull();
    expect(await discoverFeed("http://192.168.1.1/feed")).toBeNull();
  });
});

describe("welcome step", () => {
  beforeEach(resetDb);
  afterEach(() => setFeedFetchForTests(null));

  it("is needed until role and topics are given", () => {
    expect(needsWelcome(settingsSchema.parse({}))).toBe(true);
    expect(needsWelcome(settingsSchema.parse({ profile: { role: "Engineer" } }))).toBe(true);
    expect(needsWelcome(settingsSchema.parse({ profile: { role: "Engineer", expertise: ["Go"] } }))).toBe(false);
  });

  it("splits topics on commas, semicolons and lines, without duplicates", () => {
    expect(splitTopics("Go, payments;\nPostgres, Go ,  ")).toEqual(["Go", "payments", "Postgres"]);
  });

  it("asks for a role and at least two topics", async () => {
    expect(await completeWelcome({ role: "", expertise: "Go, payments" })).toMatchObject({ ok: false, error: /role/ });
    expect(await completeWelcome({ role: "Backend engineer", expertise: "Go" })).toMatchObject({ ok: false, error: /two topics/ });
  });

  it("saves the profile, adds the default feeds and the user's own", async () => {
    web({
      "https://go.dev/blog": { type: "text/html", body: HOME },
      "https://go.dev/blog/feed.atom": { type: "application/xml", body: RSS },
    });
    const r = await completeWelcome({ role: "Backend engineer", expertise: "Go, payments, Postgres", region: "Kathmandu", feeds: ["go.dev/blog", ""] });
    expect(r).toEqual({ ok: true, added: ["The Go Blog"] });
    const s = await getSettings();
    expect(s.profile).toMatchObject({ role: "Backend engineer", expertise: ["Go", "payments", "Postgres"], region: "Kathmandu" });
    const feeds = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    expect(feeds).toHaveLength(DEFAULT_SOURCES.length + 1);
    expect(feeds.some((f) => f.url === "https://go.dev/blog/feed.atom")).toBe(true);
  });

  it("saves nothing when a pasted source has no feed", async () => {
    web({});
    const r = await completeWelcome({ role: "Backend engineer", expertise: "Go, payments", feeds: ["notafeed.example.com"] });
    expect(r).toMatchObject({ ok: false, error: /No news feed found/ });
    expect((await getSettings()).profile.role).toBe("");
    expect(await db().select().from(schema.sources).where(eq(schema.sources.userId, me()))).toHaveLength(0);
  });

  it("works with no sources at all", async () => {
    expect(await completeWelcome({ role: "Frontend engineer", expertise: "React, accessibility" })).toEqual({ ok: true, added: [] });
  });
});

describe("story scoring follows expertise", () => {
  it("names the owner's topics and ranks them first", () => {
    const sys = analystSystem(settingsSchema.parse({ profile: { expertise: ["Go", "payments"] } }));
    expect(sys).toContain("decides the order: Go, payments.");
    expect(sys).toMatch(/2 points higher/);
  });
  it("falls back to the general audience without topics", () => {
    expect(analystSystem(settingsSchema.parse({}))).toContain("none given yet");
  });
});
