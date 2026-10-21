import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { log } from "../log";
import { addEvent } from "../events";
import { withUser } from "../context";
import { isPaidPlan, priceLookupKey, TRIAL_DAYS, type Interval, type PaidPlanId } from "../../lib/pricing";

// A small Stripe client over fetch: the handful of calls PostFlow needs, no SDK.

type Params = Record<string, unknown>;
type UserRow = typeof schema.users.$inferSelect;

export class BillingError extends Error {}

export function stripeConfigured() {
  return Boolean(env().STRIPE_SECRET_KEY);
}

/** Stripe's form encoding: nested objects and arrays become key[sub][0]=value. */
export function encodeForm(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" && item !== null ? encodeForm(item as Params, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") encodeForm(v as Params, key, out);
    else out.append(key, String(v));
  }
  return out;
}

type Fetcher = (method: "GET" | "POST" | "DELETE", path: string, params?: Params) => Promise<Record<string, unknown>>;

const realFetcher: Fetcher = async (method, path, params) => {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new BillingError("Payments are not set up yet.");
  const body = params ? encodeForm(params) : undefined;
  const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: method !== "GET" ? body : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) {
    log.error("stripe_error", { path, status: res.status, message: json.error?.message });
    throw new BillingError(json.error?.message ?? `Stripe returned HTTP ${res.status}`);
  }
  return json;
};

let fetcher: Fetcher = realFetcher;
export function setStripeFetcherForTests(f: Fetcher | null) {
  fetcher = f ?? realFetcher;
}
export const stripe = (method: "GET" | "POST" | "DELETE", path: string, params?: Params) => fetcher(method, path, params);

// ---------------------------------------------------------------------------
// Prices, checkout, portal
// ---------------------------------------------------------------------------

export async function priceId(plan: PaidPlanId, interval: Interval): Promise<string> {
  const res = (await stripe("GET", "/prices", { lookup_keys: [priceLookupKey(plan, interval)], active: true, limit: 1 })) as { data?: { id: string }[] };
  const id = res.data?.[0]?.id;
  if (!id) throw new BillingError("This plan is not available yet. (Run npm run stripe:setup.)");
  return id;
}

async function ensureCustomer(user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = (await stripe("POST", "/customers", { email: user.email, name: user.name || undefined, metadata: { user_id: user.id } })) as { id: string };
  await db().update(schema.users).set({ stripeCustomerId: c.id, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  return c.id;
}

const base = () => env().APP_URL.replace(/\/$/, "");

/** Stripe Checkout for a new subscription. First-time subscribers get the free trial. */
export async function createCheckout(user: UserRow, plan: PaidPlanId, interval: Interval): Promise<string> {
  if (!user.emailVerifiedAt) throw new BillingError("Confirm your email first.");
  if (user.stripeSubscriptionId && user.subscriptionStatus && !["canceled", "incomplete_expired"].includes(user.subscriptionStatus)) {
    throw new BillingError("You already have a subscription. Use Manage billing to change plans.");
  }
  const customer = await ensureCustomer(user);
  const session = (await stripe("POST", "/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: await priceId(plan, interval), quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id }, ...(user.trialUsed ? {} : { trial_period_days: TRIAL_DAYS }) },
    allow_promotion_codes: true,
    success_url: `${base()}/billing?checkout=success`,
    cancel_url: `${base()}/billing?checkout=cancelled`,
  })) as { url?: string };
  if (!session.url) throw new BillingError("Stripe did not return a checkout page.");
  return session.url;
}

/** Stripe's customer portal: change plan, update card, see invoices, cancel. */
export async function createPortal(user: UserRow): Promise<string> {
  if (!user.stripeCustomerId) throw new BillingError("There is no billing account yet. Choose a plan first.");
  const session = (await stripe("POST", "/billing_portal/sessions", { customer: user.stripeCustomerId, return_url: `${base()}/billing` })) as { url?: string };
  if (!session.url) throw new BillingError("Stripe did not return the billing portal.");
  return session.url;
}

/** Used when an account is deleted: stop billing right away. */
export async function cancelSubscriptionNow(user: UserRow) {
  if (!user.stripeSubscriptionId || user.subscriptionStatus === "canceled") return;
  await stripe("DELETE", `/subscriptions/${user.stripeSubscriptionId}`);
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.body"), with a 5 minute tolerance. */
export function verifyWebhook(rawBody: string, header: string | null, secret = env().STRIPE_WEBHOOK_SECRET, now = Date.now()): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: { user_id?: string };
  items?: { data?: { current_period_end?: number; price?: { lookup_key?: string | null; recurring?: { interval?: string } } }[] };
}

function planFromLookupKey(key: string | null | undefined): PaidPlanId | null {
  const m = key?.match(/^postflow_(starter|pro)_(monthly|yearly)$/);
  return m && isPaidPlan(m[1]) ? m[1] : null;
}

/** Copies a subscription's current state from Stripe onto the user. Always re-reads it, so event order does not matter. */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const sub = (await stripe("GET", `/subscriptions/${subscriptionId}`)) as unknown as StripeSubscription;
  const user =
    (sub.metadata?.user_id && (await db().query.users.findFirst({ where: eq(schema.users.id, sub.metadata.user_id) }))) ||
    (await db().query.users.findFirst({ where: eq(schema.users.stripeCustomerId, sub.customer) }));
  if (!user) {
    log.warn("stripe_subscription_without_user", { subscriptionId, customer: sub.customer });
    return;
  }
  const item = sub.items?.data?.[0];
  const plan = planFromLookupKey(item?.price?.lookup_key);
  const periodEnd = sub.current_period_end ?? item?.current_period_end; // moved onto items in newer API versions
  const before = user.subscriptionStatus;
  await db()
    .update(schema.users)
    .set({
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      plan: plan ?? user.plan,
      billingInterval: item?.price?.recurring?.interval === "year" ? "year" : "month",
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      trialUsed: user.trialUsed || sub.status === "trialing" || before === "trialing",
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id));
  if (before !== sub.status) {
    await withUser(user.id, () => addEvent("billing", `Subscription ${sub.status}${plan ? ` (${plan})` : ""}.`));
  }
}

/** Handles one verified webhook event. Unknown events are ignored. */
export async function handleStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }): Promise<void> {
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      if (typeof o.subscription === "string") await syncSubscription(o.subscription);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      if (typeof o.id === "string") await syncSubscription(o.id);
      return;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const sub = (o.subscription as string | undefined) ?? ((o.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription);
      if (typeof sub === "string") await syncSubscription(sub);
      return;
    }
    default:
      return;
  }
}
