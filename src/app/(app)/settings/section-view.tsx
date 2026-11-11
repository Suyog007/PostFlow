import Link from "next/link";
import { notFound } from "next/navigation";
import { FIELD_IDS, FIELDS } from "@/lib/fields";
import { Icon } from "@/components/ui";
import { VoiceForm } from "@/components/voice-form";
import { saveTopicsAction, saveYouAction } from "@/app/actions";
import { Flash } from "../flash";
import { Advanced, General, Schedule, Sources, settingsContext } from "./sections";

const PAGES = {
  you: { title: "Your voice", lead: "This is how you come across in a post." },
  topics: { title: "What to write about", lead: "PostFlow only picks news that matters in your work." },
  times: { title: "When to post", lead: "Pick the days and times. Nothing goes out until you approve it." },
  accounts: { title: "Your accounts", lead: "Where your posts go, and how PostFlow reaches you." },
  sources: { title: "Your sources", lead: "The journals, research, magazines, official bodies and news PostFlow reads for you." },
  more: { title: "More options", lead: "Fine-tuning. Most people never need these." },
} as const;

/** One settings page: a back link, its title, its saved/error message, then its form. */
export async function SectionView({ section, ok, error, connected }: { section: string; ok?: string; error?: string; connected?: string }) {
  if (!(section in PAGES)) notFound();
  const page = PAGES[section as keyof typeof PAGES];
  const { user, ent, s, field, showX, pro, keep } = await settingsContext();
  return (
    <div className="mx-auto max-w-[680px]">
      <Link href="/settings" className="inline-flex items-center gap-1 text-[16px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
        <Icon name="left" size={18} />Settings
      </Link>
      <h1 className="display mt-3 text-[36px] leading-tight sm:text-[44px]">{page.title}</h1>
      <p className="mt-1 text-[17px] text-[var(--muted)]">{page.lead}</p>
      <div className="mt-8 space-y-10">
        <Flash ok={ok ?? (connected ? `Connected ${connected}.` : undefined)} error={error} />
        {section === "you" && (
          <VoiceForm
            action={saveYouAction}
            field={field.id}
            name={s.profile.name || user.name || ""}
            role={s.profile.role}
            voice={s.profile.voice}
            avoid={s.profile.avoid}
            include={{ link: s.includeLinks.linkedin, logo: s.images.linkedin, tags: s.hashtags.linkedin }}
          />
        )}
        {section === "topics" && (
          <form action={saveTopicsAction} className="space-y-8">
            <fieldset>
              <legend className="mb-3 text-[15px] font-semibold">Your field</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {FIELD_IDS.map((id) => (
                  <label key={id} className="cursor-pointer">
                    <input type="radio" name="field" value={id} defaultChecked={field.id === id} className="peer sr-only" />
                    <span className="flex h-full items-center rounded-[16px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-[16px] font-semibold transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent-soft)] peer-checked:shadow-[inset_0_0_0_1px_var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--accent)]">
                      {FIELDS[id].label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-semibold">Topics you know well</span>
              <textarea name="expertise" rows={3} required defaultValue={s.profile.expertise.join(", ")} placeholder={field.topicsExample} className="textarea text-[16px]" />
              <span className="mt-1.5 block text-[14px] text-[var(--muted)]">Separate with commas. News about these comes first.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-semibold">Who reads your posts</span>
              <input name="audience" maxLength={160} defaultValue={s.profile.audience} placeholder={field.audience} className="input h-12 text-[16px]" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-semibold">Your city or country</span>
              <input name="region" maxLength={60} defaultValue={s.profile.region} placeholder="e.g. Kathmandu" className="input h-12 text-[16px]" />
              <span className="mt-1.5 block text-[14px] text-[var(--muted)]">For news close to home. Leave empty if it doesn&apos;t matter.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[15px] font-semibold">A line about you <span className="font-normal text-[var(--muted)]">(optional)</span></span>
              <textarea name="bio" rows={2} defaultValue={s.profile.bio} className="textarea text-[16px]" />
            </label>
            <button className="btn btn-primary h-14 w-full text-[18px]">Done</button>
          </form>
        )}
        {section === "times" && <Schedule s={s} ent={ent} showX={showX} pro={pro} keep={keep} />}
        {section === "accounts" && <General user={user} s={s} ent={ent} showX={showX} pro={pro} />}
        {section === "sources" && <Sources userId={user.id} s={s} feeds={ent.quota.feeds} />}
        {section === "more" && <Advanced s={s} field={field} showX={showX} isOwner={user.isOwner} keep={keep} />}
      </div>
    </div>
  );
}
