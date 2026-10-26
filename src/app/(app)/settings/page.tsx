import { DateTime } from "luxon";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { formatSlots } from "@/server/slots-parse";
import { myChecks } from "@/server/health";
import { requireActiveUser } from "@/server/auth";
import { approvalGate, entitlementOf } from "@/server/billing/plans";
import { telegramConfigured, telegramLinkUrl } from "@/server/telegram";
import { isPlatformConfigured } from "@/server/platforms/accounts";
import { addSourceAction, connectAction, deleteSourceAction, disconnectAction, runTickAction, saveFastLaneAction, saveProfileAction, saveSlotsAction, unlinkTelegramAction, toggleSourceAction, togglePauseAction, toggleApprovalAction, removeStyleNoteAction } from "@/app/actions";
import { Flash } from "../flash";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const ent = entitlementOf(user);
  const pro = (label: string) => <Link href="/billing" className="badge badge-accent ml-1" title={`${label} is part of Pro`}>Pro</Link>;
  const s = await getSettings();
  const checks = await myChecks();
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const sources = await db().select().from(schema.sources).where(eq(schema.sources.userId, user.id)).orderBy(asc(schema.sources.pillar), asc(schema.sources.name));
  const tgLink = user.telegramChatId ? null : await telegramLinkUrl();
  const gate = approvalGate(s, ent.features.autoMode);
  const approvalOn = gate.blocks;
  const acct = (p: string) => accounts.find((a) => a.platform === p && a.status !== "disconnected");

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="display text-[34px]">Settings</h1>
      <Flash ok={sp.ok ?? (sp.connected ? `Connected ${sp.connected}.` : undefined)} error={sp.error} />
      {/* On phones the bottom tab bar has no room for these. */}
      <nav className="flex gap-2 md:hidden">
        <Link href="/billing" className="btn btn-sm">Billing</Link>
        <Link href="/account" className="btn btn-sm">Account</Link>
        {user.isOwner && <Link href="/admin" className="btn btn-sm">Admin</Link>}
      </nav>

      <section>
        <h2 className="display mb-3 text-[24px]">Status</h2>
        <ul className="card divide-y divide-line text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-3 p-3">
              <span className={c.ok ? "text-good" : "text-warn"}>{c.ok ? "✓" : "●"}</span>
              <div><span className="font-medium">{c.label}</span>{!c.ok && <p className="text-muted">{c.hint}</p>}</div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <form action={togglePauseAction}><button className={s.paused ? "btn-primary" : "btn-secondary"}>{s.paused ? "Resume autopilot" : "Pause everything"}</button></form>
          <form action={runTickAction}><button className="btn-secondary">Check for new material now</button></form>
        </div>
      </section>

      <section>
        <h2 className="display mb-3 text-[24px]">Publishing mode</h2>
        <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{approvalOn ? "Approval required" : "Auto mode"}{!ent.features.autoMode && pro("Auto mode")}</div>
            <p className="text-muted">{approvalOn ? "Posts are only published if you approve them before their time. If you do nothing, the time passes, the post is skipped and the calendar moves on." : "Posts that pass review go out at their scheduled time without asking."}</p>
          </div>
          {ent.features.autoMode && <form action={toggleApprovalAction}><button className="btn-secondary">{approvalOn ? "Switch to auto mode" : "Require approval"}</button></form>}
        </div>
      </section>

      <section>
        <h2 className="display mb-3 text-[24px]">Wording you asked for</h2>
        {s.styleNotes.length ? (
          <ul className="card divide-y divide-line text-sm">
            {s.styleNotes.map((n, i) => (
              <li key={i} className="flex items-center gap-3 p-3">
                <span className="min-w-0 flex-1">{n}</span>
                <form action={removeStyleNoteAction}><input type="hidden" name="i" value={i} /><button className="btn-secondary">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None yet. When you reword a post and tick &quot;Remember this&quot;, it shows up here and every new post follows it.</p>
        )}
      </section>

      <section id="accounts" className="scroll-mt-6">
        <h2 className="display mb-3 text-[24px]">Accounts</h2>
        <div className="card divide-y divide-line text-sm">
          {(["linkedin", "x"] as const).map((p) => {
            const a = acct(p);
            return (
              <div key={p} className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <div className="font-medium">{p === "x" ? "X" : "LinkedIn"}</div>
                  <div className="text-muted">{a ? `${a.handle ?? "connected"}${a.status === "error" ? ` · needs reconnect: ${a.lastError}` : ""}` : isPlatformConfigured(p) ? "Not connected" : "Not available yet"}</div>
                </div>
                <form action={connectAction}><input type="hidden" name="platform" value={p} /><button className="btn-secondary" disabled={!isPlatformConfigured(p)}>{a ? "Reconnect" : "Connect"}</button></form>
                {a && <form action={disconnectAction}><input type="hidden" name="platform" value={p} /><button className="btn-ghost">Disconnect</button></form>}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="display mb-3 text-[24px]">Posting schedule</h2>
        <form action={saveSlotsAction} className="card space-y-2 p-4">
          <p className="text-sm text-muted">One slot per line, in {s.timezone}: <code>platform days time</code>. Autopilot fills these slots {s.horizonDays} day(s) ahead.</p>
          <textarea name="slots" rows={5} defaultValue={formatSlots(s.slots)} className="textarea font-mono text-sm" />
          <button className="btn-primary">Save schedule</button>
        </form>
      </section>

      <section>
        <h2 className="display mb-3 text-[24px]">Fast lane{!ent.features.fastLane && pro("The fast lane")}</h2>
        <form action={saveFastLaneAction} className="card space-y-3 p-4 text-sm">
          <p className="text-muted">When a breaking story is a clear opportunity for builders, post about it soon instead of waiting for the next slot. You get the lead time below (and a Telegram Remove button) to veto it.</p>
          <label className="flex items-center gap-2"><input type="checkbox" name="fl_enabled" defaultChecked={s.fastLane.enabled && ent.features.fastLane} disabled={!ent.features.fastLane} /> Fast lane on</label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Min. score (7-10)</label><input name="fl_min" type="number" min={7} max={10} defaultValue={s.fastLane.minRelevance} className="input" /></div>
            <div><label className="label">Max per day, per platform</label><input name="fl_max" type="number" min={1} max={3} defaultValue={s.fastLane.maxPerDay} className="input" /></div>
            <div><label className="label">Lead time (minutes)</label><input name="fl_lead" type="number" min={15} max={240} defaultValue={s.fastLane.leadMinutes} className="input" /></div>
            <div><label className="label">Quiet from</label><input name="fl_qs" defaultValue={s.fastLane.quietStart} className="input" /></div>
            <div><label className="label">Quiet until</label><input name="fl_qe" defaultValue={s.fastLane.quietEnd} className="input" /></div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2"><input type="checkbox" name="fl_x" defaultChecked={s.fastLane.platforms.includes("x")} /> X</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="fl_linkedin" defaultChecked={s.fastLane.platforms.includes("linkedin")} /> LinkedIn</label>
          </div>
          <button className="btn-primary">Save fast lane</button>
        </form>
      </section>

      <section id="profile" className="scroll-mt-6">
        <h2 className="display mb-3 text-[24px]">You and your voice</h2>
        <form action={saveProfileAction} className="card space-y-3 p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Name</label><input name="name" defaultValue={s.profile.name} className="input" /></div>
            <div><label className="label">Role</label><input name="role" defaultValue={s.profile.role} placeholder="e.g. Founder of a dev-tools startup" className="input" /></div>
          </div>
          <div><label className="label">Your region, for local tech scene posts (optional)</label><input name="region" defaultValue={s.profile.region} placeholder="e.g. Berlin, Nepal, Lagos" className="input" /></div>
          <div><label className="label">Short bio</label><textarea name="bio" rows={2} defaultValue={s.profile.bio} className="textarea" /></div>
          <div><label className="label">Topics you can credibly write about (comma or line separated)</label><textarea name="expertise" rows={2} defaultValue={s.profile.expertise.join(", ")} className="textarea" /></div>
          <div><label className="label">Voice</label><textarea name="voice" rows={2} defaultValue={s.profile.voice} className="textarea" /></div>
          <div><label className="label">Never write about</label><textarea name="avoid" rows={2} defaultValue={s.profile.avoid} className="textarea" /></div>
          <div>
            <label className="label">Content mix (relative weights)</label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["w_own_work", "My work", s.pillars.own_work], ["w_news", "Tech news", s.pillars.news], ["w_local", s.profile.region ? `${s.profile.region} scene` : "Local scene", s.pillars.local], ["w_learning", "Learning", s.pillars.learning]] as const).map(([n, l, v]) => (
                <div key={n}><span className="text-xs text-muted">{l}</span><input name={n} type="number" min={0} step={1} defaultValue={v} className="input" /></div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Timezone</label><input name="timezone" defaultValue={s.timezone} className="input" /></div>
            <div><label className="label">Plan ahead (days)</label><input name="horizonDays" type="number" min={1} max={14} defaultValue={s.horizonDays} className="input" /></div>
            <div><label className="label">Min. news score, X (1-10)</label><input name="minRelevance" type="number" min={1} max={10} defaultValue={s.minRelevance} className="input" /></div>
            <div><label className="label">Min. news score, LinkedIn (1-10)</label><input name="linkedinMinRelevance" type="number" min={1} max={10} defaultValue={s.linkedinMinRelevance} className="input" /></div>
          </div>
          <div><label className="label">Your own sites (links to these are treated as your own articles)</label><input name="ownDomains" defaultValue={s.ownDomains.join(", ")} placeholder="yourname.dev, blog.yourname.com" className="input" /></div>
          <label className="flex items-center gap-2"><input type="checkbox" name="fillerPosts" defaultChecked={s.fillerPosts} /> Fill empty slots with evergreen explainers when there is nothing strong to post <span className="text-xs text-muted">(off: the slot stays empty)</span></label>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2"><input type="checkbox" name="tags_x" defaultChecked={s.hashtags.x} /> Add 1-2 hashtags on X</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="tags_linkedin" defaultChecked={s.hashtags.linkedin} /> Add up to 3 hashtags on LinkedIn</label>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2"><input type="checkbox" name="img_linkedin" defaultChecked={s.images.linkedin} /> Add a picture on LinkedIn posts</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="img_x" defaultChecked={s.images.x} /> Add a picture on X posts</label>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2"><input type="checkbox" name="link_linkedin" defaultChecked={s.includeLinks.linkedin} /> Add the news source link on LinkedIn</label>
            {user.isOwner && <label className="flex items-center gap-2"><input type="checkbox" name="link_x" defaultChecked={s.includeLinks.x} /> Add the news source link on X <span className="text-xs text-muted">(X charges far more per post with a link)</span></label>}
          </div>
          <button className="btn-primary">Save</button>
        </form>
      </section>

      <section id="telegram" className="scroll-mt-6">
        <h2 className="display mb-3 text-[24px]">Telegram</h2>
        <div className="card space-y-3 p-4 text-sm">
          <p className="text-muted">Get every new post in Telegram with Approve and Remove buttons, and message the bot to add notes or ask for a post. Free.</p>
          {user.telegramChatId ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 font-medium text-good">✓ Linked</span>
              <form action={unlinkTelegramAction}><button className="btn-ghost">Disconnect</button></form>
            </div>
          ) : tgLink ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 text-muted">Open the link, press <strong>Start</strong> in Telegram, then come back.</span>
              <a href={tgLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Connect Telegram</a>
            </div>
          ) : (
            <p className="text-muted">{telegramConfigured() ? "Telegram linking is being set up." : "Telegram is not available yet."}</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="display mb-3 text-[24px]">News sources <span className="text-sm font-normal text-muted">· {sources.filter((x) => x.url !== "tips://manual").length} of {ent.quota.feeds}</span></h2>
        <ul className="card divide-y divide-line text-sm">
          {sources.map((src) => (
            <li key={src.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className={src.enabled ? "font-medium" : "text-muted"}>{src.name} <span className="text-xs text-muted">· {src.pillar}</span></div>
                <div className="truncate text-xs text-muted">{src.lastError ? `Error: ${src.lastError}` : src.lastFetchedAt ? `Checked ${DateTime.fromJSDate(src.lastFetchedAt).toRelative()}` : "Not checked yet"}</div>
              </div>
              <form action={toggleSourceAction}><input type="hidden" name="id" value={src.id} /><button className="btn-ghost">{src.enabled ? "Disable" : "Enable"}</button></form>
              <form action={deleteSourceAction}><input type="hidden" name="id" value={src.id} /><button className="btn-ghost">Remove</button></form>
            </li>
          ))}
          {!sources.length && <li className="p-3 text-muted">Feeds are added automatically on the first scheduler pass.</li>}
        </ul>
        <form action={addSourceAction} className="card mt-3 flex flex-wrap gap-2 p-3">
          <input name="name" placeholder="Name" className="input w-40" />
          <input name="url" placeholder="https://example.com/feed.xml" className="input min-w-60 flex-1" required />
          <select name="pillar" className="input w-auto"><option value="news">News</option><option value="local">{s.profile.region ? `${s.profile.region} scene` : "Local scene"}</option></select>
          <button className="btn-secondary">Add feed</button>
        </form>
      </section>
    </div>
  );
}
