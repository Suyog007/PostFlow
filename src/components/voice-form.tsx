"use client";

// "Your voice": pick the sample post that sounds like you, tap the things you never want in a post,
// and switch what each post includes. Everything is sent with one Done button.

import { useState } from "react";
import { NEVER, splitNever, toneOf, toneSamples, type ToneId } from "@/lib/tones";

function Switch({ name, on, title, hint }: { name: string; on: boolean; title: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-4">
      <span className="min-w-0">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-[var(--muted)]">{hint}</span>
      </span>
      <input type="checkbox" name={name} defaultChecked={on} className="peer sr-only" />
      <span aria-hidden="true" className="relative mt-0.5 h-[30px] w-[50px] flex-none rounded-full bg-[var(--line-strong)] transition-colors duration-200 after:absolute after:left-[3px] after:top-[3px] after:h-6 after:w-6 after:rounded-full after:bg-[var(--surface)] after:shadow after:transition-transform after:duration-200 peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]" />
    </label>
  );
}

export function VoiceForm({
  action,
  field,
  name,
  role,
  voice,
  avoid,
  include,
}: {
  action: (f: FormData) => Promise<void>;
  field: string;
  name: string;
  role: string;
  voice: string;
  avoid: string;
  include: { link: boolean; logo: boolean; tags: boolean };
}) {
  const samples = toneSamples(field);
  const [tone, setTone] = useState<ToneId | "own">(toneOf(voice)?.id ?? (voice.trim() ? "own" : "warm"));
  const [own, setOwn] = useState(toneOf(voice) ? "" : voice);
  const presets = NEVER[field] ?? NEVER.other;
  const saved = splitNever(avoid);
  const [never, setNever] = useState<string[]>(saved);
  const [extra, setExtra] = useState("");
  const [adding, setAdding] = useState(false);
  const has = (x: string) => never.some((n) => n.toLowerCase() === x.toLowerCase());
  const toggle = (x: string) => setNever((list) => (has(x) ? list.filter((n) => n.toLowerCase() !== x.toLowerCase()) : [...list, x]));
  const custom = never.filter((n) => !presets.some((p) => p.toLowerCase() === n.toLowerCase()));
  const voiceText = tone === "own" ? own : samples.find((s) => s.id === tone)!.text;

  return (
    <form action={action} className="space-y-10">
      <input type="hidden" name="voice" value={voiceText} />
      <input type="hidden" name="avoid" value={never.join(", ")} />

      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-semibold">Your name, as it should appear</span>
          <input name="name" defaultValue={name} required className="input h-12 text-[16px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-semibold">How you describe your work</span>
          <input name="role" defaultValue={role} placeholder="e.g. Family doctor in Kathmandu" className="input h-12 text-[16px]" />
        </label>
      </div>

      <section>
        <h2 className="display text-[26px]">Which of these sounds like you?</h2>
        <p className="mt-1 text-[16px] text-[var(--muted)]">Tap the post you would actually publish. We&apos;ll write the others in that style.</p>
        <div className="mt-4 space-y-3" role="radiogroup" aria-label="Your voice">
          {samples.map((s) => {
            const on = tone === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTone(s.id)}
                className={`block w-full rounded-[18px] border p-4 text-left transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]"}`}
              >
                <span className="block text-[14px] font-semibold">{s.label}</span>
                <span className="mt-1.5 block text-[15px] leading-relaxed">{s.sample}</span>
                {on && <span className="mt-2 block text-[14px] font-semibold text-[var(--accent)]">✓ This sounds like you</span>}
              </button>
            );
          })}
          <div className={`rounded-[18px] border p-4 ${tone === "own" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-dashed border-[var(--line-strong)]"}`}>
            <button type="button" role="radio" aria-checked={tone === "own"} onClick={() => setTone("own")} className="text-left text-[15px] font-semibold">
              Or say it in your own words
            </button>
            {tone === "own" && (
              <textarea value={own} onChange={(e) => setOwn(e.target.value)} rows={3} required placeholder="e.g. Friendly, a bit of humour, always end with a question" className="textarea mt-3 text-[16px]" aria-label="Your voice in your own words" />
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="display text-[26px]">Things you never want in a post</h2>
        <p className="mt-1 text-[16px] text-[var(--muted)]">Tap to turn one on or off. You can also add your own.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[...presets, ...custom].map((x) => {
            const on = has(x);
            return (
              <button
                key={x}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(x)}
                className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-semibold transition-colors ${on ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--ink)]"}`}
              >
                {on && <span aria-hidden="true">✓</span>}
                {x}
              </button>
            );
          })}
          {adding ? (
            <span className="inline-flex items-center gap-2">
              <input
                autoFocus
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (extra.trim() && !has(extra.trim())) setNever((l) => [...l, extra.trim()]);
                    setExtra("");
                    setAdding(false);
                  }
                }}
                placeholder="Type, then Enter"
                aria-label="Something you never want in a post"
                className="input h-11 w-48 rounded-full"
              />
            </span>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-11 items-center rounded-full border border-dashed border-[var(--line-strong)] px-4 text-[15px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
              + Add your own
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="display text-[26px]">What each post should include</h2>
        <div className="mt-2 divide-y divide-[var(--line)]">
          <Switch name="link_linkedin" on={include.link} title="A link to the news this post is based on" hint="So readers can open the original article themselves." />
          <Switch name="img_linkedin" on={include.logo} title="A picture, when the post is about one named company or product" hint="Only official public logos, and only when we're sure they're allowed." />
          <Switch name="tags_linkedin" on={include.tags} title="Topic words at the end, like #FamilyMedicine" hint="Most readers skip these. Leave this off unless you like them." />
        </div>
      </section>

      <button className="btn btn-primary h-14 w-full text-[18px]">Done</button>
    </form>
  );
}
