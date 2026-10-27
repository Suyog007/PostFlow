import { and, count, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { uid } from "../context";
import { BETA, planById, type PlanFeatures, type PlanQuota } from "../../lib/pricing";

/** Stripe statuses that keep the service running. past_due: Stripe is still retrying the card. */
export const ENTITLED_STATUSES = ["trialing", "active", "past_due"] as const;

export interface Entitlement {
  /** May use the app and does the scheduler work for them. */
  active: boolean;
  /** "owner" for the admin account, "beta" for everyone while FREE_BETA is on. */
  plan: "owner" | "beta" | "starter" | "pro" | null;
  quota: PlanQuota;
  features: PlanFeatures;
}

const NONE: Entitlement = {
  active: false,
  plan: null,
  quota: { postsPerMonth: 0, feeds: 0, llmCallsPerDay: 0 },
  features: { autoMode: false, fastLane: false, links: false, x: false },
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
      features: { autoMode: true, fastLane: true, links: true, x: true },
    };
  }
  const plan = planById(u.plan);
  const paying = !!u.subscriptionStatus && (ENTITLED_STATUSES as readonly string[]).includes(u.subscriptionStatus);
  if (!u.emailVerifiedAt) return NONE;
  if (env().FREE_BETA && !(paying && plan && !plan.soon)) return { active: true, plan: "beta", quota: BETA.quota, features: BETA.features };
  if (!plan || plan.soon || !paying) return NONE;
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

/**
 * The platforms to write posts for. The owner gets both, so everything can be previewed. Everyone else
 * only gets what they have connected: nothing is fetched or written for an account that cannot publish.
 */
export async function activePlatforms(userId?: string): Promise<("x" | "linkedin")[]> {
  const id = userId ?? (await uid());
  const ent = await entitlementFor(id);
  if (ent.plan === "owner") return ["linkedin", "x"];
  const rows = await db().select({ platform: schema.platformAccounts.platform }).from(schema.platformAccounts).where(and(eq(schema.platformAccounts.userId, id), eq(schema.platformAccounts.status, "connected")));
  return (["linkedin", "x"] as const).filter((p) => (p !== "x" || ent.features.x) && rows.some((r) => r.platform === p));
}

export const X_IS_PRO = "Posting to X is part of the Pro plan, which opens soon. Join the waitlist on the home page and you will hear first.";

export const CONNECT_FIRST = "Connect LinkedIn or X in Settings first. PostFlow starts writing posts once an account is connected.";

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
    throw new LimitError(`You have used all ${e.quota.postsPerMonth} posts for this month.${e.plan === "starter" ? " Upgrade to Pro for 150 a month." : e.plan === "beta" ? " That is the beta limit; the count resets on the 1st." : " The count resets on the 1st."}`);
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
  if (Number(row.n) >= e.quota.feeds) throw new LimitError(`Your plan allows up to ${e.quota.feeds} feeds. Remove one${e.plan === "beta" ? " to add another" : " or upgrade"}.`);
}

/** Users the scheduler works for: the owner, and verified users with a running subscription (everyone verified during the free beta). */
export async function entitledUsers() {
  const rows = await db()
    .select()
    .from(schema.users)
    .where(env().FREE_BETA ? isNotNull(schema.users.emailVerifiedAt) : inArray(schema.users.subscriptionStatus, [...ENTITLED_STATUSES]));
  const owners = await db().select().from(schema.users).where(eq(schema.users.isOwner, true));
  const all = new Map([...rows, ...owners].map((u) => [u.id, u]));
  return [...all.values()].filter((u) => entitlementOf(u).active);
}
