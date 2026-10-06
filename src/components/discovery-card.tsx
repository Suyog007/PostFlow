import Link from "next/link";
import { ExternalLink, ShieldCheck, Layers } from "lucide-react";
import type { ItemWithSources } from "@/server/queries";
import { Badge, PlatformBadge, ScoreMeter, TimelinessBadge } from "./ui";
import { ActionButton } from "./client";
import { itemAction, researchAction, ideaFromItemAction, writePostAction } from "@/app/actions";
import { fmtRelative } from "@/lib/format";

interface Analysis {
  headline?: string;
  summary?: string;
  whyItMatters?: string;
  opportunity?: string | null;
  whyPost?: string;
  uncertainty?: string | null;
  platforms?: string[];
}

export function evidenceLabel(item: ItemWithSources) {
  const n = new Set(item.sources.map((s) => s.publisher ?? s.url)).size;
  const primary = item.sources.some((s) => s.isPrimary);
  if (primary && n > 1) return { tone: "good" as const, text: `Primary source + ${n - 1} more` };
  if (primary) return { tone: "good" as const, text: "Primary source" };
  if (n >= 2) return { tone: "accent" as const, text: `${n} independent reports` };
  return { tone: "warn" as const, text: "Single report" };
}

export function DiscoveryCard({ item, tz, compact }: { item: ItemWithSources; tz: string; compact?: boolean }) {
  const a = (item.analysis ?? {}) as Analysis;
  const ev = evidenceLabel(item);
  const src = item.sources[0];
  const repo = (item.meta as { repo?: { attentionBasis?: string | null; license?: string | null } }).repo;
  const drafted = item.drafts.length > 0;

  return (
    <article className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {item.category && <Badge tone="accent">{item.category}</Badge>}
        <TimelinessBadge t={item.timeliness} />
        <span>{fmtRelative(item.publishedAt, tz)}</span>
        {src && (
          <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
            {src.publisher} <ExternalLink size={12} />
          </a>
        )}
        <span className="ml-auto">
          <ScoreMeter score={item.score} />
        </span>
      </div>

      <Link href={`/discover/${item.id}`} className="group">
        <h3 className="line-clamp-3 text-[17px] font-semibold leading-snug group-hover:text-accent">{a.headline ?? item.title}</h3>
      </Link>

      {a.summary ? <p className="text-sm leading-relaxed">{a.summary}</p> : <p className="line-clamp-3 text-sm text-muted">{item.excerpt}</p>}

      {!compact && (a.whyItMatters || a.opportunity || a.whyPost) && (
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          {a.whyItMatters && (
            <div>
              <dt className="label">Why it matters</dt>
              <dd className="leading-relaxed">{a.whyItMatters}</dd>
            </div>
          )}
          {a.opportunity && (
            <div>
              <dt className="label">Possible opportunity</dt>
              <dd className="leading-relaxed">
                {a.opportunity} <span className="text-xs text-muted">(speculative)</span>
              </dd>
            </div>
          )}
          {a.whyPost && (
            <div>
              <dt className="label">Why you might post</dt>
              <dd className="leading-relaxed">{a.whyPost}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={ev.tone}>
          <ShieldCheck size={12} /> {ev.text}
        </Badge>
        {item.sources.length > 1 && (
          <Badge>
            <Layers size={12} /> grouped {item.sources.length} reports
          </Badge>
        )}
        {repo?.attentionBasis && <Badge tone="accent">{repo.attentionBasis}</Badge>}
        {repo && <Badge>License: {repo.license ?? "none stated"}</Badge>}
        {a.uncertainty && <Badge tone="warn">Uncertain: {a.uncertainty.slice(0, 80)}{a.uncertainty.length > 80 ? "…" : ""}</Badge>}
        {a.platforms?.map((p) => <PlatformBadge key={p} platform={p} />)}
        {drafted && <Badge tone="good">Drafted</Badge>}
      </div>

      {item.scoreRow && !compact && <p className="text-xs text-muted">{item.scoreRow.explanation}</p>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {item.drafts.some((d) => !["rejected", "cancelled"].includes(d.status)) ? (
          <Link href={`/drafts/${item.drafts.find((d) => !["rejected", "cancelled"].includes(d.status))!.draftId}`} className="btn-secondary">
            Open drafts
          </Link>
        ) : (
          <ActionButton action={writePostAction.bind(null, item.id)} className="btn-primary" pendingText="Writing… ~30s">
            Write post
          </ActionButton>
        )}
        {item.research ? (
          <Link href={`/discover/${item.id}#research`} className="btn-secondary">
            View research
          </Link>
        ) : (
          <ActionButton action={researchAction.bind(null, item.id, false)} pendingText="Researching… (≈30s)">
            Research deeper
          </ActionButton>
        )}
        {item.status !== "saved" && <ActionButton action={itemAction.bind(null, item.id, "save")} className="btn-ghost">Save for later</ActionButton>}
        <ActionButton action={ideaFromItemAction.bind(null, item.id)} className="btn-ghost">
          Add to ideas
        </ActionButton>
        <ActionButton action={itemAction.bind(null, item.id, "dismiss")} className="btn-ghost">
          Skip
        </ActionButton>
      </div>
    </article>
  );
}
