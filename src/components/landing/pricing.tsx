"use client";

import { useState } from "react";
import { PLANS, TRIAL_DAYS } from "@/lib/pricing";
import { Icon } from "@/components/ui";

export function Pricing({ signupsOpen = false, beta = false }: { signupsOpen?: boolean; beta?: boolean }) {
  const [yearly, setYearly] = useState(true);
  return (
    <div>
      <div className="mb-10 flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 text-[13px] font-medium">
          {[
            { v: false, label: "Monthly" },
            { v: true, label: "Yearly" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={yearly === o.v}
              onClick={() => setYearly(o.v)}
              className={`flex h-8 items-center gap-2 rounded-full px-4 transition-colors ${yearly === o.v ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              {o.label}
              {o.v && <span className={`rounded-full px-1.5 py-px text-[11px] ${yearly ? "bg-[var(--bg)]/15 text-[var(--bg)]" : "bg-[var(--good-soft)] text-[var(--good)]"}`}>Save 20%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const price = yearly ? p.yearly : p.monthly;
          return (
            // fixmyslop-ignore[ui/neon-glow] neutral grey elevation on the recommended plan only, no colour
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-[var(--surface)] p-6 ${p.popular ? "border-[var(--ink)] shadow-[0_1px_0_var(--line),0_12px_32px_-12px_rgba(16,24,40,.18)]" : "border-[var(--line)]"}`}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-semibold">{p.name}</h3>
                {p.popular && <span className="badge badge-accent">Most popular</span>}
                {p.soon && <span className="badge">Coming soon</span>}
              </div>
              <p className="mt-1 min-h-[42px] text-[14px] text-[var(--muted)]">{p.tagline}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-[40px] font-semibold tracking-tight tnum">${price}</span>
                <span className="text-[14px] text-[var(--muted)]">/ month</span>
              </div>
              <p className="h-5 text-[12px] text-[var(--subtle)]">{yearly ? `$${p.yearly * 12} billed yearly` : "Billed monthly"}</p>

              <ul className="mt-5 space-y-2 border-y border-[var(--line)] py-4 text-[14px]">
                {p.limits.map((l) => (
                  <li key={l} className="font-medium">{l}</li>
                ))}
              </ul>
              <ul className="mt-4 flex-1 space-y-2.5 text-[14px]">
                {p.bullets.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Icon name="check" size={16} className="mt-0.5 flex-none text-[var(--good)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a href={signupsOpen && !p.soon ? `/signup?plan=${p.id}&interval=${yearly ? "year" : "month"}` : `/?plan=${p.id}#early-access`} className={`btn mt-6 h-10 text-[14px] ${p.popular ? "btn-primary" : ""}`}>
                {p.soon ? "Join the waitlist" : beta ? "Join the free beta" : `Start ${TRIAL_DAYS}-day trial`}
              </a>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-[13px] text-[var(--subtle)]">
        {beta
          ? "Free while PostFlow is in beta, with every Pro feature and up to 60 posts a month. These are the prices after the beta; you will hear well before anything is charged."
          : `Prices in USD. Every plan starts with a ${TRIAL_DAYS}-day free trial. A post is one post on one platform.`}
      </p>
    </div>
  );
}
