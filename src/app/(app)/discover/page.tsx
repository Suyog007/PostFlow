import Link from "next/link";
import { clsx } from "clsx";
import { requireUser } from "@/server/auth";
import { getUserPreferences } from "@/server/preferences";
import { discoverList, listIdeas, topicResearchList } from "@/server/queries";
import { DiscoveryCard } from "@/components/discovery-card";
import { Badge, Empty, PageHeader, PlatformChecks } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/client";
import { generateAction, ideaStatusAction, itemAction, researchTopicAction, runDiscoveryAction, saveIdeaAction } from "@/app/actions";
import { fmtRelative } from "@/lib/format";

const VIEWS = [
  { key: "latest", label: "Top this week" },
  { key: "saved", label: "Saved" },
  { key: "ideas", label: "Idea library" },
  { key: "topics", label: "Topic research" },
  { key: "unanalyzed", label: "Not yet analyzed" },
  { key: "filtered", label: "Filtered out" },
] as const;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const requested = (await searchParams).view;
  const view = (VIEWS.find((v) => v.key === requested)?.key ?? "latest") as (typeof VIEWS)[number]["key"];

  return (
    <div>
      <PageHeader
        title="Discover"
        subtitle="Developments ranked for you, your saved items, and your evergreen idea library."
        actions={<ActionButton action={runDiscoveryAction} className="btn-primary" pendingText="Starting…">Run discovery</ActionButton>}
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/discover?view=${v.key}`}
            className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", view === v.key ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {v.label}
          </Link>
        ))}
      </div>
      {view === "ideas" ? <Ideas userId={userId} /> : view === "topics" ? <Topics tz={prefs.timezone} /> : <Items view={view} tz={prefs.timezone} />}
    </div>
  );
}

async function Items({ view, tz }: { view: "latest" | "saved" | "unanalyzed" | "filtered"; tz: string }) {
  const items = await discoverList(view);
  if (!items.length) return <Empty>Nothing here yet.</Empty>;
  if (view === "filtered") {
    return (
      <div className="card divide-y divide-line">
        <p className="p-4 text-sm text-muted">Items dropped by deterministic filters or the model in the last 3 days, shown so you can check the filters aren&apos;t too aggressive.</p>
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <a href={i.sources[0]?.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {i.title}
              </a>
              <div className="text-xs text-muted">
                {i.sources[0]?.publisher} · {fmtRelative(i.publishedAt, tz)} · {i.filterReason}
              </div>
            </div>
            <ActionButton action={itemAction.bind(null, i.id, "restore")} className="btn-ghost text-xs">
              Restore
            </ActionButton>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {items.map((it) => (
        <DiscoveryCard key={it.id} item={it} tz={tz} compact={view === "unanalyzed"} />
      ))}
    </div>
  );
}

async function Topics({ tz }: { tz: string }) {
  const topics = await topicResearchList();
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <ActionForm action={researchTopicAction} className="flex gap-2" pendingText="Researching…">
          <input name="topic" className="input" placeholder="Research any topic: e.g. 'loyalty programs and game theory'" required minLength={3} />
          <button className="btn-primary" type="submit">
            Research
          </button>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Uses your library plus Hacker News search and GitHub search (official APIs). Takes about 30–60 seconds.</p>
      </div>
      {topics.length ? (
        <ul className="card divide-y divide-line">
          {topics.map((t) => (
            <li key={t.id}>
              <Link href={`/discover/${t.id}`} className="flex items-center justify-between p-3 text-sm hover:bg-paper">
                <span>{t.title}</span>
                <span className="text-xs text-muted">{fmtRelative(t.firstSeenAt, tz)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No topic research yet.</Empty>
      )}
    </div>
  );
}

async function Ideas({ userId }: { userId: string }) {
  const ideas = await listIdeas(userId);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {ideas.length === 0 && <Empty>Your idea library is empty. Save concepts, observations, or reading notes here to draft evergreen posts on quiet days.</Empty>}
        {ideas.map((idea) => (
          <article key={idea.id} id={`idea-${idea.id}`} className={clsx("card p-4", idea.status === "used" && "opacity-75")}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{idea.title}</h3>
              {idea.status === "used" && <Badge tone="good">Used {idea.usedCount}×</Badge>}
              {idea.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            {idea.notes && <p className="prose-post mt-2 text-sm text-muted">{idea.notes}</p>}
            {idea.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {idea.links.map((l) => (
                  <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {l.replace(/^https?:\/\//, "").slice(0, 50)}
                  </a>
                ))}
              </div>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-accent">Generate a post</summary>
              <ActionForm action={generateAction} className="mt-2 space-y-2" pendingText="Drafting… (≈20s per platform)" submit="Generate drafts">
                <input type="hidden" name="ideaId" value={idea.id} />
                <PlatformChecks />
                <input name="angle" className="input" placeholder="Optional angle or perspective" />
                {idea.status === "used" && <p className="text-xs text-warn">You&apos;ve already used this idea. Consider a genuinely different angle.</p>}
              </ActionForm>
            </details>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-muted">Edit</summary>
              <IdeaForm idea={idea} />
            </details>
            <div className="mt-2 flex gap-2">
              {idea.status !== "used" ? (
                <ActionButton action={ideaStatusAction.bind(null, idea.id, "used")} className="btn-ghost text-xs">Mark used</ActionButton>
              ) : (
                <ActionButton action={ideaStatusAction.bind(null, idea.id, "active")} className="btn-ghost text-xs">Mark unused</ActionButton>
              )}
              <ActionButton action={ideaStatusAction.bind(null, idea.id, "archived")} className="btn-ghost text-xs" confirm="Archive?">
                Archive
              </ActionButton>
            </div>
          </article>
        ))}
      </div>
      <aside>
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">New idea</h3>
          <IdeaForm />
        </div>
      </aside>
    </div>
  );
}

function IdeaForm({ idea }: { idea?: { id: string; title: string; notes: string; links: string[]; tags: string[] } }) {
  return (
    <ActionForm action={saveIdeaAction} className="mt-2 space-y-3" submit={idea ? "Save" : "Add idea"} resetOnSuccess={!idea}>
      {idea && <input type="hidden" name="id" value={idea.id} />}
      <div>
        <label className="label">Title</label>
        <input name="title" className="input" defaultValue={idea?.title} required />
      </div>
      <div>
        <label className="label">Notes (your own observations; drafts may use these)</label>
        <textarea name="notes" className="input" rows={4} defaultValue={idea?.notes} />
      </div>
      <div>
        <label className="label">Links (space separated)</label>
        <input name="links" className="input" defaultValue={idea?.links.join(" ")} />
      </div>
      <div>
        <label className="label">Tags (comma separated)</label>
        <input name="tags" className="input" defaultValue={idea?.tags.join(", ")} />
      </div>
    </ActionForm>
  );
}
