"use client";

import { useActionState, useState } from "react";
import { welcomeAction, type WelcomeState } from "@/app/welcome-action";
import { Field } from "@/components/ui";
import { FIELD_IDS, fieldOf, FIELDS } from "@/lib/fields";

export function WelcomeForm({ field, audience, role, expertise, region }: { field: string; audience: string; role: string; expertise: string; region: string }) {
  const [state, action, pending] = useActionState<WelcomeState, FormData>(welcomeAction, null);
  // React clears the form after each submit; after an error, refill it with what was typed.
  const v = state?.values ?? { field, audience, role, expertise, region, feed1: "", feed2: "" };
  const [picked, setPicked] = useState(v.field);
  const f = fieldOf(picked);
  return (
    <form key={state ? JSON.stringify(state) : "first"} action={action} className="space-y-6">
      {state?.error && <p role="alert" className="rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{state.error}</p>}

      <section className="panel space-y-4 p-5">
        <h2 className="display text-[22px]">Who you are</h2>
        <Field label="Your field" hint={f.id === "tech" ? "Tech news, written for developers and founders." : `News from your field, written for ${f.audience}.`}>
          <select name="field" defaultValue={v.field} onChange={(e) => setPicked(e.target.value)} className="input">
            {FIELD_IDS.map((id) => (
              <option key={id} value={id}>{FIELDS[id].label}</option>
            ))}
          </select>
        </Field>
        <Field label="Your role" hint="Shown to the writer, so posts sound like someone in your seat.">
          <input name="role" required minLength={2} maxLength={100} defaultValue={v.role} placeholder={f.roleExample} className="input" />
        </Field>
        <Field
          label="Topics you know well"
          hint="At least two, separated by commas. News inside these topics is ranked first, and lessons stay inside them. Be specific: three narrow topics beat one broad one."
        >
          <textarea name="expertise" required rows={2} defaultValue={v.expertise} placeholder={f.topicsExample} className="textarea" />
        </Field>
        <Field label="Who reads your posts (optional)" hint={`Leave empty for: ${f.audience}.`}>
          <input name="audience" maxLength={160} defaultValue={v.audience} placeholder={f.id === "health" ? "e.g. patients and other eye doctors" : "e.g. small-business owners in Nepal"} className="input" />
        </Field>
        <Field label="Your city or country (optional)" hint={`Adds posts about your local ${f.community} scene.`}>
          <input name="region" maxLength={60} defaultValue={v.region} placeholder="e.g. Kathmandu, Berlin, Lagos" className="input" />
        </Field>
      </section>

      <section className="panel space-y-4 p-5">
        <div>
          <h2 className="display text-[22px]">Sources you read <span className="text-[14px] font-normal text-[var(--muted)]">optional</span></h2>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {f.id === "tech"
              ? "Everyone starts with the same tech news (Hacker News, TechCrunch, The Verge and others)."
              : "You start with news on each of your topics, plus a few well-known sources in your field."}{" "}
            Add a blog, newsletter or subreddit you trust and your posts stop looking like everyone else&apos;s. Paste the homepage; PostFlow finds the feed.
          </p>
        </div>
        <Field label="Source 1">
          <input name="feed1" maxLength={300} defaultValue={v.feed1} placeholder={f.sourceExample} className="input" />
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
