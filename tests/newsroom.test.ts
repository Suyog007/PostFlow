import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { settingsSchema } from "../src/server/settings";
import { newsroomStatus } from "../src/server/newsroom";
import { me, resetDb } from "./helpers";

const s = settingsSchema.parse({});
const fresh = { beat: new Date() };

describe("what autopilot is doing", () => {
  beforeEach(resetDb);

  it("says it is paused", async () => {
    expect((await newsroomStatus(me(), { ...s, paused: true }, fresh)).state).toBe("paused");
  });

  it("says when the scheduler has not run for a while", async () => {
    expect((await newsroomStatus(me(), s, { beat: new Date(Date.now() - 3_600_000) })).state).toBe("stalled");
    expect((await newsroomStatus(me(), s, { beat: null })).state).toBe("stalled");
  });

  it("says it is starting before any feed has been read", async () => {
    const r = await newsroomStatus(me(), s, fresh);
    expect(r.state).toBe("starting");
    expect(r.detail).toMatch(/You don't need to do anything/);
  });

  it("reports stories read, strong ones and drafts held back", async () => {
    const [src] = await db().insert(schema.sources).values({ userId: me(), name: "Feed", url: "https://e.com/rss", lastFetchedAt: new Date() }).returning();
    await db().insert(schema.items).values([
      { userId: me(), sourceId: src.id, url: "https://e.com/1", title: "Big story here", publishedAt: new Date(), relevance: 9, analyzedAt: new Date() },
      { userId: me(), sourceId: src.id, url: "https://e.com/2", title: "Small story here", publishedAt: new Date(), relevance: 3, analyzedAt: new Date() },
    ]);
    await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "news", text: "x", status: "rejected", scheduledAt: new Date() });
    const r = await newsroomStatus(me(), s, fresh);
    expect(r.state).toBe("working");
    expect(r.detail).toMatch(/^Read 2 new stories from 1 source in the last 24 hours, 1 strong enough to post, 1 draft held back by the fact-checker\./);
  });
});
