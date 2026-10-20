import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { editPostAction, postNowAction, removePostAction, reschedulePostAction, resolveAction, restorePostAction, scheduleDraftAction } from "@/app/actions";
import { Flash } from "../../flash";

interface Claim { claim: string; support: string; evidence: string }
interface Mention { domain: string; title: string; url: string }
interface Verif { ok: boolean; independent: number; needed: number; reason: string; mentions: Mention[] }
interface ReviewData {
  verification?: Verif | null;
  worth_posting?: number; factual?: number; slop?: number; claims?: Claim[]; issues?: string[]; rounds?: number;
  checks?: { severity: string; message: string }[]; material?: { kind: string; label: string }; verdict?: { approved: boolean; reasons: string[] };
}

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await db().query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!p) notFound();
  const s = await getSettings();
  const r = (p.review ?? {}) as ReviewData;
  const local = DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone });
  const editable = ["scheduled", "failed", "cancelled", "draft"].includes(p.status);
  const platformName = p.platform === "x" ? "X" : "LinkedIn";

  return (
    <div className="max-w-3xl">
      <Link href="/" className="text-sm text-muted hover:text-ink">← Calendar</Link>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{platformName} post · {local.toFormat("ccc d LLL, HH:mm")}</h1>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs uppercase">{p.status}</span>
        {p.fast && <span className="text-xs text-muted">⚡ fast lane: a big story, posted outside your normal slots</span>}
        {p.expiresAt && <span className="text-xs text-muted">⏱ time-sensitive, stale after {DateTime.fromJSDate(p.expiresAt, { zone: s.timezone }).toFormat("ccc d LLL HH:mm")}</span>}
      </div>
      {p.error && <p className="mb-3 text-sm text-bad">{p.error}</p>}

      {editable ? (
        <form action={editPostAction} className="card mb-3 space-y-2 p-4">
          <input type="hidden" name="id" value={p.id} />
          <textarea name="text" defaultValue={p.text} rows={p.platform === "x" ? 5 : 14} className="input prose-post" />
          <div className="flex items-center gap-2">
            <button className="btn-primary">Save my wording</button>
            <span className="text-xs text-muted">Edited posts skip the reviewer; you are the editor now.</span>
          </div>
        </form>
      ) : (
        <div className="card prose-post mb-3 p-4">{p.text}</div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {p.status === "draft" && (
          <form action={scheduleDraftAction}><input type="hidden" name="id" value={p.id} /><button className="btn-primary">Put on calendar (next free slot)</button></form>
        )}
        {["scheduled", "draft"].includes(p.status) && (
          <form action={removePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn-danger">Remove from calendar</button></form>
        )}
        {["cancelled", "failed", "expired"].includes(p.status) && (
          <form action={restorePostAction}><input type="hidden" name="id" value={p.id} /><button className="btn-secondary">Put back on calendar</button></form>
        )}
        {["scheduled", "failed", "draft"].includes(p.status) && (
          <form action={postNowAction}><input type="hidden" name="id" value={p.id} /><button className="btn-secondary">Post now</button></form>
        )}
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="btn-secondary">View live post ↗</a>}
      </div>

      {p.status === "unconfirmed" && (
        <div className="card mb-6 p-4 text-sm">
          <p className="mb-2">The platform did not confirm this post. Check your {platformName} profile. Was it posted?</p>
          <div className="flex gap-2">
            <form action={resolveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value="yes" /><button className="btn-secondary">Yes, it is live</button></form>
            <form action={resolveAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="published" value="no" /><button className="btn-secondary">No, it is not</button></form>
          </div>
        </div>
      )}

      {["scheduled", "failed", "cancelled", "expired", "draft"].includes(p.status) && (
        <form action={reschedulePostAction} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
          <input type="hidden" name="id" value={p.id} />
          <div>
            <label className="label">Move to ({s.timezone})</label>
            <input type="datetime-local" name="at" defaultValue={local.toFormat("yyyy-MM-dd'T'HH:mm")} className="input" required />
          </div>
          <button className="btn-secondary">Reschedule</button>
        </form>
      )}

      {r.material && (
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-medium">Why the reviewer approved it</h2>
          <p className="mb-2 text-muted">
            Based on {r.material.kind === "news" ? "an article" : r.material.kind === "note" ? "your note" : "an evergreen topic"}: {r.material.label}
            {p.sourceUrl && <> · <a className="underline" href={p.sourceUrl} target="_blank" rel="noreferrer">source ↗</a></>}
          </p>
          <div className="mb-3 flex gap-4 text-xs">
            <span>Worth posting <strong>{r.worth_posting}/10</strong></span>
            <span>Facts <strong>{r.factual}/10</strong></span>
            <span>Human-sounding <strong>{r.slop}/10</strong></span>
            <span>Review rounds <strong>{r.rounds}</strong></span>
          </div>
          {r.claims && r.claims.length > 0 && (
            <ul className="mb-3 space-y-1 text-xs">
              {r.claims.map((c, i) => (
                <li key={i}><span className={c.support === "supported" ? "text-good" : "text-bad"}>{c.support === "supported" ? "✓" : "✗"}</span> {c.claim} <span className="text-muted">— {c.evidence}</span></li>
              ))}
            </ul>
          )}
          {r.verification && (
            <p className={`mb-3 text-xs ${r.verification.ok ? "text-good" : "text-warn"}`}>
              {r.verification.ok ? "✓ Cross-checked" : "⚠ Not fully cross-checked"}: {r.verification.reason}
              {r.verification.mentions.length > 0 && <> Also reported by {r.verification.mentions.map((m) => m.domain).join(", ")}.</>}
            </p>
          )}
          {r.verdict && !r.verdict.approved && <p className="text-bad">Rejected: {r.verdict.reasons.join(" · ")}</p>}
          {r.checks && r.checks.length > 0 && <ul className="text-xs text-muted">{r.checks.map((c, i) => <li key={i}>{c.severity}: {c.message}</li>)}</ul>}
        </section>
      )}
    </div>
  );
}
