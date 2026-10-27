"use client";

import { useState } from "react";
import { BETA, PLANS, TRIAL_DAYS } from "@/lib/pricing";
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
        {beta && (
          <div className="relative flex flex-col rounded-2xl border border-[var(--ink)] bg-[var(--surface)] p-6 shadow-[0_1px_0_var(--line),0_12px_32px_-12px_rgba(16,24,40,.18)]">
            <div className="flex items-center gap-2">
              <h3 className="text-[17px] font-semibold">Free beta</h3>
              <span className="badge badge-accent">Open now</span>
            </div>
            <p className="mt-1 min-h-[42px] text-[14px] text-[var(--muted)]">Try the whole desk on LinkedIn while PostFlow is in beta.</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-[40px] font-semibold tracking-tight tnum">$0</span>
              <span className="text-[14px] text-[var(--muted)]">/ month</span>
            </div>
            <p className="h-5 text-[12px] text-[var(--subtle)]">No card needed</p>
            <ul className="mt-5 space-y-2 border-y border-[var(--line)] py-4 text-[14px]">
              {["1 LinkedIn account", `${BETA.quota.postsPerMonth} posts a month`, `Up to ${BETA.quota.feeds} news feeds`].map((l) => (
                <li key={l} className="font-medium">{l}</li>
              ))}
            </ul>
            <ul className="mt-4 flex-1 space-y-2.5 text-[14px]">
              {["Reviewer checks every draft", "News cross-checked by two outlets", "Posts from a link or your own articles", "Approve on Telegram before it posts", "Auto mode once you trust it"].map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Icon name="check" size={16} className="mt-0.5 flex-none text-[var(--good)]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a href={signupsOpen ? "/signup" : "/#early-access"} className="btn btn-primary mt-6 h-10 text-[14px]">{signupsOpen ? "Join the free beta" : "Get early access"}</a>
          </div>
        )}
        {PLANS.filter((p) => !beta || p.id !== "starter").map((p) => {
          const price = yearly ? p.yearly : p.monthly;
          return (
            // fixmyslop-ignore[ui/neon-glow] neutral grey elevation on the recommended plan only, no colour
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-[var(--surface)] p-6 ${p.popular && !beta ? "border-[var(--ink)] shadow-[0_1px_0_var(--line),0_12px_32px_-12px_rgba(16,24,40,.18)]" : "border-[var(--line)]"}`}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-semibold">{p.name}</h3>
                {p.popular && !beta && <span className="badge badge-accent">Most popular</span>}
                {(p.soon || beta) && <span className="badge">{beta && !p.soon ? "Opens soon" : "Coming soon"}</span>}
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
                {p.bullets.map((f) => (beta && f === "Everything in Starter" ? "Everything in the free beta, plus X" : f)).map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Icon name="check" size={16} className="mt-0.5 flex-none text-[var(--good)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a href={signupsOpen && !p.soon && !beta ? `/signup?plan=${p.id}&interval=${yearly ? "year" : "month"}` : `/?plan=${p.id}#early-access`} className={`btn mt-6 h-10 text-[14px] ${p.popular && !beta ? "btn-primary" : ""}`}>
                {p.soon || beta ? "Join the waitlist" : `Start ${TRIAL_DAYS}-day trial`}
              </a>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-[13px] text-[var(--subtle)]">
        {beta
          ? "Prices in USD. The free beta covers LinkedIn. Pro adds X and opens soon: join the waitlist to hear first. A post is one post on one platform."
          : `Prices in USD. Every plan starts with a ${TRIAL_DAYS}-day free trial. A post is one post on one platform.`}
      </p>
    </div>
  );
}
