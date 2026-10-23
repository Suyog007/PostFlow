import { and, count, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { uid } from "../context";
import { planById, type PlanFeatures, type PlanQuota } from "../../lib/pricing";

/** Stripe statuses that keep the service running. past_due: Stripe is still retrying the card. */
export const ENTITLED_STATUSES = ["trialing", "active", "past_due"] as const;

export interface Entitlement {
  /** May use the app and does the scheduler work for them. */
  active: boolean;
  /** "owner" for the admin account. */
  plan: "owner" | "starter" | "pro" | null;
  quota: PlanQuota;
  features: PlanFeatures;
}

const NONE: Entitlement = {
  active: false,
  plan: null,
  quota: { postsPerMonth: 0, feeds: 0, llmCallsPerDay: 0 },
  features: { autoMode: false, fastLane: false, links: false },
};

type UserRow = typeof schema.users.$inferSelect;

/** Owner status follows OWNER_EMAILS on every check, so removing an email takes effect at once.
 *  The placeholder that holds data from the single-user version stays active until the owner claims it. */
function isOwnerNow(u: { isOwner: boolean; email?: string }) {
  if (!u.isOwner) return false;
  if (u.email === undefined || u.email === "owner@postflow.invalid") return true;
  return env().OWNER_EMAILS.includes(u.email.toLowerCase());
}

export function entitlementOf(u: Pick<UserRow, "isOwner" | "plan" | "subscriptionStatus" | "emailVerifiedAt"> & { email?: string }): Entitlement {
  if (isOwnerNow(u) && u.emailVerifiedAt) {
    return {
      active: true,
      plan: "owner",
      quota: { postsPerMonth: 100_000, feeds: 1_000, llmCallsPerDay: env().MAX_LLM_CALLS_PER_DAY },
      features: { autoMode: true, fastLane: true, links: true },
    };
  }
  const plan = planById(u.plan);
  const paying = !!u.subscriptionStatus && (ENTITLED_STATUSES as readonly string[]).includes(u.subscriptionStatus);
  if (!plan || plan.soon || !paying || !u.emailVerifiedAt) return NONE;
  return { active: true, plan: plan.id as "starter" | "pro", quota: plan.quota, features: plan.features };
}

/** Without auto mode (Starter), approval is always required. */
export function approvalGate(s: { requireApproval: boolean }, autoMode: boolean) {
  return { blocks: !autoMode || s.requireApproval };
}

export async function entitlementFor(userId: string): Promise<Entitlement> {
  const u = await db().query.users.findFirst({ where: eq(schema.users.id, userId) });
  return u ? entitlementOf(u) : NONE;
}

export class LimitError extends Error {}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Posts that count against the monthly quota: everything written this month except what the reviewer rejected. */
export async function postsThisMonth(userId?: string): Promise<number> {
  const id = userId ?? (await uid());
  const [row] = await db()
    .select({ n: count() })
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, id), gte(schema.posts.createdAt, monthStart()), ne(schema.posts.status, "rejected")));
  return Number(row.n);
}

/** Throws a LimitError with an upgrade hint when the user has used this month's posts. */
export async function assertPostQuota(): Promise<void> {
  const userId = await uid();
  const e = await entitlementFor(userId);
  if (!e.active) throw new LimitError("Your subscription is not active. Choose a plan on the Billing page.");
  const used = await postsThisMonth(userId);
  if (used >= e.quota.postsPerMonth) {
    throw new LimitError(`You have used all ${e.quota.postsPerMonth} posts for this month.${e.plan === "starter" ? " Upgrade to Pro for 150 a month." : " The count resets on the 1st."}`);
  }
}

export async function assertFeature(feature: keyof PlanFeatures, label: string): Promise<void> {
  const e = await entitlementFor(await uid());
  if (!e.features[feature]) throw new LimitError(`${label} is part of the Pro plan.`);
}

/** Feeds the user added (the hidden "Your tips" feed does not count). */
export async function assertFeedQuota(): Promise<void> {
  const userId = await uid();
  const e = await entitlementFor(userId);
  const [row] = await db()
    .select({ n: count() })
    .from(schema.sources)
    .where(and(eq(schema.sources.userId, userId), ne(schema.sources.url, "tips://manual")));
  if (Number(row.n) >= e.quota.feeds) throw new LimitError(`Your plan allows up to ${e.quota.feeds} feeds. Remove one or upgrade.`);
}

/** Users the scheduler works for: the owner, and verified users with a running subscription. */
export async function entitledUsers() {
  const rows = await db()
    .select()
    .from(schema.users)
    .where(inArray(schema.users.subscriptionStatus, [...ENTITLED_STATUSES]));
  const owners = await db().select().from(schema.users).where(eq(schema.users.isOwner, true));
  const all = new Map([...rows, ...owners].map((u) => [u.id, u]));
  return [...all.values()].filter((u) => entitlementOf(u).active);
}
