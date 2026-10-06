import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getUserPreferences } from "@/server/preferences";
import { getItemDetail } from "@/server/queries";
import type { Research } from "@/server/llm/prompts";
import { Badge, Empty, PageHeader, PlatformBadge, PlatformChecks, ScoreMeter, Section, StatusBadge, TimelinessBadge } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/client";
import { evidenceLabel } from "@/components/discovery-card";
import { generateAction, ideaFromItemAction, itemAction, researchAction, writePostAction } from "@/app/actions";
import { fmtDateTime, fmtRelative } from "@/lib/format";

const VERIFICATION: Record<string, ["good" | "accent" | "warn" | "neutral" | "bad", string]> = {
  primary_source: ["good", "Primary source"],
  multi_source: ["good", "Multiple sources"],
  single_source: ["warn", "Single source"],
  unverified: ["neutral", "Unverified"],
  disputed: ["bad", "Disputed"],
};
const KIND: Record<string, string> = { fact: "Reported fact", interpretation: "Interpretation", prediction: "Prediction", speculation: "Speculative opportunity" };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const tz = prefs.timezone;
  const detail = await getItemDetail((await params).id);
  if (!detail) notFound();
  const { item, claims, drafts } = detail;
  const a = (item.analysis ?? {}) as Record<string, unknown> & { headline?: string; summary?: string; whyItMatters?: string; opportunity?: string | null; whyPost?: string; uncertainty?: string | null; platforms?: string[]; facts?: string[] };
  const r = item.research as Research | null;
  const ev = evidenceLabel(item);
  const repo = (item.meta as { repo?: Record<string, unknown> & { measuredGrowth?: { starsGained: number; days: number } | null } }).repo;
  const s = item.scoreRow;

  return (
    <div className="max-w-4xl">
      <Link href="/discover" className="text-sm text-muted hover:text-ink">
        ← Discover
      </Link>
      <PageHeader
        title={a.headline ?? item.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {item.category && <Badge tone="accent">{item.category}</Badge>}
            <TimelinessBadge t={item.timeliness} />
            <span>Published {fmtRelative(item.publishedAt, tz)}</span>
            <Badge tone={ev.tone}>{ev.text}</Badge>
            <ScoreMeter score={item.score} />
            {item.status === "saved" && <Badge tone="good">Saved</Badge>}
            {item.status === "dismissed" && <Badge>Dismissed</Badge>}
          </span>
        }
        actions={
          <>
            {item.status !== "saved" && <ActionButton action={itemAction.bind(null, item.id, "save")}>Save</ActionButton>}
            <ActionButton action={ideaFromItemAction.bind(null, item.id)} className="btn-ghost">Add to ideas</ActionButton>
            {item.status !== "dismissed" && <ActionButton action={itemAction.bind(null, item.id, "dismiss")} className="btn-ghost">Dismiss</ActionButton>}
          </>
        }
      />

      {a.summary && (
        <Section title="Summary">
          <div className="card space-y-3 p-5 text-sm leading-relaxed">
            <p>{a.summary}</p>
            {a.whyItMatters && <p><span className="font-medium">Why it matters: </span>{a.whyItMatters}</p>}
            {a.opportunity && <p><span className="font-medium">Possible opportunity (speculative): </span>{a.opportunity}</p>}
            {a.whyPost && <p><span className="font-medium">Why you might post: </span>{a.whyPost}</p>}
            {a.uncertainty && <p className="text-warn"><span className="font-medium">What&apos;s uncertain: </span>{a.uncertainty}</p>}
          </div>
        </Section>
      )}

      {repo && (
        <Section title="Repository signals (GitHub API)">
          <div className="card grid gap-3 p-5 text-sm sm:grid-cols-3">
            <Stat label="Stars" value={Number(repo.stars).toLocaleString()} />
            <Stat label="Forks" value={Number(repo.forks).toLocaleString()} />
            <Stat label="Open issues" value={String(repo.openIssues)} />
            <Stat label="Star growth" value={repo.measuredGrowth ? `+${repo.measuredGrowth.starsGained} in ${repo.measuredGrowth.days}d (measured)` : "Not enough snapshots yet"} />
            <Stat label="Last push" value={`${repo.pushedDaysAgo} days ago`} />
            <Stat label="License" value={String(repo.license ?? "none stated")} />
            <Stat label="Language" value={String(repo.language ?? "—")} />
            <Stat label="Latest release" value={repo.latestRelease ? String((repo.latestRelease as { tag: string }).tag) : "none"} />
            {repo.attentionBasis ? <p className="text-xs text-muted sm:col-span-3">{String(repo.attentionBasis)}</p> : null}
          </div>
        </Section>
      )}

      <Section
        title="Research"
        action={
          r ? (
            <ActionButton action={researchAction.bind(null, item.id, true)} className="btn-ghost text-xs" pendingText="Refreshing…">
              Refresh research
            </ActionButton>
          ) : undefined
        }
      >
        <div id="research" />
        {r ? (
          <div className="card space-y-4 p-5 text-sm leading-relaxed">
            <div className="flex items-center gap-2">
              <Badge tone={r.confidence === "high" ? "good" : r.confidence === "medium" ? "accent" : "warn"}>Confidence: {r.confidence}</Badge>
              {item.researchedAt && <span className="text-xs text-muted">Researched {fmtRelative(item.researchedAt, tz)}</span>}
            </div>
            <p>{r.summary}</p>
            <Block title="What's new">{r.whatIsNew}</Block>
            {r.counterpoints.length > 0 && <List title="Counterpoints & limitations" items={r.counterpoints} />}
            {r.implications.length > 0 && <List title="Implications (interpretation)" items={r.implications} />}
            {r.opportunities.length > 0 && (
              <div>
                <h4 className="label">Opportunity hypotheses (not proven demand)</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {r.opportunities.map((o, i) => (
                    <div key={i} className="rounded-lg border border-line p-3">
                      <div className="font-medium">{o.idea}</div>
                      <div className="mt-1 text-xs text-muted">Who benefits: {o.whoBenefits}</div>
                      <div className="mt-1 text-xs">Evidence: {o.evidence}</div>
                      <div className="mt-1 text-xs text-warn">Uncertain: {o.uncertainty}</div>
                      <div className="mt-1 text-xs">Cheap test: {o.smallExperiment}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {r.openQuestions.length > 0 && <List title="Open questions" items={r.openQuestions} />}
          </div>
        ) : (
          <Empty action={<ActionButton action={researchAction.bind(null, item.id, false)} className="btn-primary" pendingText="Researching… (≈30s)">Research deeper</ActionButton>}>
            Research reads the original sources, checks earlier coverage, and lists facts, counterpoints, and possible angles before you draft anything.
          </Empty>
        )}
      </Section>

      <Section title="Write a post">
        <div id="generate" className="card p-5">
          {r?.angles?.length ? (
            <div className="mb-4">
              <h4 className="label">Suggested angles</h4>
              <ul className="space-y-1 text-sm">
                {r.angles.map((g, i) => (
                  <li key={i}>
                    <span className="font-medium">{g.title}</span> <span className="text-muted">— {g.description}</span>{" "}
                    <Badge>{g.bestFor === "both" ? "LinkedIn & X" : g.bestFor === "x" ? "X" : "LinkedIn"}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {drafts.every((d) => ["rejected", "cancelled"].includes(d.status)) && (
            <div className="mb-4">
              <ActionButton action={writePostAction.bind(null, item.id)} className="btn-primary" pendingText="Writing… ~30s">
                Write post
              </ActionButton>
              <p className="mt-2 text-xs text-muted">Writes LinkedIn and/or X versions and opens them for review.</p>
            </div>
          )}
          <details>
          <summary className="cursor-pointer text-sm text-muted">Choose platforms or an angle yourself</summary>
          <ActionForm action={generateAction} className="mt-3 space-y-3" submit="Write drafts" pendingText="Writing… (≈20s per platform)">
            <input type="hidden" name="itemId" value={item.id} />
            <PlatformChecks suggested={a.platforms} />
            <input name="angle" className="input" placeholder="Optional: the angle or perspective you want (or copy one of the suggestions)" />
            <p className="text-xs text-muted">Each platform is drafted separately and can decline material that doesn&apos;t fit. Nothing is published without your approval.</p>
          </ActionForm>
          </details>
          {drafts.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h4 className="label">Drafts from this discovery</h4>
              <ul className="space-y-1 text-sm">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/drafts/${d.id}`} className="inline-flex items-center gap-2 hover:underline">
                      <PlatformBadge platform={d.platform} /> <StatusBadge status={d.status} /> {d.angle ?? "draft"} · {fmtDateTime(d.createdAt, tz)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="Claims and evidence">
        {claims.length ? (
          <ul className="card divide-y divide-line">
            {claims.map((c) => {
              const [tone, label] = VERIFICATION[c.verification] ?? ["neutral", c.verification];
              return (
                <li key={c.id} className="p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge>{KIND[c.kind]}</Badge>
                    {c.kind === "fact" && <Badge tone={tone}>{label}</Badge>}
                  </div>
                  <p>{c.text}</p>
                  {c.evidence.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {c.evidence.map((e) => (
                        <a key={e.id} href={e.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          {new URL(e.url).hostname.replace(/^www\./, "")}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No claims extracted yet.</Empty>
        )}
      </Section>

      <Section title={`Sources (${item.sources.length})`}>
        <ul className="card divide-y divide-line">
          {item.sources.map((src) => (
            <li key={src.id} className="p-3 text-sm">
              <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-accent">
                {src.title} <ExternalLink size={12} />
              </a>
              <div className="text-xs text-muted">
                {src.publisher} · {fmtRelative(src.publishedAt, tz)} {src.isPrimary && <Badge tone="good">Primary</Badge>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {s && (
        <Section title="Why this ranks where it does">
          <div className="card p-5 text-sm">
            <p className="mb-3">{s.explanation}</p>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              {(["relevance", "recency", "evidence", "insight", "audience"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-paper p-2">
                  <div className="text-lg font-semibold">{Number(s[k]).toFixed(1)}</div>
                  <div className="text-muted">{k} · {(s.weights as Record<string, number>)[k]}%</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Score {s.total}/100 · method {s.version}. A recommendation, not a prediction of how a post will perform.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div>{value}</div>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="label">{title}</h4>
      <p>{children}</p>
    </div>
  );
}
function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="label">{title}</h4>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
