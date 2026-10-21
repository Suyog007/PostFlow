"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { BillingError, createCheckout, createPortal } from "@/server/billing/stripe";
import { isPaidPlan, type Interval } from "@/lib/pricing";
import { log } from "@/server/log";

function fail(err: unknown): never {
  const msg = err instanceof BillingError ? err.message : "Billing is unavailable right now. Please try again.";
  if (!(err instanceof BillingError)) log.error("billing_action_failed", { error: (err as Error).message });
  redirect(`/billing?error=${encodeURIComponent(msg)}`);
}

export async function checkoutAction(form: FormData) {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify-email");
  const plan = String(form.get("plan"));
  const interval: Interval = form.get("interval") === "month" ? "month" : "year";
  if (!isPaidPlan(plan)) redirect("/billing?error=Pick%20a%20plan.");
  let url: string;
  try {
    url = await createCheckout(user, plan, interval);
  } catch (err) {
    fail(err);
  }
  redirect(url);
}

export async function portalAction() {
  const user = await requireUser();
  let url: string;
  try {
    url = await createPortal(user);
  } catch (err) {
    fail(err);
  }
  redirect(url);
}
