import { FIELD_IDS, FIELDS, fieldOf } from "@/lib/fields";
import { DateTime } from "luxon";
import Link from "next/link";
import type { ReactNode } from "react";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { myChecks } from "@/server/health";
import { requireActiveUser } from "@/server/auth";
import { approvalGate, entitlementOf } from "@/server/billing/plans";
import { telegramConfigured } from "@/server/telegram";
import { contactEmail, env } from "@/server/env";
import { isPlatformConfigured } from "@/server/platforms/accounts";
import { ScheduleEditor } from "@/components/schedule-editor";
import { addSourceAction, connectAction, deleteSourceAction, disconnectAction, runTickAction, saveFastLaneAction, saveVoiceAction, saveAdvancedAction, saveSlotsAction, unlinkTelegramAction, toggleSourceAction, togglePauseAction, toggleApprovalAction, removeStyleNoteAction, connectTelegramAction } from "@/app/actions";
import { Flash } from "../flash";

const TABS = [
  { id: "general", label: "General" },
  { id: "schedule", label: "Schedule" },
  { id: "voice", label: "Voice" },
  { id: "sources", label: "Sources" },
  { id: "advanced", label: "Advanced" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** A titled block in a tab: heading, one line on what it does, then the controls. */
function Section({ title, hint, children, id }: { title: ReactNode; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-[14px] text-[var(--muted)]">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Toggle({ name, label, on, hint }: { name: string; label: string; on: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-1" />
      <span>
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  );
}

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  return [...new Set(["UTC", current, ...all])];
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; connected?: string; tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "general";
  const user = await requireActiveUser();
  const ent = entitlementOf(user);
  const pro = (label: string) => <Link href="/billing" className="badge badge-accent ml-2 align-middle" title={`${label} is part of Pro`}>Pro</Link>;
  const s = await getSettings();
  const field = fieldOf(s.profile.field);
  const showX = ent.features.x;
  // A hidden X control keeps its saved value, so saving a form never switches it off by accident.
  const keep = (name: string, on: boolean) => (on ? <input type="hidden" name={name} value="on" /> : null);

  return (
    <div className="max-w-3xl">
      <h1 className="display text-[34px]">Settings</h1>
      <nav aria-label="Settings sections" className="mt-4 flex gap-6 overflow-x-auto border-b border-[var(--line)]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "general" ? "/settings" : `/settings?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-[14px] transition-colors ${tab === t.id ? "border-[var(--ink)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
          >
            {t.label}
          </Link>
        ))}
        {/* On phones the bottom tab bar has no room for these. */}
        <Link href="/billing" className="-mb-px whitespace-nowrap border-b-2 border-transparent pb-2.5 text-[14px] text-[var(--muted)] md:hidden">Billing</Link>
        <Link href="/account" className="-mb-px whitespace-nowrap border-b-2 border-transparent pb-2.5 text-[14px] text-[var(--muted)] md:hidden">Account</Link>
        {user.isOwner && <Link href="/admin" className="-mb-px whitespace-nowrap border-b-2 border-transparent pb-2.5 text-[14px] text-[var(--muted)] md:hidden">Admin</Link>}
      </nav>

      <div className="mt-6 space-y-10">
        <Flash ok={sp.ok ?? (sp.connected ? `Connected ${sp.connected}.` : undefined)} error={sp.error} />
        {tab === "general" && <General user={user} s={s} ent={ent} showX={showX} pro={pro} />}
        {tab === "schedule" && <Schedule s={s} ent={ent} showX={showX} pro={pro} keep={keep} />}
        {tab === "voice" && <Voice s={s} field={field} />}
        {tab === "sources" && <Sources userId={user.id} s={s} feeds={ent.quota.feeds} />}
        {tab === "advanced" && <Advanced s={s} field={field} showX={showX} isOwner={user.isOwner} keep={keep} />}
      </div>
    </div>
  );
}

type S = Awaited<ReturnType<typeof getSettings>>;
type Ent = ReturnType<typeof entitlementOf>;
type User = Awaited<ReturnType<typeof requireActiveUser>>;
type Field = ReturnType<typeof fieldOf>;

/* ---------------------------------------------------------------- general */

async function General({ user, s, ent, showX, pro }: { user: User; s: S; ent: Ent; showX: boolean; pro: (l: string) => ReactNode }) {
  const checks = await myChecks({ x: showX });
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const acct = (p: string) => accounts.find((a) => a.platform === p && a.status !== "disconnected");
  const tgReady = telegramConfigured() && Boolean(env().TELEGRAM_BOT_USERNAME);
  const approvalOn = approvalGate(s, ent.features.autoMode).blocks;

  return (
    <>
      <Section title="Status">
        <ul className="card divide-y divide-line">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-3 px-4 py-3">
              <span aria-hidden="true" className={`mt-1.5 h-2 w-2 flex-none rounded-full ${c.ok ? "bg-[var(--good)]" : "bg-[var(--warn)]"}`} />
              <div className="text-[14px]">
                <span className="font-medium">{c.label}</span>
                {!c.ok && <p className="text-[var(--muted)]">{c.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={togglePauseAction}><button className={s.paused ? "btn-primary" : "btn-secondary"}>{s.paused ? "Resume autopilot" : "Pause everything"}</button></form>
          <form action={runTickAction}><button className="btn-secondary">Check for new stories now</button></form>
        </div>
      </Section>

      <Section id="accounts" title="Accounts" hint="Where your posts are published.">
        <div className="card divide-y divide-line">
          {(["linkedin", "x"] as const).map((p) => {
            const a = acct(p);
            if (p === "x" && !showX)
              return (
                <div key={p} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 text-[14px]">
                    <div className="font-medium">X{pro("Posting to X")}</div>
                    <div className="text-[var(--muted)]">Comes with Pro, which opens soon. The free beta posts to LinkedIn.</div>
                  </div>
                  <Link href="/?plan=pro#early-access" className="btn-secondary">Join the waitlist</Link>
                </div>
              );
            return (
              <div key={p} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-[14px]">
                  <div className="font-medium">{p === "x" ? "X" : "LinkedIn"}</div>
                  <div className="text-[var(--muted)]">{a ? `${a.handle ?? "Connected"}${a.status === "error" ? ` · needs reconnect: ${a.lastError}` : ""}` : isPlatformConfigured(p) ? "Not connected" : "Not available yet"}</div>
                </div>
                <form action={connectAction}><input type="hidden" name="platform" value={p} /><button className="btn-secondary" disabled={!isPlatformConfigured(p)}>{a ? "Reconnect" : "Connect"}</button></form>
                {a && <form action={disconnectAction}><input type="hidden" name="platform" value={p} /><button className="btn btn-ghost">Disconnect</button></form>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={<>Publishing{!ent.features.autoMode && pro("Auto mode")}</>}>
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-[14px]">
            <div className="font-medium">{approvalOn ? "You approve every post" : "Auto mode"}</div>
            <p className="text-[var(--muted)]">{approvalOn ? "A post you have not approved by its time is skipped." : "Posts that pass review go out at their time without asking."}</p>
          </div>
          {ent.features.autoMode && <form action={toggleApprovalAction}><button className="btn-secondary">{approvalOn ? "Switch to auto mode" : "Require approval"}</button></form>}
        </div>
      </Section>

      <Section id="telegram" title="Telegram" hint="Approve posts and send notes from your phone. Free.">
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]">
          {user.telegramChatId ? (
            <>
              <span className="flex-1 font-medium text-good">Linked</span>
              <form action={unlinkTelegramAction}><button className="btn btn-ghost">Disconnect</button></form>
            </>
          ) : tgReady ? (
            <>
              <span className="min-w-0 flex-1 text-[var(--muted)]">Opens the bot. Press <strong>Start</strong> within 15 minutes, then come back.</span>
              <form action={connectTelegramAction}><button className="btn btn-primary">Connect Telegram</button></form>
            </>
          ) : (
            <span className="text-[var(--muted)]">{telegramConfigured() ? "Telegram linking is being set up." : "Telegram is not available yet."}</span>
          )}
        </div>
      </Section>

      {contactEmail() && (
        <Section title="Help">
          <p className="text-[14px] text-[var(--muted)]">
            A question, a bug or a post that looks wrong? Email <a href={`mailto:${contactEmail()}`} className="font-medium text-[var(--ink)] underline">{contactEmail()}</a> and a person will reply.
          </p>
        </Section>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- schedule */

function Schedule({ s, ent, showX, pro, keep }: { s: S; ent: Ent; showX: boolean; pro: (l: string) => ReactNode; keep: (n: string, on: boolean) => ReactNode }) {
  return (
    <>
      <Section title="Posting times" hint={`PostFlow prepares a draft for each time, ${s.horizonDays} ${s.horizonDays === 1 ? "day" : "days"} ahead.`}>
        <form action={saveSlotsAction} className="card space-y-5 p-4">
          <ScheduleEditor initial={s.slots.map((x) => ({ platform: x.platform, days: [...x.days], time: x.time }))} showX={showX} timezone={s.timezone} />
          <label className="block max-w-xs">
            <span className="label">Timezone</span>
            <select name="timezone" defaultValue={s.timezone} className="input">
              {timezones(s.timezone).map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <button className="btn-primary">Save schedule</button>
        </form>
      </Section>

      <Section title={<>Breaking news{!ent.features.fastLane && pro("The fast lane")}</>} hint="When a big story breaks, post about it soon instead of waiting for the next time. You get a short window to stop it.">
        <form action={saveFastLaneAction} className="card space-y-4 p-4 text-[14px]">
          <label className="flex items-center gap-3">
            <input type="checkbox" name="fl_enabled" defaultChecked={s.fastLane.enabled && ent.features.fastLane} disabled={!ent.features.fastLane} />
            Post breaking stories early
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="label">Wait before posting</span>
              <select name="fl_lead" defaultValue={String(s.fastLane.leadMinutes)} className="input">
                {[15, 30, 45, 60, 90, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`}</option>)}
                {![15, 30, 45, 60, 90, 120, 240].includes(s.fastLane.leadMinutes) && <option value={s.fastLane.leadMinutes}>{s.fastLane.leadMinutes} minutes</option>}
              </select>
            </label>
            <label className="block"><span className="label">No posts from</span><input name="fl_qs" type="time" defaultValue={s.fastLane.quietStart} className="input tnum" /></label>
            <label className="block"><span className="label">Until</span><input name="fl_qe" type="time" defaultValue={s.fastLane.quietEnd} className="input tnum" /></label>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-[13px] text-[var(--muted)] hover:text-[var(--ink)]">More options</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block"><span className="label">How big the story must be (7-10)</span><input name="fl_min" type="number" min={7} max={10} defaultValue={s.fastLane.minRelevance} className="input" /></label>
              <label className="block"><span className="label">At most per day</span><input name="fl_max" type="number" min={1} max={3} defaultValue={s.fastLane.maxPerDay} className="input" /></label>
            </div>
          </details>
          {showX ? (
            <div className="flex gap-6">
              <label className="flex items-center gap-2"><input type="checkbox" name="fl_linkedin" defaultChecked={s.fastLane.platforms.includes("linkedin")} /> LinkedIn</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="fl_x" defaultChecked={s.fastLane.platforms.includes("x")} /> X</label>
            </div>
          ) : (
            <>
              {/* Only LinkedIn is offered: it is always on here, and X keeps whatever it had. */}
              <input type="hidden" name="fl_linkedin" value="on" />
              {keep("fl_x", s.fastLane.platforms.includes("x"))}
            </>
          )}
          <button className="btn-primary">Save</button>
        </form>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- voice */

function Voice({ s, field }: { s: S; field: Field }) {
  return (
    <>
      <Section id="profile" title="You" hint="The writer uses this so posts sound like someone in your seat.">
        <form action={saveVoiceAction} className="card space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="label">Name</span><input name="name" defaultValue={s.profile.name} className="input" /></label>
            <label className="block"><span className="label">Role</span><input name="role" defaultValue={s.profile.role} placeholder={field.roleExample} className="input" /></label>
            <label className="block">
              <span className="label">Field</span>
              <select name="field" defaultValue={field.id} className="input">
                {FIELD_IDS.map((id) => <option key={id} value={id}>{FIELDS[id].label}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Who reads your posts</span><input name="audience" maxLength={160} defaultValue={s.profile.audience} placeholder={field.audience} className="input" /></label>
          </div>
          <label className="block"><span className="label">Topics you know well</span><textarea name="expertise" rows={2} defaultValue={s.profile.expertise.join(", ")} placeholder="Separate with commas" className="textarea" /></label>
          <label className="block"><span className="label">How you sound</span><textarea name="voice" rows={2} defaultValue={s.profile.voice} className="textarea" /></label>
          <label className="block"><span className="label">Never write about</span><textarea name="avoid" rows={2} defaultValue={s.profile.avoid} className="textarea" /></label>
          <details>
            <summary className="cursor-pointer text-[13px] text-[var(--muted)] hover:text-[var(--ink)]">Bio and region</summary>
            <div className="mt-3 space-y-4">
              <label className="block"><span className="label">Short bio</span><textarea name="bio" rows={2} defaultValue={s.profile.bio} className="textarea" /></label>
              <label className="block"><span className="label">Your city or country, for local {field.community} posts</span><input name="region" defaultValue={s.profile.region} placeholder="e.g. Berlin, Nepal, Lagos" className="input" /></label>
            </div>
          </details>
          <button className="btn-primary">Save</button>
        </form>
      </Section>

      <Section title="Wording you asked for" hint={s.styleNotes.length ? "Every new post follows these." : "None yet. When you reword a post and tick “Remember this”, it shows up here."}>
        {s.styleNotes.length > 0 && (
          <ul className="card divide-y divide-line">
            {s.styleNotes.map((n, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                <span className="min-w-0 flex-1">{n}</span>
                <form action={removeStyleNoteAction}><input type="hidden" name="i" value={i} /><button className="btn btn-ghost">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- sources */

async function Sources({ userId, s, feeds }: { userId: string; s: S; feeds: number }) {
  const sources = await db().select().from(schema.sources).where(eq(schema.sources.userId, userId)).orderBy(asc(schema.sources.pillar), asc(schema.sources.name));
  const count = sources.filter((x) => x.url !== "tips://manual").length;
  return (
    <Section title={`News sources · ${count} of ${feeds}`} hint="The feeds PostFlow reads. Paste a blog, newsletter or site you trust to add it.">
      <form action={addSourceAction} className="card grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_160px_140px_auto]">
        <input name="url" aria-label="Feed or site address" placeholder="https://example.com/feed.xml" className="input" required />
        <input name="name" aria-label="Name" placeholder="Name (optional)" className="input" />
        <select name="pillar" aria-label="Feed type" className="input"><option value="news">News</option><option value="local">{s.profile.region ? `${s.profile.region} scene` : "Local scene"}</option></select>
        <button className="btn-secondary h-[34px]">Add</button>
      </form>
      <ul className="card mt-3 divide-y divide-line">
        {sources.map((src) => (
          <li key={src.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1 text-[14px]">
              <div className={src.enabled ? "font-medium" : "text-[var(--muted)]"}>{src.name}{src.pillar !== "news" && <span className="text-[13px] font-normal text-[var(--muted)]"> · {src.pillar}</span>}</div>
              <div className={`truncate text-[12px] ${src.lastError ? "text-[var(--warn)]" : "text-[var(--subtle)]"}`}>{src.lastError ? `Could not read it: ${src.lastError}` : src.lastFetchedAt ? `Checked ${DateTime.fromJSDate(src.lastFetchedAt).toRelative()}` : "Not checked yet"}</div>
            </div>
            <form action={toggleSourceAction}><input type="hidden" name="id" value={src.id} /><button className="btn btn-ghost">{src.enabled ? "Pause" : "Resume"}</button></form>
            <form action={deleteSourceAction}><input type="hidden" name="id" value={src.id} /><button className="btn btn-ghost">Remove</button></form>
          </li>
        ))}
        {!sources.length && <li className="px-4 py-3 text-[14px] text-[var(--muted)]">Feeds are added automatically on the first check.</li>}
      </ul>
    </Section>
  );
}

/* ---------------------------------------------------------------- advanced */

function Advanced({ s, field, showX, isOwner, keep }: { s: S; field: Field; showX: boolean; isOwner: boolean; keep: (n: string, on: boolean) => ReactNode }) {
  return (
    <form action={saveAdvancedAction} className="space-y-10">
      <Section title="What goes into a post">
        <div className="card divide-y divide-line px-4">
          <Toggle name="img_linkedin" label="Add the logo of what the post is about" hint="When the story is about one company or product." on={s.images.linkedin} />
          <Toggle name="tags_linkedin" label="Add up to 3 hashtags" on={s.hashtags.linkedin} />
          <Toggle name="link_linkedin" label="Add the link to the news source" on={s.includeLinks.linkedin} />
          <Toggle name="fillerPosts" label="Fill quiet days with explainers" hint="When no story is strong enough, write a short lesson from your topics instead of leaving the time empty." on={s.fillerPosts} />
          {showX && <Toggle name="img_x" label="Add the logo on X too" on={s.images.x} />}
          {showX && <Toggle name="tags_x" label="Add 1-2 hashtags on X" on={s.hashtags.x} />}
          {isOwner && <Toggle name="link_x" label="Add the news source link on X" hint="X charges far more per post with a link." on={s.includeLinks.x} />}
        </div>
        {!showX && keep("img_x", s.images.x)}
        {!showX && keep("tags_x", s.hashtags.x)}
      </Section>

      <Section title="Content mix" hint="How often each kind of post comes up. Higher means more often; 0 turns it off.">
        <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          {([["w_own_work", "Your own work", s.pillars.own_work], ["w_news", field.newsLabel, s.pillars.news], ["w_local", s.profile.region ? `${s.profile.region} scene` : "Local scene", s.pillars.local], ["w_learning", "Lessons", s.pillars.learning]] as const).map(([n, l, v]) => (
            <label key={n} className="block"><span className="label">{l}</span><input name={n} type="number" min={0} step={1} defaultValue={v} className="input tnum" /></label>
          ))}
        </div>
      </Section>

      <Section title="Fine-tuning">
        <div className="card grid gap-4 p-4 sm:grid-cols-2">
          <label className="block"><span className="label">Plan ahead (days)</span><input name="horizonDays" type="number" min={1} max={14} defaultValue={s.horizonDays} className="input tnum" /></label>
          <label className="block"><span className="label">How strong a story must be, LinkedIn (1-10)</span><input name="linkedinMinRelevance" type="number" min={1} max={10} defaultValue={s.linkedinMinRelevance} className="input tnum" /></label>
          {showX ? (
            <label className="block"><span className="label">How strong a story must be, X (1-10)</span><input name="minRelevance" type="number" min={1} max={10} defaultValue={s.minRelevance} className="input tnum" /></label>
          ) : (
            <input type="hidden" name="minRelevance" value={s.minRelevance} />
          )}
          <label className="block sm:col-span-2"><span className="label">Your own sites</span><input name="ownDomains" defaultValue={s.ownDomains.join(", ")} placeholder="yourname.dev, blog.yourname.com" className="input" /><span className="hint mt-1 block">Links to these are treated as your own articles.</span></label>
        </div>
      </Section>

      <button className="btn-primary">Save</button>
    </form>
  );
}
