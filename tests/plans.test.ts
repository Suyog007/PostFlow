import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { resetEnvCache } from "../src/server/env";
import { assertFeedQuota, assertPostQuota, entitledUsers, entitlementOf, LimitError } from "../src/server/billing/plans";
import { createRequest } from "../src/server/requests";
import { publishDue } from "../src/server/publisher";
import { saveSettings } from "../src/server/settings";
import { actAs, addUser, connectAccount, fakePlatform, me, resetDb } from "./helpers";

async function makeStarter() {
  await db().update(schema.users).set({ plan: "starter" }).where(eq(schema.users.id, me()));
}

describe("plans and limits", () => {
  beforeEach(resetDb);

  it("who is entitled", () => {
    const base = { isOwner: false, plan: "pro", subscriptionStatus: "active", emailVerifiedAt: new Date() };
    expect(entitlementOf(base).active).toBe(true);
    expect(entitlementOf({ ...base, subscriptionStatus: "trialing" }).active).toBe(true);
    expect(entitlementOf({ ...base, subscriptionStatus: "past_due" }).active).toBe(true);
    expect(entitlementOf({ ...base, subscriptionStatus: "canceled" }).active).toBe(false);
    expect(entitlementOf({ ...base, emailVerifiedAt: null }).active).toBe(false);
    expect(entitlementOf({ ...base, plan: "agency" }).active).toBe(false); // not for sale yet
    expect(entitlementOf({ isOwner: true, plan: null, subscriptionStatus: null, emailVerifiedAt: new Date() }).plan).toBe("owner");
    expect(entitlementOf({ isOwner: true, plan: null, subscriptionStatus: null, emailVerifiedAt: null }).active).toBe(false);
  });

  it("stops writing when the monthly post quota is used", async () => {
    await makeStarter();
    await db().insert(schema.posts).values(
      Array.from({ length: 60 }, (_, i) => ({ userId: me(), platform: "x", pillar: "own_work" as const, text: `p${i}`, status: "published" as const, scheduledAt: new Date(Date.now() - (i + 1) * 60_000) })),
    );
    await expect(assertPostQuota()).rejects.toThrow(/all 60 posts/);
    // Rejected drafts do not count.
    await db().update(schema.posts).set({ status: "rejected" }).where(eq(schema.posts.text, "p0"));
    await expect(assertPostQuota()).resolves.toBeUndefined();
  });

  it("Starter cannot write from links", async () => {
    await makeStarter();
    await expect(createRequest({ text: "https://example.com/article worth a post" })).rejects.toThrow(LimitError);
    await expect(createRequest({ text: "An idea about caching before measuring, in my own words." })).resolves.toBeTruthy();
  });

  it("Starter always needs approval, even if auto mode was left on", async () => {
    await saveSettings({ requireApproval: false });
    await makeStarter();
    await connectAccount("x");
    await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "own_work", text: "Unapproved", status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) });
    const sent = fakePlatform("x", () => ({ kind: "success", externalIds: ["1"] }));
    expect((await publishDue()).published).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("feed quota", async () => {
    await makeStarter();
    await db().insert(schema.sources).values(Array.from({ length: 15 }, (_, i) => ({ userId: me(), name: `f${i}`, url: `https://f${i}.example.com/rss` })));
    await expect(assertFeedQuota()).rejects.toThrow(/up to 15 feeds/);
  });

  it("the scheduler works for owners and paying users only", async () => {
    await addUser({ email: "lapsed@example.com", subscriptionStatus: "canceled" });
    await addUser({ email: "unverified@example.com", emailVerifiedAt: null });
    const owner = await addUser({ email: "admin@example.com", isOwner: true, plan: null, subscriptionStatus: null });
    const exOwner = await addUser({ email: "former@example.com", isOwner: true, plan: null, subscriptionStatus: null });
    process.env.OWNER_EMAILS = "admin@example.com";
    resetEnvCache();
    try {
      actAs(null);
      const ids = (await entitledUsers()).map((u) => u.id).sort();
      // former@example.com is still flagged in the database but no longer listed in OWNER_EMAILS.
      expect(ids).not.toContain(exOwner.id);
      expect(ids).toEqual([owner.id, (await db().query.users.findFirst({ where: eq(schema.users.email, "owner-of-tests@example.com") }))!.id].sort());
    } finally {
      delete process.env.OWNER_EMAILS;
      resetEnvCache();
    }
  });

  describe("free beta", () => {
    const withBeta = async (fn: () => Promise<void> | void) => {
      process.env.FREE_BETA = "true";
      resetEnvCache();
      try {
        await fn();
      } finally {
        delete process.env.FREE_BETA;
        resetEnvCache();
      }
    };

    it("every confirmed account gets Pro features with beta limits, and no one unconfirmed", () =>
      withBeta(() => {
        const e = entitlementOf({ isOwner: false, plan: null, subscriptionStatus: null, emailVerifiedAt: new Date() });
        expect(e).toMatchObject({ active: true, plan: "beta", features: { autoMode: true, links: true }, quota: { postsPerMonth: 60 } });
        expect(entitlementOf({ isOwner: false, plan: null, subscriptionStatus: "canceled", emailVerifiedAt: new Date() }).plan).toBe("beta");
        expect(entitlementOf({ isOwner: false, plan: null, subscriptionStatus: null, emailVerifiedAt: null }).active).toBe(false);
        // Someone already paying keeps their own plan.
        expect(entitlementOf({ isOwner: false, plan: "pro", subscriptionStatus: "active", emailVerifiedAt: new Date() }).plan).toBe("pro");
        expect(entitlementOf({ isOwner: true, plan: null, subscriptionStatus: null, emailVerifiedAt: new Date() }).plan).toBe("owner");
      }));

    it("the scheduler works for every confirmed account", () =>
      withBeta(async () => {
        const free = await addUser({ email: "free@example.com", plan: null, subscriptionStatus: null });
        const unconfirmed = await addUser({ email: "new@example.com", plan: null, subscriptionStatus: null, emailVerifiedAt: null });
        actAs(null);
        const ids = (await entitledUsers()).map((u) => u.id);
        expect(ids).toContain(free.id);
        expect(ids).not.toContain(unconfirmed.id);
      }));

    it("without the beta, an account with no plan gets nothing", () => {
      expect(entitlementOf({ isOwner: false, plan: null, subscriptionStatus: null, emailVerifiedAt: new Date() }).active).toBe(false);
    });
  });
});
