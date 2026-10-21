"use client";

import { useActionState } from "react";
import { joinWaitlistAction } from "@/app/waitlist-action";
import { PLANS } from "@/lib/pricing";
import { Icon } from "@/components/ui";

type State = { ok: true; message: string } | { ok: false; error: string } | null;

export function WaitlistForm({ plan }: { plan?: string }) {
  const [state, action, pending] = useActionState(joinWaitlistAction as (s: State, f: FormData) => Promise<State>, null);
  if (state?.ok) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 text-left">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--good-soft)] text-[var(--good)]"><Icon name="check" size={16} /></span>
        <div>
          <p className="font-medium">{state.message}</p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Invites go out in the order people joined.</p>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="relative rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-left sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
        <div>
          <label htmlFor="wl-email" className="label">Work email</label>
          <input id="wl-email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="input h-10" />
        </div>
        <div>
          <label htmlFor="wl-plan" className="label">Interested in</label>
          <select id="wl-plan" name="plan" defaultValue={PLANS.some((p) => p.id === plan) ? plan : "pro"} className="select h-10">
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.soon ? " (soon)" : ""}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="wl-role" className="label">What do you do? <span className="font-normal text-[var(--subtle)]">Optional</span></label>
        <input id="wl-role" name="role" maxLength={80} placeholder="e.g. Founder of a dev-tools startup" className="input h-10" />
      </div>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="wl-company">Company</label>
        <input id="wl-company" name="company" tabIndex={-1} autoComplete="off" />
      </div>
      {state && !state.ok && <p role="alert" className="mt-3 text-[13px] text-[var(--bad)]">{state.error}</p>}
      <button className="btn btn-primary mt-4 h-10 w-full text-[14px]" disabled={pending}>{pending ? "Joining…" : "Get early access"}</button>
      <p className="mt-2 text-center text-[12px] text-[var(--subtle)]">No card needed. One email when your invite is ready.</p>
    </form>
  );
}
