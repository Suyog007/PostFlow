import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { collectFeeds, setFeedFetcherForTests } from "../src/server/collect";
import { me, resetDb } from "./helpers";

const RSS = (title: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title><item><title>${title}</title><link>https://news.example.com/a</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

describe("reading feeds", () => {
  beforeEach(resetDb);
  afterEach(() => setFeedFetcherForTests(async () => { throw new Error("no network in tests"); }));

  it("parses the text the downloader returns (which has already unpacked gzip)", async () => {
    await db().insert(schema.sources).values({ userId: me(), name: "DeepMind", url: "https://deepmind.example.com/rss.xml" });
    setFeedFetcherForTests(async () => RSS("A new model that reads proteins faster"));
    const r = await collectFeeds();
    expect(r).toMatchObject({ fetched: 1, inserted: 1, errors: 0 });
    const [src] = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    expect(src.lastError).toBeNull();
  });

  it("records a failing feed's error and carries on", async () => {
    await db().insert(schema.sources).values({ userId: me(), name: "Broken", url: "https://broken.example.com/rss.xml" });
    setFeedFetcherForTests(async () => { throw new Error("Feed returned HTTP 503"); });
    const r = await collectFeeds();
    expect(r.errors).toBe(1);
    const [src] = await db().select().from(schema.sources).where(eq(schema.sources.userId, me()));
    expect(src.lastError).toBe("Feed returned HTTP 503");
  });
});
