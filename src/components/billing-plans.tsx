"use client";

import { useState } from "react";
import { PLANS, TRIAL_DAYS, type Interval } from "@/lib/pricing";
import { checkoutAction } from "@/app/billing-actions";
import { Icon } from "./ui";

/** Plan picker that starts Stripe Checkout. */
export function BillingPlans({ initialPlan, initialInterval = "year", trialAvailable, disabled }: { initialPlan?: string; initialInterval?: Interval; trialAvailable: boolean; disabled?: string }) {
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const plans = PLANS.filter((p) => !p.soon);
  return (
    <div>
      {disabled && <p role="status" className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-center text-[13px] text-[var(--warn)]">{disabled} Checkout opens as soon as it is.</p>}
      <div className="mb-6 flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 text-[13px] font-medium">
          {(["month", "year"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={interval === v} onClick={() => setInterval(v)} className={`flex h-8 items-center gap-2 rounded-full px-4 ${interval === v ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
              {v === "month" ? "Monthly" : "Yearly"}
              {v === "year" && <span className={`rounded-full px-1.5 py-px text-[11px] ${interval === "year" ? "bg-[var(--bg)]/15" : "bg-[var(--good-soft)] text-[var(--good)]"}`}>Save 20%</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const selected = initialPlan ? initialPlan === p.id : !!p.popular;
          const price = interval === "year" ? p.yearly : p.monthly;
          return (
            <form key={p.id} action={checkoutAction} className={`flex flex-col rounded-2xl border bg-[var(--surface)] p-6 ${selected ? "border-[var(--ink)]" : "border-[var(--line)]"}`}>
              <input type="hidden" name="plan" value={p.id} />
              <input type="hidden" name="interval" value={interval} />
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-semibold">{p.name}</h2>
                {p.popular && <span className="badge badge-accent">Most popular</span>}
              </div>
              <p className="mt-1 text-[14px] text-[var(--muted)]">{p.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-[34px] font-semibold tracking-tight tnum">${price}</span>
                <span className="text-[14px] text-[var(--muted)]">/ month</span>
              </div>
              <p className="text-[12px] text-[var(--subtle)]">{interval === "year" ? `$${p.yearly * 12} billed yearly` : "Billed monthly"}</p>
              <ul className="mt-4 flex-1 space-y-2 text-[14px]">
                {[...p.limits, ...p.bullets.filter((b) => !b.startsWith("Everything"))].map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Icon name="check" size={16} className="mt-0.5 flex-none text-[var(--good)]" />
                    {f}
                  </li>
                ))}
              </ul>
              <button className={`btn mt-6 h-10 text-[14px] ${selected ? "btn-primary" : ""}`} disabled={!!disabled} title={disabled}>
                {trialAvailable ? `Start ${TRIAL_DAYS}-day free trial` : `Subscribe to ${p.name}`}
              </button>
            </form>
          );
        })}
      </div>
      <p className="mt-4 text-center text-[12px] text-[var(--subtle)]">
        {trialAvailable ? `You will not be charged during the ${TRIAL_DAYS}-day trial. Cancel any time before it ends and you pay nothing. ` : ""}
        Payments are handled by Stripe. Prices in USD; tax may be added at checkout.
      </p>
    </div>
  );
}
