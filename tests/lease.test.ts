import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { acquireLease, releaseLease, withLease } from "../src/server/lease";

describe("leases (scheduler and per-account locks)", () => {
  beforeEach(async () => {
    await db().delete(schema.leases);
  });

  it("only one holder at a time, and only the holder can release", async () => {
    const a = await acquireLease("x", 60_000);
    expect(a).toBeTruthy();
    expect(await acquireLease("x", 60_000)).toBeNull();
    await releaseLease("x", "someone-else");
    expect(await acquireLease("x", 60_000)).toBeNull();
    await releaseLease("x", a!);
    expect(await acquireLease("x", 60_000)).toBeTruthy();
  });

  it("an expired lease (its holder died) can be taken over", async () => {
    await acquireLease("y", 60_000);
    await db().update(schema.leases).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await acquireLease("y", 60_000)).toBeTruthy();
  });

  it("concurrent callers: exactly one wins", async () => {
    const got = await Promise.all(Array.from({ length: 10 }, () => acquireLease("z", 60_000)));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("withLease runs once, returns null when taken, and releases even when fn throws", async () => {
    let inner: unknown = "unset";
    const outer = await withLease("w", 60_000, async () => {
      inner = await withLease("w", 60_000, async () => "nested");
      return "outer";
    });
    expect(outer).toBe("outer");
    expect(inner).toBeNull();
    await expect(withLease("w", 60_000, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withLease("w", 60_000, async () => "free again")).toBe("free again");
  });
});
