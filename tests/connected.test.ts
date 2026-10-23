import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { resetEnvCache } from "../src/server/env";
import { activePlatforms } from "../src/server/billing/plans";
import { fillCalendar } from "../src/server/generate";
import { createRequest } from "../src/server/requests";
import { runForUser } from "../src/server/tick";
import { saveSettings } from "../src/server/settings";
import { GOOD_REVIEW, addUser, fakeLLM, me, resetDb } from "./helpers";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../src/server/crypto";

const BOTH = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }, { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:15" }];
const FAST_OFF = { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x" as const], quietStart: "23:00", quietEnd: "07:00" };

async function addItems(n: number) {
  for (let i = 0; i < n; i++)
    await db().insert(schema.items).values({ userId: me(), url: `https://example.com/s${i}`, title: `Story number ${i} about ${["Postgres backups", "edge cold starts", "queue brokers", "CI runners", "auth cookies"][i % 5]}`, summary: "Something shipped.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "week", analyzedAt: new Date() });
}
const connect = (platform: "x" | "linkedin") => db().insert(schema.platformAccounts).values({ userId: me(), platform, externalUserId: "u", handle: "@me", accessTokenEnc: encryptSecret("t"), status: "connected" });

describe("only write for what can publish", () => {
  beforeEach(async () => {
    await resetDb();
    await db().delete(schema.platformAccounts);
    await saveSettings({ slots: BOTH, horizonDays: 2, fastLane: FAST_OFF, pillars: { own_work: 0, news: 1, local: 0, learning: 0 } });
  });

  it("who counts: the owner gets both, others only what they connected", async () => {
    expect(await activePlatforms()).toEqual([]);
    await connect("x");
    expect(await activePlatforms()).toEqual(["x"]);
    await db().update(schema.platformAccounts).set({ status: "error" }).where(eq(schema.platformAccounts.userId, me()));
    expect(await activePlatforms()).toEqual([]);
    const owner = await addUser({ email: "boss@example.com", isOwner: true, plan: null, subscriptionStatus: null });
    process.env.OWNER_EMAILS = "boss@example.com";
    resetEnvCache();
    try {
      expect(await activePlatforms(owner.id)).toEqual(["linkedin", "x"]);
    } finally {
      delete process.env.OWNER_EMAILS;
      resetEnvCache();
    }
  });

  it("nothing is collected, scored or written until an account is connected", async () => {
    await addItems(4);
    const calls = fakeLLM(() => GOOD_REVIEW);
    const r = await fillCalendar({ max: 5 });
    expect(r.idle).toBe("connect LinkedIn or X first");
    const run = await runForUser(me(), { budgetMs: 20_000 });
    expect(run.idle).toBe("connect LinkedIn or X first");
    expect(calls).toHaveLength(0);
    expect(await db().select().from(schema.posts)).toHaveLength(0);
    expect((await db().select().from(schema.sources)).length).toBe(0); // no default feeds either
  });

  it("with only X connected, posts are written for X and never for LinkedIn", async () => {
    await connect("x");
    await addItems(5);
    let n = 0;
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: `Acme shipped something today, take ${n++}: small teams with nightly jobs should look first.` } : GOOD_REVIEW));
    await fillCalendar({ max: 6 });
    const posts = await db().select().from(schema.posts);
    expect(posts.length).toBeGreaterThan(0);
    expect(new Set(posts.map((p) => p.platform))).toEqual(new Set(["x"]));
  });

  it("an idea sent to the bot is written only for connected platforms, and refused when none are", async () => {
    await expect(createRequest({ text: "An idea about caching before measuring, in my own words." })).rejects.toThrow(/Connect LinkedIn or X/);
    await connect("linkedin");
    const req = await createRequest({ text: "An idea about caching before measuring, in my own words." });
    expect(req.platforms).toEqual(["linkedin"]);
  });
});
