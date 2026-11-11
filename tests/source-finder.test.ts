import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { saveSettings } from "../src/server/settings";
import { setFeedFetchForTests } from "../src/server/feed-discover";
import { findSources, rankByMatch } from "../src/server/source-finder";
import { evaluate } from "../src/server/verify";
import { CATALOG, catalogFor, medrxivFeed } from "../src/lib/source-catalog";
import { fakeLLM, me, resetDb } from "./helpers";

const FEED = (title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><title>x</title></item></channel></rss>`;

describe("the source list", () => {
  it("has at least ten sources per field, each a unique https address", () => {
    for (const [field, list] of Object.entries(CATALOG)) {
      expect(list.length, field).toBeGreaterThanOrEqual(10);
      expect(new Set(list.map((x) => x.id)).size, field).toBe(list.length);
      for (const x of list) expect(x.url, x.name).toMatch(/^https:\/\//);
    }
  });

  it("includes journals or research for every field", () => {
    for (const [field, list] of Object.entries(CATALOG)) {
      if (field === "other") continue;
      expect(list.some((x) => x.kind === "journal" || x.kind === "research"), field).toBe(true);
    }
  });

  it("puts sources matching the person's specialty first", () => {
    const ranked = rankByMatch(catalogFor("health"), ["ophthalmology", "glaucoma"]);
    expect(ranked[0].tags).toContain("ophthalmology");
  });

  it("treats a journal as the original source of its own findings", () => {
    const v = evaluate({ url: "https://www.nejm.org/doi/full/10.1056/x", title: "Trial of a new glaucoma drop", summary: "" }, []);
    expect(v.primary).toBe(true);
  });
});

describe("finding sources for a new account", () => {
  beforeEach(async () => {
    await resetDb();
    await saveSettings({ profile: { ...(await import("../src/server/settings")).settingsSchema.parse({}).profile, field: "health", role: "Eye doctor", expertise: ["glaucoma", "children's eyes"], region: "Nepal" } });
  });
  afterEach(() => setFeedFetchForTests(null));

  it("adds only the picks whose feeds really work, labelled by kind", async () => {
    const list = catalogFor("health");
    const ophth = list.find((x) => x.id === "jama-ophthalmology")!;
    const lancet = list.find((x) => x.id === "the-lancet")!;
    const broken = list.find((x) => x.id === "the-bmj")!;
    const subject = medrxivFeed("Ophthalmology");
    fakeLLM(() => ({ picks: [ophth.id, lancet.id, broken.id, "made-up-id"], extra: [], medrxiv_subjects: ["Ophthalmology", "Not a subject"], arxiv_queries: [] }));
    const working = new Set([ophth.url, lancet.url, subject.url]);
    setFeedFetchForTests(async (url) => (working.has(url) ? { url, type: "application/rss+xml", body: FEED("x") } : null));

    const r = await findSources({ target: 10 });
    expect(r.added).toBe(3);
    const rows = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    const names = rows.map((x) => x.name);
    expect(names).toContain("JAMA Ophthalmology · Journal");
    expect(names).toContain("medRxiv: Ophthalmology · Research");
    expect(rows.some((x) => x.url === broken.url)).toBe(false);
  });

  it("never goes over the plan's feed limit, and running again adds nothing twice", async () => {
    fakeLLM(() => ({ picks: catalogFor("health").map((x) => x.id), extra: [], medrxiv_subjects: [], arxiv_queries: [] }));
    setFeedFetchForTests(async (url) => ({ url, type: "application/rss+xml", body: FEED("x") }));
    const first = await findSources({ target: 18 });
    expect(first.added).toBe(18);
    const again = await findSources({ target: 18 });
    const rows = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    expect(new Set(rows.map((x) => x.url)).size).toBe(rows.length);
    expect(rows.length).toBe(18 + again.added);
  });
});
