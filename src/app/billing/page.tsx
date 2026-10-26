import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { entitlementOf, postsThisMonth } from "@/server/billing/plans";
import { stripeConfigured } from "@/server/billing/stripe";
import { BillingPlans } from "@/components/billing-plans";
import { Logo } from "@/components/ui";
import { planById, type Interval } from "@/lib/pricing";
import { portalAction } from "../billing-actions";
import { logoutAction } from "../auth-actions";

export const metadata: Metadata = { title: "Billing · PostFlow" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed: Stripe is retrying your card",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Waiting for payment",
  incomplete_expired: "Checkout expired",
  paused: "Paused",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ plan?: string; interval?: string; checkout?: string; error?: string }> }) {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify-email");
  const sp = await searchParams;
  const ent = entitlementOf(user);
  const plan = planById(user.plan);
  const fmt = (d: Date | null) => (d ? DateTime.fromJSDate(d).toFormat("d LLL yyyy") : "");
  const subscribed = !!user.subscriptionStatus && !["canceled", "incomplete_expired"].includes(user.subscriptionStatus);
  const waitingForWebhook = sp.checkout === "success" && !subscribed;
  const used = ent.plan && ent.plan !== "owner" ? await postsThisMonth(user.id) : null;

  return (
    <div className="min-h-screen">
      {waitingForWebhook && <meta httpEquiv="refresh" content="3" />}
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[960px] items-center gap-4 px-4">
          <Link href={ent.active ? "/calendar" : "/"} className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-semibold">PostFlow</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-[13px]">
            {ent.active && <Link href="/calendar" className="btn btn-ghost btn-sm">Open app</Link>}
            <Link href="/account" className="btn btn-ghost btn-sm">Account</Link>
            <form action={logoutAction}><button className="btn btn-ghost btn-sm">Sign out</button></form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[960px] px-4 py-10">
        <h1 className="display text-[34px]">Billing</h1>
        {sp.error && <p role="alert" className="mt-4 rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{sp.error}</p>}
        {sp.checkout === "cancelled" && <p className="mt-4 rounded-md bg-[var(--side)] px-3 py-2 text-[13px] text-[var(--muted)]">Checkout cancelled. Nothing was charged.</p>}
        {waitingForWebhook && <p role="status" className="mt-4 rounded-md bg-[var(--accent-soft)] px-3 py-2 text-[13px] text-[var(--accent)]">Payment received. Finishing setup, this page refreshes in a moment…</p>}

        {ent.plan === "owner" ? (
          <div className="panel mt-6 p-5">
            <p className="font-medium">Owner account</p>
            <p className="mt-1 text-[14px] text-[var(--muted)]">Your email is listed in OWNER_EMAILS, so this account has every feature and is never billed.</p>
            <Link href="/calendar" className="btn btn-primary mt-4">Open the app</Link>
          </div>
        ) : subscribed ? (
          <div className="panel mt-6 p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[var(--muted)]">Current plan</p>
                <p className="text-[20px] font-semibold">{plan?.name ?? "PostFlow"} <span className="text-[14px] font-normal text-[var(--muted)]">· {user.billingInterval === "year" ? "yearly" : "monthly"}</span></p>
                <p className={`mt-1 text-[14px] ${user.subscriptionStatus === "past_due" ? "text-[var(--bad)]" : "text-[var(--muted)]"}`}>
                  {STATUS[user.subscriptionStatus!] ?? user.subscriptionStatus}
                  {user.currentPeriodEnd && (user.cancelAtPeriodEnd ? ` · ends ${fmt(user.currentPeriodEnd)}` : user.subscriptionStatus === "trialing" ? ` · first charge ${fmt(user.currentPeriodEnd)}` : ` · renews ${fmt(user.currentPeriodEnd)}`)}
                </p>
                {used !== null && <p className="mt-3 text-[14px]"><span className="font-medium tnum">{used}</span> of {ent.quota.postsPerMonth} posts used this month</p>}
              </div>
              <form action={portalAction}><button className="btn btn-primary">Manage billing</button></form>
            </div>
            <p className="mt-4 text-[12px] text-[var(--subtle)]">Change plan, update your card, download invoices or cancel in the Stripe billing portal.</p>
            {!ent.active && <p className="mt-3 text-[13px] text-[var(--bad)]">Posting is paused until the subscription is active again.</p>}
          </div>
        ) : (
          <div className="mt-6">
            <p className="mb-6 text-[15px] text-[var(--muted)]">
              {user.trialUsed ? "Choose a plan to turn autopilot back on." : "Pick a plan to start your free trial. You can switch plans or cancel at any time."}
            </p>
            <BillingPlans
              initialPlan={sp.plan}
              initialInterval={(sp.interval === "month" ? "month" : "year") as Interval}
              trialAvailable={!user.trialUsed}
              disabled={stripeConfigured() ? undefined : "Payments are not set up yet."}
            />
          </div>
        )}
      </main>
    </div>
  );
}
