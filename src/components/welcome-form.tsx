"use client";

// First run, in three short steps: what you do, your work, your news. One question per screen,
// big targets, and a way back. Everything is sent once, at the end.

import { useActionState, useState } from "react";
import { welcomeAction, type WelcomeState } from "@/app/welcome-action";
import { fieldOf } from "@/lib/fields";

const JOBS = [
  { id: "health", title: "Doctor", sub: "Clinician or specialist", icon: <path d="M7 4v5a4 4 0 0 0 8 0V4M11 13v2a4 4 0 0 0 8 0v-1.5M19 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /> },
  { id: "finance", title: "Accountant", sub: "Tax, audit or finance", icon: <path d="M7 3.5h8l3 3V20H7zM10 10h5M10 13.5h5M10 17h3" /> },
  { id: "law", title: "Lawyer", sub: "Law or compliance", icon: <path d="M12 4v16M8 20h8M5 8h14M7 8l-2.5 6a2.5 2.5 0 0 0 5 0zM17 8l-2.5 6a2.5 2.5 0 0 0 5 0z" /> },
  { id: "education", title: "Teacher", sub: "Schools or training", icon: <path d="M4 6.5C6.5 5 9.5 5 12 6.5v12c-2.5-1.5-5.5-1.5-8 0zM20 6.5C17.5 5 14.5 5 12 6.5v12c2.5-1.5 5.5-1.5 8 0z" /> },
  { id: "tech", title: "Engineer", sub: "Software and tech", icon: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /> },
  { id: "marketing", title: "Marketer", sub: "Marketing or sales", icon: <path d="M4 10v4h3l6 4V6L7 10zM17 9.5a3.5 3.5 0 0 1 0 5" /> },
] as const;

const STEPS = ["What you do", "Your work", "Your news"];

export function WelcomeForm({ name, field, audience, role, expertise, region }: { name: string; field: string; audience: string; role: string; expertise: string; region: string }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(welcomeAction, null);
  const v = state?.values ?? { field, audience, role, expertise, region, feed1: "", feed2: "" };
  const [step, setStep] = useState(state ? 1 : 0);
  const [picked, setPicked] = useState(v.field || "health");
  const [work, setWork] = useState({ role: v.role, expertise: v.expertise });
  const f = fieldOf(picked);
  const canNext = step === 0 ? !!picked : step === 1 ? work.role.trim().length >= 2 && work.expertise.trim().length >= 2 : true;

  return (
    <form key={state ? JSON.stringify(state) : "first"} action={action} className="mx-auto max-w-[620px]">
      <div className="flex items-center gap-3">
        <span className="flex gap-1.5" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} className={`h-2.5 rounded-full transition-all ${i === step ? "w-8 bg-[var(--accent)]" : i < step ? "w-2.5 bg-[var(--accent)]" : "w-2.5 bg-[var(--line-strong)]"}`} />)}
        </span>
        <span className="text-[15px] font-semibold text-[var(--muted)]">{STEPS[step]} · {step + 1} of 3</span>
        <span className="ml-auto hidden text-[15px] text-[var(--muted)] sm:inline">About two minutes</span>
      </div>

      {state?.error && <p role="alert" className="mt-5 rounded-[14px] bg-[var(--bad-soft)] px-4 py-3 text-[15px] text-[var(--bad)]">{state.error}</p>}

      {/* Step 1: what you do. */}
      <fieldset className={step === 0 ? "mt-7" : "hidden"}>
        {name && <p className="text-[17px] text-[var(--muted)]">Welcome, {name}.</p>}
        <legend className="sr-only">What do you do?</legend>
        <h1 className="display mt-1 text-[38px] leading-tight sm:text-[48px]">What do you do?</h1>
        <p className="mt-2 text-[17px] text-[var(--muted)]">Pick the closest match. We&apos;ll only write about news that matters in your work.</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {JOBS.map((j) => (
            <label key={j.id} className="cursor-pointer">
              <input type="radio" name="field" value={j.id} checked={picked === j.id} onChange={() => setPicked(j.id)} className="peer sr-only" />
              <span className="relative flex h-full flex-col rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_10px_24px_-22px_rgba(27,36,32,.5)] transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:shadow-[inset_0_0_0_1.5px_var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--accent)] sm:p-5">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[var(--raised)] text-[var(--accent)]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{j.icon}</svg>
                </span>
                <span className="mt-4 text-[19px] font-semibold">{j.title}</span>
                <span className="mt-1 text-[15px] text-[var(--muted)]">{j.sub}</span>
                {picked === j.id && <span aria-hidden="true" className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[14px] text-[var(--accent-ink)]">✓</span>}
              </span>
            </label>
          ))}
          <label className="col-span-2 cursor-pointer">
            <input type="radio" name="field" value="other" checked={picked === "other"} onChange={() => setPicked("other")} className="peer sr-only" />
            <span className="flex items-center gap-4 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:shadow-[inset_0_0_0_1.5px_var(--accent)] sm:p-5">
              <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-[var(--raised)] text-[22px] text-[var(--accent)]">+</span>
              <span>
                <span className="block text-[19px] font-semibold">Something else</span>
                <span className="block text-[15px] text-[var(--muted)]">You can tell us in your own words</span>
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* Step 2: your work. */}
      <fieldset className={step === 1 ? "mt-7 space-y-5" : "hidden"}>
        <legend className="sr-only">Your work</legend>
        <h1 className="display text-[38px] leading-tight sm:text-[48px]">Tell us about your work</h1>
        <p className="text-[17px] text-[var(--muted)]">So each post sounds like someone in your seat.</p>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">How you describe your work</span>
          <input name="role" required minLength={2} maxLength={100} value={work.role} onChange={(e) => setWork((x) => ({ ...x, role: e.target.value }))} placeholder={f.roleExample} className="input h-13 py-3 text-[17px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">Topics you know well</span>
          <textarea name="expertise" required rows={3} value={work.expertise} onChange={(e) => setWork((x) => ({ ...x, expertise: e.target.value }))} placeholder={f.topicsExample} className="textarea text-[17px]" />
          <span className="mt-1.5 block text-[14px] text-[var(--muted)]">Two or three, separated by commas. Narrow beats broad.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">Your city or country <span className="font-normal text-[var(--muted)]">(optional)</span></span>
          <input name="region" maxLength={60} defaultValue={v.region} placeholder="e.g. Kathmandu" className="input h-13 py-3 text-[17px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">Who reads your posts <span className="font-normal text-[var(--muted)]">(optional)</span></span>
          <input name="audience" maxLength={160} defaultValue={v.audience} placeholder={f.audience} className="input h-13 py-3 text-[17px]" />
        </label>
      </fieldset>

      {/* Step 3: your news. */}
      <fieldset className={step === 2 ? "mt-7 space-y-5" : "hidden"}>
        <legend className="sr-only">Your news</legend>
        <h1 className="display text-[38px] leading-tight sm:text-[48px]">Any news you already read?</h1>
        <p className="text-[17px] text-[var(--muted)]">
          Optional. You start with trusted news on your topics. Add a website or newsletter you like, and your posts stop sounding like everyone else&apos;s.
        </p>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">A website or newsletter</span>
          <input name="feed1" maxLength={300} defaultValue={v.feed1} placeholder={f.sourceExample} className="input h-13 py-3 text-[17px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[16px] font-semibold">Another one</span>
          <input name="feed2" maxLength={300} defaultValue={v.feed2} placeholder="e.g. a newsletter you read every week" className="input h-13 py-3 text-[17px]" />
        </label>
      </fieldset>

      <div className="mt-8">
        {step < 2 ? (
          <button type="button" disabled={!canNext} onClick={() => setStep((s) => s + 1)} className="btn btn-primary h-14 w-full text-[18px]">Continue</button>
        ) : (
          <button className="btn btn-primary h-14 w-full text-[18px]" disabled={pending}>{pending ? "Setting up…" : "Start writing my posts"}</button>
        )}
        <div className="mt-4 flex items-center justify-center gap-4 text-[15px] text-[var(--muted)]">
          {step > 0 && <button type="button" onClick={() => setStep((s) => s - 1)} className="font-semibold underline underline-offset-4">Back</button>}
          <span>You can change this later.</span>
        </div>
      </div>
    </form>
  );
}
