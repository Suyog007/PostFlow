// Single source of truth for plans: the landing page, the billing page and the limits the
// server enforces all read from here. Change prices or limits in this file only.
// A "post" is one post on one platform (the same idea on LinkedIn and X counts as two).

export type PlanId = "starter" | "pro" | "agency";
export type PaidPlanId = "starter" | "pro";
export type Interval = "month" | "year";

export interface PlanFeatures {
  /** Publish reviewed posts without asking for approval first. */
  autoMode: boolean;
  /** Extra posts for rare, high-scoring breaking stories. */
  fastLane: boolean;
  /** Create posts from a link or from the user's own articles. */
  links: boolean;
}

export interface PlanQuota {
  postsPerMonth: number;
  feeds: number;
  /** Model calls per rolling 24 hours (writing, reviewing, scoring). Protects margins. */
  llmCallsPerDay: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month, billed monthly. */
  monthly: number;
  /** USD per month, billed yearly. */
  yearly: number;
  quota: PlanQuota;
  features: PlanFeatures;
  limits: string[];
  bullets: string[];
  popular?: boolean;
  /** Not available to buy yet. */
  soon?: boolean;
}

export const TRIAL_DAYS = 7;

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "A steady presence without the weekly blank page.",
    monthly: 19,
    yearly: 15,
    quota: { postsPerMonth: 60, feeds: 15, llmCallsPerDay: 80 },
    features: { autoMode: false, fastLane: false, links: false },
    limits: ["1 LinkedIn + 1 X account", "60 posts a month", "Up to 15 news feeds"],
    bullets: [
      "Posts written from your notes",
      "Reviewer checks every draft",
      "News cross-checked by two outlets",
      "Approve before anything posts",
      "Telegram alerts and notes",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For people whose posts bring in clients, hires or users.",
    monthly: 39,
    yearly: 31,
    popular: true,
    quota: { postsPerMonth: 150, feeds: 100, llmCallsPerDay: 200 },
    features: { autoMode: true, fastLane: true, links: true },
    limits: ["1 LinkedIn + 1 X account", "150 posts a month", "Up to 100 news feeds"],
    bullets: [
      "Everything in Starter",
      "Fast lane for breaking stories",
      "Posts from a link or your own articles",
      "Remembers your wording preferences",
      "Auto mode once you trust it",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "Run several founders or clients from one desk.",
    monthly: 99,
    yearly: 79,
    soon: true,
    quota: { postsPerMonth: 600, feeds: 300, llmCallsPerDay: 800 },
    features: { autoMode: true, fastLane: true, links: true },
    limits: ["Up to 5 profiles", "600 posts a month, shared", "Up to 300 news feeds"],
    bullets: ["Everything in Pro", "Separate voice and calendar per profile", "Approval per client", "Priority support"],
  },
];

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function isPaidPlan(id: string | null | undefined): id is PaidPlanId {
  return id === "starter" || id === "pro";
}

/** Stripe price lookup keys (created by `npm run stripe:setup`). */
export function priceLookupKey(plan: PaidPlanId, interval: Interval) {
  return `postflow_${plan}_${interval === "year" ? "yearly" : "monthly"}`;
}
