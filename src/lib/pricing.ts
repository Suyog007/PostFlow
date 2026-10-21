// Single source of truth for plans shown on the landing page. Change prices here.
// A "post" is one post on one platform (the same idea on LinkedIn and X counts as two).

export type PlanId = "starter" | "pro" | "agency";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month, billed monthly. */
  monthly: number;
  /** USD per month, billed yearly. */
  yearly: number;
  limits: string[];
  features: string[];
  popular?: boolean;
  /** Not available at launch. */
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
    limits: ["1 LinkedIn + 1 X account", "60 posts a month", "Up to 5 news feeds"],
    features: [
      "Posts written from your notes",
      "Reviewer checks every draft",
      "Approve before anything posts",
      "Calendar with edit, move and remove",
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
    limits: ["1 LinkedIn + 1 X account", "150 posts a month", "Unlimited news feeds"],
    features: [
      "Everything in Starter",
      "News cross-checked by two outlets",
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
    limits: ["Up to 5 profiles", "600 posts a month, shared", "Unlimited news feeds"],
    features: ["Everything in Pro", "Separate voice and calendar per profile", "Approval per client", "Priority support"],
  },
];
