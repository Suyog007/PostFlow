import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { clear, hit, over, pruneRateLimits } from "../src/server/rate-limit";

describe("rate limits (shared through Postgres)", () => {
  beforeEach(async () => {
    await db().delete(schema.rateLimits);
  });

  it("allows up to max attempts per window, then refuses", async () => {
    for (let i = 0; i < 3; i++) expect(await hit("t:a", 3, 60_000)).toBe(false);
    expect(await hit("t:a", 3, 60_000)).toBe(true);
    expect(await over("t:a", 3)).toBe(true);
    expect(await over("t:b", 3)).toBe(false);
  });

  it("starts a fresh window once the old one has passed, and clear() resets", async () => {
    for (let i = 0; i < 5; i++) await hit("t:c", 3, 60_000);
    await db().update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) });
    expect(await over("t:c", 3)).toBe(false);
    expect(await hit("t:c", 3, 60_000)).toBe(false);
    await clear("t:c");
    expect(await over("t:c", 1)).toBe(false);
  });

  it("counts concurrent attempts exactly", async () => {
    await Promise.all(Array.from({ length: 20 }, () => hit("t:d", 100, 60_000)));
    const row = await db().query.rateLimits.findFirst({ where: (t, { eq }) => eq(t.key, "t:d") });
    expect(row?.count).toBe(20);
    await db().update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) });
    await pruneRateLimits();
    expect(await db().query.rateLimits.findFirst()).toBeUndefined();
  });
});
