import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { requireActiveUser } from "@/server/auth";
import { approvalGate, entitlementOf } from "@/server/billing/plans";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { approvePostAction, recheckPostAction, swapVersionAction, postNowAction, rejectPostAction, removePostAction, reschedulePostAction, resolveAction, restorePostAction, rewordPostAction, scheduleDraftAction, unapprovePostAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { PostEditor } from "@/components/post-editor";
import { Icon, PlatformGlyph, StatusBadge } from "@/components/ui";
import { Flash } from "../../flash";

interface Claim { claim: string; support: string; evidence: string }
interface Mention { domain: string; title: string; url: string }
interface Verif { ok: boolean; independent: number; needed: number; reason: string; mentions: Mention[] }
interface ReviewData {
  worth_posting?: number; factual?: number; slop?: number; claims?: Claim[]; issues?: string[]; rounds?: number;
  checks?: { severity: string; message: string }[]; material?: { kind: string; label: string }; verdict?: { approved: boolean; reasons: string[] };
  verification?: Verif | null;
  evidence?: { claim: string; quote: string; found: boolean }[];
  rechecked?: number;
  move?: string;
  alternative?: { text: string; move?: string; approved: boolean; reasons: string[] } | null;
}

function Meter({ label, value }: { label: string; value?: number }) {
  const v = value ?? 0;
  const tone = v >= 8 ? "var(--good)" : v >= 6 ? "var(--warn)" : "var(--bad)";
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12px]"><span className="text-[var(--muted)]">{label}</span><span className="font-medium tnum">{v}/10</span></div>
      <div className="h-1.5 rounded-full bg-[var(--side)]"><div className="h-1.5 rounded-full" style={{ width: `${v * 10}%`, background: tone }} /></div>
    </div>
  );
}

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireActiveUser();
  // Another user's post is simply "not found".
  const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), eq(schema.posts.userId, user.id)) });
  if (!p) notFound();
  const s = await getSettings();
  const acct = await db().query.platformAccounts.findFirst({ where: and(eq(schema.platformAccounts.userId, user.id), eq(schema.platformAccounts.platform, p.platform)) });
  const r = (p.review ?? {}) as ReviewData;
  const local = DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone });
  const editable = ["scheduled", "failed", "cancelled", "draft"].includes(p.status);
  const open = ["scheduled", "draft"].includes(p.status);
  const needsApproval = approvalGate(s, entitlementOf(user).features.autoMode).blocks && p.status === "scheduled" && !p.approvedAt;
  const platformName = p.platform === "x" ? "X" : "LinkedIn";
  const name = s.profile.name || "Your Name";
  const handle = (acct?.handle ?? name.toLowerCase().replace(/[^a-z0-9]/g, "")).replace(/^@/, "");

  return (
    <div className="max-w-[1100px]">
      <Link href="/calendar" className="mb-3 inline-flex items-center gap-1 text-[13px] text-[var(--muted)] hover:text-[var(--ink)]"><Icon name="left" size={14} />Calendar</Link>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <PlatformGlyph platform={p.platform} size={22} />
        <h1 className="text-[18px] font-semibold tracking-tight">{platformName} post</h1>
        <StatusBadge status={p.status} needsApproval={needsApproval} />
        {p.fast && <span className="badge badge-warn"><Icon name="bolt" size={11} />Fast lane</span>}
        {r.alternative && <span className="badge">2 versions</span>}
        {p.expiresAt && <span className="badge badge-warn"><Icon name="clock" size={11} />Stale after {DateTime.fromJSDate(p.expiresAt, { zone: s.timezone }).toFormat("ccc d LLL HH:mm")}</span>}
        <span className="text-[13px] text-[var(--muted)] tnum">{p.status === "draft" ? "Not scheduled" : local.toFormat("cccc d LLL, HH:mm")}</span>
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-sm ml-auto"><Icon name="external" size={13} />View live post</a>}
      </div>
      {p.error && <p className="mb-3 rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{p.error}</p>}

      <PostEditor id={p.id} platform={p.platform} initialText={p.text} name={name} role={s.profile.role} handle={handle} editable={editable} />

      {needsApproval && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-3 py-2.5 text-[13px]">
          <Icon name="shield" size={15} className="text-[var(--warn)]" />
          <span className="min-w-0 flex-1">Waiting for your OK. It will not be posted until you approve it.</span>
          <form action={approvePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-accent btn-sm"><Icon name="check" size={13} />Approve</button></form>
          <form action={rejectPostAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn btn-sm" pending="Finding another story…"><Icon name="x" size={13} />Reject, find another</SubmitButton></form>
        </div>
      )}
      {s.requireApproval && p.status === "scheduled" && p.approvedAt && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--good)]/30 bg-[var(--good-soft)] px-3 py-2.5 text-[13px] text-[var(--good)]">
          <Icon name="check" size={15} />
          <span className="min-w-0 flex-1">Approved {DateTime.fromJSDate(p.approvedAt, { zone: s.timezone }).toFormat("ccc d LLL, HH:mm")}. It goes out at its scheduled time.</span>
          <form action={unapprovePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm">Withdraw approval</button></form>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {p.status === "draft" && <form action={scheduleDraftAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-accent"><Icon name="calendar" size={14} />Put on calendar</button></form>}
        {["scheduled", "failed", "draft"].includes(p.status) && <form action={postNowAction}><input type="hidden" name="id" value={p.id} /><button className="btn"><Icon name="send" size={14} />Post now</button></form>}
        {open && !needsApproval && <form action={rejectPostAction}><input type="hidden" name="id" value={p.id} /><SubmitButton className="btn" pending="Finding another story…"><Icon name="x" size={14} />Reject, find another</SubmitButton></form>}
        {open && <form action={removePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-danger"><Icon name="trash" size={14} />{p.status === "draft" ? "Discard" : "Remove from calendar"}</button></form>}
        {p.status === "rejected" && (r.rechecked ?? 0) < 2 && (
          <form action={recheckPostAction}>
            <input type="hidden" name="id" value={p.id} />
            <SubmitButton className="btn btn-accent" pending="Checking again…"><Icon name="shield" size={14} />Check again</SubmitButton>
          </form>
        )}
        {["cancelled", "failed", "expired"].includes(p.status) && <form action={restorePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn">Put back on calendar</button></form>}
      </div>

      {p.status === "unconfirmed" && (
        <div className="panel mt-4 p-4 text-[13px]">
          <p className="mb-2">The platform did not confirm this post. Check your {platformName} profile. Is it live?</p>
          <div className="flex gap-2">
            <form action={resolveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value="yes" /><button className="btn btn-sm">Yes, it is live</button></form>
            <form action={resolveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value="no" /><button className="btn btn-sm">No, it is not</button></form>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {["scheduled", "failed", "cancelled", "expired", "draft"].includes(p.status) && (
          <form action={reschedulePostAction} className="panel">
            <input type="hidden" name="id" value={p.id} />
            <div className="panel-head"><Icon name="clock" size={15} />Schedule</div>
            <div className="panel-body flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="at">Time ({s.timezone})</label>
                <input id="at" type="datetime-local" name="at" defaultValue={local.toFormat("yyyy-MM-dd'T'HH:mm")} className="input" required />
              </div>
              <button className="btn">Move</button>
            </div>
          </form>
        )}

        {r.alternative && (open || p.status === "rejected") && (
          <section className="panel">
            <div className="panel-head"><Icon name="draft" size={15} />{r.alternative.move === "explain" ? "Other version: explained simply" : "Other version: a normal take"}</div>
            <div className="panel-body space-y-3 text-[13px]">
              <p className="whitespace-pre-wrap break-words rounded-md border border-[var(--line)] bg-[var(--raised)] p-3">{r.alternative.text}</p>
              {r.alternative.approved ? (
                <p className="text-[12px] text-[var(--good)]">Passed review too.</p>
              ) : (
                <p className="text-[12px] text-[var(--warn)]">The reviewer had concerns: {r.alternative.reasons.join(" · ")}</p>
              )}
              <form action={swapVersionAction}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn"><Icon name="check" size={14} />Use this version instead</button>
              </form>
            </div>
          </section>
        )}

        {(open || p.status === "rejected") && (
          <form action={rewordPostAction} className="panel">
            <input type="hidden" name="id" value={p.id} />
            <div className="panel-head"><Icon name="pencil" size={15} />Good story, wrong wording?</div>
            <div className="panel-body space-y-3">
              <div>
                <label className="label" htmlFor="feedback">What doesn&apos;t sound like you</label>
                <textarea id="feedback" name="feedback" rows={3} required maxLength={500} className="textarea" placeholder={'e.g. "too formal, I talk casually" or "don\'t start with the company name"'} />
              </div>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="remember" defaultChecked />Remember this for future posts</label>
              <SubmitButton className="btn" pending="Rewriting…"><Icon name="pencil" size={14} />Reword it</SubmitButton>
            </div>
          </form>
        )}

        {r.material && (
          <section className="panel">
            <div className="panel-head"><Icon name="shield" size={15} />Review</div>
            <div className="panel-body space-y-4 text-[13px]">
              <p className="text-[var(--muted)]">
                Written from {r.material.kind === "news" ? "an article" : r.material.kind === "note" ? "your note" : "an evergreen topic"}: <span className="text-[var(--ink)]">{r.material.label}</span>
                {p.sourceUrl && <> · <a className="underline" href={p.sourceUrl} target="_blank" rel="noreferrer">open source</a></>}
              </p>
              <div className="grid grid-cols-3 gap-4">
                <Meter label="Worth posting" value={r.worth_posting} />
                <Meter label="Facts" value={r.factual} />
                <Meter label="Human" value={r.slop} />
              </div>
              {r.verification && (
                <p className={`rounded-md px-3 py-2 text-[12px] ${r.verification.ok ? "bg-[var(--good-soft)] text-[var(--good)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>
                  {r.verification.ok ? "Cross-checked." : "Not fully cross-checked."} {r.verification.reason}
                  {r.verification.mentions.length > 0 && <> Also reported by {r.verification.mentions.map((m) => m.domain).join(", ")}.</>}
                </p>
              )}
              {r.claims && r.claims.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">Claims checked against the source</div>
                  <ul className="divide">
                    {r.claims.map((c, i) => (
                      <li key={i} className="flex gap-2 py-1.5">
                        <Icon name={c.support === "supported" ? "check" : "alert"} size={14} className={`mt-0.5 flex-none ${c.support === "supported" ? "text-[var(--good)]" : "text-[var(--bad)]"}`} />
                        <span>{c.claim} <span className="text-[var(--subtle)]">· {c.evidence}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.evidence && r.evidence.length > 0 && (
                <div>
                  <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">Where the writer says each fact comes from (not posted)</div>
                  <ul className="divide">
                    {r.evidence.map((e, i) => (
                      <li key={i} className="py-1.5">
                        <div className="flex gap-2">
                          <Icon name={e.found ? "check" : "alert"} size={14} className={`mt-0.5 flex-none ${e.found ? "text-[var(--good)]" : "text-[var(--bad)]"}`} />
                          <span>{e.claim}</span>
                        </div>
                        <blockquote className="ml-6 mt-0.5 border-l-2 border-[var(--line)] pl-2 text-[12px] text-[var(--subtle)]">
                          &ldquo;{e.quote}&rdquo;{!e.found && <span className="text-[var(--bad)]"> · these words are not in the source</span>}
                        </blockquote>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.rechecked ? <p className="text-[12px] text-[var(--subtle)]">Checked again {r.rechecked === 1 ? "once" : "twice"} by a more careful second review.</p> : null}
              {r.verdict && !r.verdict.approved && <p className="text-[var(--bad)]">Concerns: {r.verdict.reasons.join(" · ")}</p>}
              {r.checks && r.checks.length > 0 && <ul className="text-[12px] text-[var(--subtle)]">{r.checks.map((c, i) => <li key={i}>{c.severity}: {c.message}</li>)}</ul>}
              <p className="text-[12px] text-[var(--subtle)]">Reviewed in {r.rounds ?? 1} round{(r.rounds ?? 1) === 1 ? "" : "s"}.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
