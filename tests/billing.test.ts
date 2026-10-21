import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { createCheckout, encodeForm, handleStripeEvent, setStripeFetcherForTests, verifyWebhook } from "../src/server/billing/stripe";
import { me, resetDb } from "./helpers";

type Call = { method: string; path: string; params?: Record<string, unknown> };

function fakeStripe(sub: Record<string, unknown>) {
  const calls: Call[] = [];
  setStripeFetcherForTests(async (method, path, params) => {
    calls.push({ method, path, params });
    if (path === "/prices") return { data: [{ id: "price_123" }] };
    if (path === "/customers") return { id: "cus_new" };
    if (path === "/checkout/sessions") return { url: "https://checkout.stripe.test/s" };
    if (path.startsWith("/subscriptions/")) return sub;
    return {};
  });
  return calls;
}

const user = async () => (await db().query.users.findFirst({ where: eq(schema.users.id, me()) }))!;

describe("Stripe billing", () => {
  beforeEach(async () => {
    await resetDb();
    await db().update(schema.users).set({ plan: null, subscriptionStatus: null, stripeSubscriptionId: null }).where(eq(schema.users.id, me()));
  });
  afterEach(() => setStripeFetcherForTests(null));

  it("encodes nested parameters the way Stripe expects", () => {
    const f = encodeForm({ line_items: [{ price: "p", quantity: 1 }], subscription_data: { metadata: { user_id: "u" }, trial_period_days: 7 }, lookup_keys: ["a", "b"], skip: undefined });
    expect(f.toString()).toBe("line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&subscription_data%5Bmetadata%5D%5Buser_id%5D=u&subscription_data%5Btrial_period_days%5D=7&lookup_keys%5B0%5D=a&lookup_keys%5B1%5D=b");
  });

  it("verifies webhook signatures and rejects tampering and replays", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "x" });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(verifyWebhook(body + " ", `t=${t},v1=${sig}`, secret)).toBe(false);
    expect(verifyWebhook(body, `t=${t},v1=${"0".repeat(64)}`, secret)).toBe(false);
    expect(verifyWebhook(body, `t=${t},v1=${sig}`, secret, Date.now() + 10 * 60_000)).toBe(false);
    expect(verifyWebhook(body, null, secret)).toBe(false);
  });

  it("checkout includes the free trial only the first time", async () => {
    const calls = fakeStripe({});
    expect(await createCheckout(await user(), "pro", "year")).toBe("https://checkout.stripe.test/s");
    const session = calls.find((c) => c.path === "/checkout/sessions")!.params as { subscription_data: { trial_period_days?: number }; customer: string };
    expect(session.subscription_data.trial_period_days).toBe(7);
    expect(session.customer).toBe("cus_new");
    expect(calls.find((c) => c.path === "/prices")!.params).toMatchObject({ lookup_keys: ["postflow_pro_yearly"] });

    await db().update(schema.users).set({ trialUsed: true }).where(eq(schema.users.id, me()));
    const again = fakeStripe({});
    await createCheckout(await user(), "starter", "month");
    const s2 = again.find((c) => c.path === "/checkout/sessions")!.params as { subscription_data: { trial_period_days?: number } };
    expect(s2.subscription_data.trial_period_days).toBeUndefined();
  });

  it("refuses a second subscription", async () => {
    await db().update(schema.users).set({ stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }).where(eq(schema.users.id, me()));
    fakeStripe({});
    await expect(createCheckout(await user(), "pro", "month")).rejects.toThrow(/already have a subscription/);
  });

  it("webhooks copy the subscription onto the user", async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 7 * 86_400;
    fakeStripe({
      id: "sub_9",
      customer: "cus_9",
      status: "trialing",
      metadata: { user_id: me() },
      items: { data: [{ current_period_end: periodEnd, price: { lookup_key: "postflow_starter_monthly", recurring: { interval: "month" } } }] },
    });
    await handleStripeEvent({ type: "checkout.session.completed", data: { object: { subscription: "sub_9" } } });
    const u = await user();
    expect(u).toMatchObject({ plan: "starter", subscriptionStatus: "trialing", billingInterval: "month", stripeCustomerId: "cus_9", stripeSubscriptionId: "sub_9", trialUsed: true });
    expect(u.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);

    fakeStripe({ id: "sub_9", customer: "cus_9", status: "canceled", cancel_at_period_end: false, items: { data: [{ price: { lookup_key: "postflow_starter_monthly", recurring: { interval: "month" } } }] } });
    await handleStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_9" } } });
    expect((await user()).subscriptionStatus).toBe("canceled");
  });
});
