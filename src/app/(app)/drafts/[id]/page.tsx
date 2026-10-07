import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getUserPreferences, type Preferences } from "@/server/preferences";
import { getDraftDetail } from "@/server/queries";
import { getValidApproval, platformSlotContext } from "@/server/drafts/service";
import { suggestSlot } from "@/server/scheduling/rules";
import { db, schema } from "@/server/db/client";
import { llmConfigured } from "@/server/llm";
import { imageGenProvider } from "@/server/images/generate";
import { latestMetricsForScheduledPost } from "@/server/metrics";
import { Badge, Notice, PlatformBadge, StatusBadge, TimelinessBadge } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/client";
import { RescheduleForm } from "@/components/schedule-form";
import { DraftWorkbench } from "@/components/workbench";
import {
  cancelScheduleAction,
  confirmNotPublishedAction,
  confirmPublishedAction,
  recordMetricsAction,
  reopenAction,
  retryAction,
  writePlatformAction,
} from "@/app/actions";
import { fmtDateTime, fmtRelative, formatLabel, platformName, toLocalInput } from "@/lib/format";

type Detail = NonNullable<Awaited<ReturnType<typeof getDraftDetail>>>;

export default async function DraftWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const main = await getDraftDetail(userId, (await params).id);
  if (!main) notFound();
  const { draft, item, idea } = main;

  // The workspace shows one column per platform for the same source (discovery or idea).
  const columns: Partial<Record<"linkedin" | "x", Detail>> = { [draft.platform]: main };
  if (draft.itemId || draft.ideaId) {
    const siblings = await db().query.drafts.findMany({
      where: and(
        eq(schema.drafts.userId, userId),
        or(draft.itemId ? eq(schema.drafts.itemId, draft.itemId) : undefined, draft.ideaId ? eq(schema.drafts.ideaId, draft.ideaId) : undefined),
      ),
      orderBy: desc(schema.drafts.createdAt),
    });
    for (const p of ["linkedin", "x"] as const) {
      if (columns[p]) continue;
      // Prefer an open draft; otherwise the latest one.
      const s = siblings.find((d) => d.platform === p && !["rejected", "cancelled"].includes(d.status)) ?? siblings.find((d) => d.platform === p);
      if (s) columns[p] = (await getDraftDetail(userId, s.id)) ?? undefined;
    }
  }

  const a = (item?.analysis ?? null) as { headline?: string; summary?: string; whyPost?: string } | null;
  const title = a?.headline ?? item?.title ?? idea?.title ?? "Your post";
  const ref = draft.itemId ? { itemId: draft.itemId } : draft.ideaId ? { ideaId: draft.ideaId } : null;

  return (
    <div>
      <Link href="/drafts" className="text-sm text-muted hover:text-ink">
        ← All drafts
      </Link>

      <header className="mb-6 mt-2">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Review & schedule</div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {a?.summary && <p className="mt-2 max-w-3xl text-sm text-muted">{a.summary}</p>}
        {item && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {item.sources.slice(0, 3).map((s) => (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                {s.publisher} <ExternalLink size={11} />
              </a>
            ))}
            <Link href={`/discover/${item.id}`} className="text-muted hover:text-ink">
              Full research & sources →
            </Link>
          </div>
        )}
        {idea?.notes && <p className="prose-post mt-2 max-w-3xl text-sm text-muted">{idea.notes}</p>}
      </header>

      <p className="mb-4 text-sm text-muted">
        Each platform is approved separately. Edit the text if you like, then press the blue button. Nothing goes out without that click.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {(["linkedin", "x"] as const).map((p) =>
          columns[p] ? (
            <PlatformColumn key={p} d={columns[p]!} prefs={prefs} userId={userId} />
          ) : ref ? (
            <div key={p} className="card flex flex-col items-start gap-3 border-dashed p-5">
              <PlatformBadge platform={p} />
              <p className="text-sm text-muted">No {platformName(p)} version yet. It may have been judged a poor fit, but you can still write one.</p>
              {llmConfigured() && (
                <ActionButton action={writePlatformAction.bind(null, ref, p)} className="btn-secondary" pendingText="Writing… (~20s)">
                  Write a {platformName(p)} version
                </ActionButton>
              )}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

async function PlatformColumn({ d, prefs, userId }: { d: Detail; prefs: Preferences; userId: string }) {
  const { draft, revisions, schedules, pubs, events } = d;
  const tz = prefs.timezone;
  const current = revisions.find((r) => r.id === draft.currentRevisionId)!;
  const valid = await getValidApproval(db(), draft.id);
  const live = schedules.find((s) => ["scheduled", "publishing", "unknown", "needs_review"].includes(s.state));
  const failed = schedules.find((s) => s.state === "failed");
  const published = schedules.find((s) => s.state === "published");
  const name = platformName(draft.platform);
  const now = new Date();
  const minLocal = toLocalInput(new Date(now.getTime() + 5 * 60_000), tz);
  const review = current.review as { unsupportedClaims?: string[]; fabricatedExperience?: boolean; quality?: { code: string; severity: string; message: string }[] } | null;
  const media = (current.media ?? []).map((m) => ({ id: m.mediaId, alt: m.alt }));
  const quality = review?.quality ?? [];

  const reviewable = ["draft", "awaiting_approval", "approved", "failed"].includes(draft.status) && !live;
  let suggestion: { local: string; label: string; reason: string } | null = null;
  if (reviewable) {
    const s = suggestSlot(await platformSlotContext(db(), userId, draft.platform, now, draft.id), draft.timeliness, draft.freshUntil);
    if (s) suggestion = { local: toLocalInput(s.at, tz), label: fmtDateTime(s.at, tz, "ccc d LLL, h:mm a"), reason: s.reason };
  }

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={draft.platform} />
        <StatusBadge status={live && live.state !== "scheduled" ? live.state : draft.status} />
        {current.format !== "post" && <Badge tone="accent">{formatLabel(current.format)}</Badge>}
        <TimelinessBadge t={draft.timeliness} />
        {revisions.length > 1 && <span className="text-xs text-muted">version {current.revisionNo}</span>}
      </div>

      {(review?.fabricatedExperience || (review?.unsupportedClaims?.length ?? 0) > 0) && reviewable && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
          <div className="font-medium text-warn">Worth a second look before approving</div>
          {review?.fabricatedExperience && <div>It may imply you personally tried or built something.</div>}
          {review?.unsupportedClaims?.map((c) => (
            <div key={c}>Possibly unsupported: “{c}”</div>
          ))}
        </div>
      )}

      {failed && draft.status === "failed" && (
        <div className="space-y-2">
          <Notice tone="bad">Publishing failed: {failed.lastError}</Notice>
          {valid && (
            <ActionButton action={retryAction.bind(null, failed.id)} className="btn-secondary" pendingText="Retrying…">
              Retry now
            </ActionButton>
          )}
        </div>
      )}

      {reviewable && (
        <DraftWorkbench
          draftId={draft.id}
          platform={draft.platform}
          initial={current.parts}
          approved={Boolean(valid)}
          suggestion={suggestion}
          minLocal={minLocal}
          paused={prefs.platforms[draft.platform].paused}
          aiEnabled={llmConfigured()}
          media={media}
          quality={quality}
          linkInReply={prefs.platforms[draft.platform].linkInReply}
          imageGenEnabled={imageGenProvider() !== null}
          isCarousel={current.format === "carousel"}
        />
      )}

      {!reviewable && (
        <div className="space-y-2">
          {current.parts.map((p, i) => (
            <p key={i} className={`prose-post rounded-lg bg-paper p-3 text-[15px] ${["rejected", "cancelled"].includes(draft.status) ? "opacity-60" : ""}`}>
              {p}
            </p>
          ))}
          {media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {media.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.id} src={`/api/media/${m.id}`} alt={m.alt} className="w-36 rounded-md border border-line" />
              ))}
            </div>
          )}
        </div>
      )}

      {live && (
        <div className="space-y-3 rounded-lg border border-line bg-paper p-4 text-sm">
          <div>
            <div className="label">
              {live.state === "needs_review" ? "Held for your review" : live.state === "unknown" ? "Checking whether it posted" : live.state === "publishing" ? "Publishing now" : "Scheduled for"}
            </div>
            <div className="text-lg font-semibold">{fmtDateTime(live.scheduledAt, tz, "cccc d LLL, h:mm a")}</div>
            {prefs.platforms[draft.platform].paused && <p className="text-xs text-warn">{name} publishing is paused; this will wait until you resume.</p>}
          </div>
          {live.reviewReason && <p className="text-warn">{live.reviewReason}</p>}
          {live.state === "unknown" && (
            <>
              <p className="text-warn">{live.lastError}</p>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={confirmPublishedAction.bind(null, live.id, undefined)}>It&apos;s on my profile</ActionButton>
                <ActionButton action={confirmNotPublishedAction.bind(null, live.id)}>It was not posted</ActionButton>
              </div>
            </>
          )}
          {(live.state === "scheduled" || live.state === "needs_review") && (
            <>
              <RescheduleForm scheduledPostId={live.id} current={toLocalInput(live.scheduledAt, tz)} minLocal={minLocal} />
              <ActionButton action={cancelScheduleAction.bind(null, live.id)} className="btn-ghost text-bad" confirm="Click again to unschedule">
                Unschedule (keeps it approved, so you can edit)
              </ActionButton>
            </>
          )}
        </div>
      )}

      {published && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="good">Published {fmtDateTime(published.publishedAt, tz)}</Badge>
            {published.externalUrl && (
              <a href={published.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                View on {name} <ExternalLink size={12} />
              </a>
            )}
          </div>
          <MetricsBlock platform={draft.platform} scheduledPostId={published.id} tz={tz} />
        </div>
      )}

      {(draft.status === "rejected" || draft.status === "cancelled") && (
        <ActionButton action={reopenAction.bind(null, draft.id)} className="btn-secondary self-start">
          Bring back for review
        </ActionButton>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted">History{pubs.length ? " & publishing log" : ""}</summary>
        <ol className="mt-2 space-y-1 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-28 shrink-0 text-muted">{fmtDateTime(e.at, tz, "d LLL, h:mm a")}</span>
              <span>{e.action.replace(/_/g, " ")}</span>
            </li>
          ))}
          {pubs.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className="w-28 shrink-0 text-muted">{fmtDateTime(p.startedAt, tz, "d LLL, h:mm a")}</span>
              <span>
                attempt {p.attemptNo}: {p.status}
                {p.error ? ` — ${p.error}` : ""}
                {p.costUsd != null ? ` · ≈$${p.costUsd.toFixed(3)}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/** Post-publish numbers: X fills itself; LinkedIn numbers are typed in from post analytics. */
async function MetricsBlock({ platform, scheduledPostId, tz }: { platform: "x" | "linkedin"; scheduledPostId: string; tz: string }) {
  const { latest } = await latestMetricsForScheduledPost(scheduledPostId);
  return (
    <div className="space-y-2 rounded-lg border border-line bg-paper p-3 text-xs">
      <div className="label">{platform === "x" ? "Performance — refreshes automatically every ~6 hours" : "Performance — type in the numbers from the post's analytics"}</div>
      {latest ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>{latest.impressions?.toLocaleString() ?? "—"}</strong> impressions
          </span>
          <span>
            <strong>{latest.likes ?? "—"}</strong> likes
          </span>
          <span>
            <strong>{latest.reposts ?? "—"}</strong> reposts
          </span>
          <span>
            <strong>{latest.replies ?? "—"}</strong> replies
          </span>
          <span className="text-muted">as of {fmtRelative(latest.capturedAt, tz)}</span>
        </div>
      ) : (
        <p className="text-muted">{platform === "x" ? "Numbers appear within a few hours of publishing." : "No numbers yet."}</p>
      )}
      {platform === "linkedin" && (
        <ActionForm action={recordMetricsAction} className="flex flex-wrap items-end gap-2" submit="Save numbers" submitClass="btn-secondary text-xs">
          <input type="hidden" name="scheduledPostId" value={scheduledPostId} />
          <NumInput name="impressions" label="Impressions" defaultValue={latest?.impressions ?? undefined} />
          <NumInput name="likes" label="Likes" defaultValue={latest?.likes ?? undefined} />
          <NumInput name="reposts" label="Reposts" defaultValue={latest?.reposts ?? undefined} />
          <NumInput name="replies" label="Comments" defaultValue={latest?.replies ?? undefined} />
        </ActionForm>
      )}
    </div>
  );
}

function NumInput({ name, label, defaultValue }: { name: string; label: string; defaultValue?: number }) {
  return (
    <label className="text-[11px] text-muted">
      {label}
      <input name={name} type="number" min={0} className="input mt-0.5 w-24" defaultValue={defaultValue} />
    </label>
  );
}
