import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { isRecentlySeen, ACTIVE_WITHIN_DAYS } from "../src/server/tick";
import { markSeen } from "../src/server/users";
import { me, resetDb } from "./helpers";

const DAY = 86_400_000;

describe("autopilot only writes for people who use PostFlow", () => {
  beforeEach(resetDb);

  it("counts a visit in the last week, and a new account", () => {
    const now = Date.now();
    expect(isRecentlySeen({ lastSeenAt: new Date(now - 2 * DAY), createdAt: new Date(now - 30 * DAY) }, now)).toBe(true);
    expect(isRecentlySeen({ lastSeenAt: new Date(now - (ACTIVE_WITHIN_DAYS + 1) * DAY), createdAt: new Date(now - 30 * DAY) }, now)).toBe(false);
    expect(isRecentlySeen({ lastSeenAt: null, createdAt: new Date(now - DAY) }, now)).toBe(true);
    expect(isRecentlySeen({ lastSeenAt: null, createdAt: new Date(now - 30 * DAY) }, now)).toBe(false);
  });

  it("records a visit at most once an hour", async () => {
    const u = (await db().query.users.findFirst({ where: eq(schema.users.id, me()) }))!;
    await markSeen(u);
    const first = (await db().query.users.findFirst({ where: eq(schema.users.id, me()) }))!.lastSeenAt!;
    expect(first).toBeInstanceOf(Date);
    await markSeen({ id: me(), lastSeenAt: first });
    const again = (await db().query.users.findFirst({ where: eq(schema.users.id, me()) }))!.lastSeenAt!;
    expect(again.getTime()).toBe(first.getTime());
  });
});
