import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ItemWithSources } from "@/server/queries";
import { Badge, ScoreMeter } from "./ui";
import { ActionButton } from "./client";
import { itemAction, researchAction, writePostAction } from "@/app/actions";
import { evidenceLabel } from "./discovery-card";
import { fmtRelative } from "@/lib/format";

interface Analysis {
  headline?: string;
  summary?: string;
  whyItMatters?: string;
  opportunity?: string | null;
  whyPost?: string;
  uncertainty?: string | null;
}

/** One scannable line per discovery; details expand on demand. */
export function BriefingRow({ item, tz, rank, aiEnabled }: { item: ItemWithSources; tz: string; rank?: number; aiEnabled: boolean }) {
  const a = (item.analysis ?? {}) as Analysis;
  const src = item.sources[0];
  const ev = evidenceLabel(item);
  const openDraft = item.drafts.find((d) => !["rejected", "cancelled"].includes(d.status));

  return (
    <li className="group p-4">
      <div className="flex gap-3">
        {rank && <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-muted">{rank}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 font-semibold leading-snug">{a.headline ?? item.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {item.category && <span className="font-medium text-accent">{item.category}</span>}
                {item.timeliness === "breaking" && <Badge tone="warn">Time-sensitive</Badge>}
                <span>{src?.publisher}</span>
                <span>·</span>
                <span>{fmtRelative(item.publishedAt, tz)}</span>
                <ScoreMeter score={item.score} />
              </div>
              {(a.whyPost || a.summary) && <p className="mt-2 line-clamp-2 text-sm">{a.whyPost ?? a.summary}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {openDraft ? (
                <Link href={`/drafts/${openDraft.draftId}`} className="btn-secondary">
                  Open drafts
                </Link>
              ) : aiEnabled ? (
                <ActionButton action={writePostAction.bind(null, item.id)} className="btn-primary" pendingText="Writing… ~30s">
                  Write post
                </ActionButton>
              ) : null}
              <ActionButton action={itemAction.bind(null, item.id, "dismiss")} className="btn-ghost px-2 py-1 text-xs">
                Skip
              </ActionButton>
            </div>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer select-none text-xs text-muted hover:text-ink">Why this, and sources</summary>
            <div className="mt-2 space-y-2 rounded-lg bg-paper p-3 text-sm leading-relaxed">
              {a.summary && <p>{a.summary}</p>}
              {a.whyItMatters && (
                <p>
                  <span className="font-medium">Why it matters: </span>
                  {a.whyItMatters}
                </p>
              )}
              {a.opportunity && (
                <p>
                  <span className="font-medium">Possible opportunity (speculative): </span>
                  {a.opportunity}
                </p>
              )}
              {a.uncertainty && (
                <p className="text-warn">
                  <span className="font-medium">Uncertain: </span>
                  {a.uncertainty}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={ev.tone}>{ev.text}</Badge>
                {item.sources.slice(0, 4).map((s) => (
                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    {s.publisher} <ExternalLink size={11} />
                  </a>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {aiEnabled && !item.research && (
                  <ActionButton action={researchAction.bind(null, item.id, false)} className="btn-ghost text-xs" pendingText="Researching… ~30s">
                    Research deeper
                  </ActionButton>
                )}
                <Link href={`/discover/${item.id}`} className="btn-ghost text-xs">
                  Full details{item.research ? " & research" : ""}
                </Link>
                {item.status !== "saved" && (
                  <ActionButton action={itemAction.bind(null, item.id, "save")} className="btn-ghost text-xs">
                    Save for later
                  </ActionButton>
                )}
              </div>
            </div>
          </details>
        </div>
      </div>
    </li>
  );
}
