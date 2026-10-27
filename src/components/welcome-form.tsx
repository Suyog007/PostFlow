"use client";

import { useActionState } from "react";
import { welcomeAction, type WelcomeState } from "@/app/welcome-action";
import { Field } from "@/components/ui";

export function WelcomeForm({ role, expertise, region }: { role: string; expertise: string; region: string }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(welcomeAction, null);
  // React clears the form after each submit; after an error, refill it with what was typed.
  const v = state?.values ?? { role, expertise, region, feed1: "", feed2: "" };
  return (
    <form key={state ? JSON.stringify(state) : "first"} action={action} className="space-y-6">
      {state?.error && <p role="alert" className="rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{state.error}</p>}

      <section className="panel space-y-4 p-5">
        <h2 className="display text-[22px]">Who you are</h2>
        <Field label="Your role" hint="Shown to the writer, so posts sound like someone in your seat.">
          <input name="role" required minLength={2} maxLength={100} defaultValue={v.role} placeholder="e.g. Backend engineer at a fintech" className="input" />
        </Field>
        <Field
          label="Topics you know well"
          hint="At least two, separated by commas. News inside these topics is ranked first, and lessons stay inside them. Be specific: “Go, payments, Postgres” beats “software”."
        >
          <textarea name="expertise" required rows={2} defaultValue={v.expertise} placeholder="e.g. Go, payments, Postgres, system design" className="textarea" />
        </Field>
        <Field label="Your city or country (optional)" hint="Adds posts about your local tech scene.">
          <input name="region" maxLength={60} defaultValue={v.region} placeholder="e.g. Kathmandu, Berlin, Lagos" className="input" />
        </Field>
      </section>

      <section className="panel space-y-4 p-5">
        <div>
          <h2 className="display text-[22px]">Sources you read <span className="text-[14px] font-normal text-[var(--muted)]">optional</span></h2>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Everyone starts with the same tech news (Hacker News, TechCrunch, The Verge and others). Add a blog, newsletter or subreddit from your corner of the field and your posts stop looking like everyone else&apos;s. Paste the homepage; PostFlow finds the feed.
          </p>
        </div>
        <Field label="Source 1">
          <input name="feed1" maxLength={300} defaultValue={v.feed1} placeholder="e.g. go.dev/blog or reddit.com/r/golang" className="input" />
        </Field>
        <Field label="Source 2">
          <input name="feed2" maxLength={300} defaultValue={v.feed2} placeholder="e.g. a newsletter you read every week" className="input" />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save and open my calendar"}</button>
        <span className="text-[12px] text-[var(--subtle)]">You can change all of this later in Settings.</span>
      </div>
    </form>
  );
}
