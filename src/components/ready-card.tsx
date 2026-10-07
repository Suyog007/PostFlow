import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ReadyGroup } from "@/server/queries";
import { validateParts } from "@/server/drafts/state";
import { PlatformBadge } from "./ui";
import { ActionButton, ExpandableText } from "./client";
import { approveQuickAction, rejectAction, rejectIdeaAction } from "@/app/actions";

/**
 * A ready-to-post idea: the actual post text per platform, with Approve / Reject.
 * Kept compact on purpose (preview text + one action row); full text lives in the draft screen.
 */
export function ReadyCard({ group, whenLabel }: { group: ReadyGroup; whenLabel: (draftId: string) => string }) {
  return (
    <article className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-accent">Suggested: post about this</div>
            <h3 className="mt-0.5 text-[15px] font-semibold leading-snug">{group.title}</h3>
            {group.why && <p className="mt-1 line-clamp-2 text-sm text-muted">{group.why}</p>}
          </div>
          {group.source && (
            <a href={group.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline">
              {group.source.publisher ?? "Source"} <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <div className={group.drafts.length > 1 ? "grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0" : ""}>
        {group.drafts.map((d) => {
          const parts = d.revision?.parts ?? [];
          const problems = validateParts(d.platform, parts);
          const review = (d.revision?.review ?? null) as { quality?: { severity: string }[]; fabricatedExperience?: boolean; unsupportedClaims?: string[] } | null;
          const notes =
            (review?.quality ?? []).filter((q) => q.severity === "warn").length +
            (review?.fabricatedExperience ? 1 : 0) +
            (review?.unsupportedClaims?.length ?? 0);
          return (
            <div key={d.id} className="flex flex-col gap-2.5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={d.platform} />
                {notes > 0 && (
                  <Link href={`/drafts/${d.id}`} className="text-xs font-medium text-warn hover:underline" title="See the review notes on the draft screen">
                    {notes} review note{notes > 1 ? "s" : ""} before approving
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                {problems.length === 0 && (
                  <ActionButton action={approveQuickAction.bind(null, d.id)} className="btn-primary" pendingText="Approving…">
                    Approve · {whenLabel(d.id)}
                  </ActionButton>
                )}
                <span className="flex items-center gap-2 text-xs">
                  <Link href={`/drafts/${d.id}`} className="text-muted hover:text-ink hover:underline">
                    Edit
                  </Link>
                  <span className="text-muted/50">·</span>
                  <ActionButton action={rejectAction.bind(null, d.id)} className="text-muted hover:text-ink hover:underline">
                    Reject
                  </ActionButton>
                </span>
              </div>
              {problems.length > 0 && <p className="text-xs text-bad">{problems.join(" ")} Edit it before approving.</p>}
              <ExpandableText lines={parts.length > 1 ? 5 : 4}>
                <div className="space-y-2">
                  {parts.map((p, i) => (
                    <p key={i} className="prose-post text-sm">
                      {parts.length > 1 && <span className="mr-1 text-xs text-muted">{i + 1}/{parts.length}</span>}
                      {p}
                    </p>
                  ))}
                </div>
              </ExpandableText>
            </div>
          );
        })}
      </div>

      {group.itemId && (
        <div className="flex justify-end border-t border-line px-4 py-1.5">
          <ActionButton action={rejectIdeaAction.bind(null, group.itemId)} className="btn-ghost text-xs">
            Not interested in this idea
          </ActionButton>
        </div>
      )}
    </article>
  );
}
