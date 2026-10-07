import Link from "next/link";
import { clsx } from "clsx";
import { requireUser } from "@/server/auth";
import { getUserPreferences } from "@/server/preferences";
import { draftsWithCurrent, type DraftListRow } from "@/server/queries";
import { Empty, PageHeader, PlatformBadge, Section, StatusBadge, TimelinessBadge } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { newManualDraftAction } from "@/app/actions";
import { firstLine, fmtDateTime, formatLabel } from "@/lib/format";

const GROUPS: { title: string; statuses: DraftListRow["status"][] }[] = [
  { title: "Needs your approval", statuses: ["awaiting_approval", "draft"] },
  { title: "Problems", statuses: ["failed"] },
  { title: "Approved, not scheduled", statuses: ["approved"] },
  { title: "Scheduled & publishing", statuses: ["scheduled", "publishing"] },
  { title: "Published", statuses: ["published"] },
  { title: "Rejected & cancelled", statuses: ["rejected", "cancelled"] },
];

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const { platform } = await searchParams;
  const all = await draftsWithCurrent(userId);
  const rows = platform === "x" || platform === "linkedin" ? all.filter((d) => d.platform === platform) : all;

  return (
    <div>
      <PageHeader
        title="Drafts"
        subtitle="Every post is per platform: LinkedIn and X versions are approved and scheduled separately."
        actions={
          <div className="flex gap-1 rounded-lg border border-line bg-card p-1 text-sm">
            {[
              ["", "All"],
              ["linkedin", "LinkedIn"],
              ["x", "X"],
            ].map(([k, l]) => (
              <Link key={k} href={k ? `/drafts?platform=${k}` : "/drafts"} className={clsx("rounded-md px-3 py-1", (platform ?? "") === k ? "bg-accent-soft text-accent" : "text-muted")}>
                {l}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          {GROUPS.map((g) => {
            const list = rows.filter((d) => g.statuses.includes(d.status));
            if (!list.length && g.title !== "Needs your approval") return null;
            return (
              <Section key={g.title} title={`${g.title} (${list.length})`}>
                {list.length ? (
                  <ul className="card divide-y divide-line">
                    {list.slice(0, g.title.startsWith("Published") || g.title.startsWith("Rejected") ? 15 : 100).map((d) => (
                      <li key={d.id}>
                        <Link href={`/drafts/${d.id}`} className="flex flex-col gap-1 p-4 hover:bg-paper">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <PlatformBadge platform={d.platform} />
                            <StatusBadge status={d.schedule && ["needs_review", "unknown"].includes(d.schedule.state) ? d.schedule.state : d.status} />
                            <TimelinessBadge t={d.timeliness} />
                            {d.schedule && d.status !== "published" && <span className="text-muted">{fmtDateTime(d.schedule.scheduledAt, prefs.timezone)}</span>}
                            {d.schedule?.publishedAt && <span className="text-muted">Published {fmtDateTime(d.schedule.publishedAt, prefs.timezone)}</span>}
                            {(d.revision?.parts.length ?? 0) > 1 && <span className="text-muted">Thread · {d.revision!.parts.length} posts</span>}
                            {(d.revision?.format ?? "post") !== "post" && (d.revision?.parts.length ?? 0) <= 1 && <span className="text-accent">{formatLabel(d.revision!.format)}</span>}
                            {(d.revision?.media?.length ?? 0) > 0 && (
                              <span className="text-muted">
                                {d.revision!.media.length} image{d.revision!.media.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <div className="text-sm">{firstLine(d.revision?.parts, 140)}</div>
                          {d.item && <div className="truncate text-xs text-muted">From: {(d.item.analysis as { headline?: string } | null)?.headline ?? d.item.title}</div>}
                          {d.schedule?.lastError && d.status === "failed" && <div className="text-xs text-bad">{d.schedule.lastError}</div>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>
                    Nothing waiting. Generate drafts from a discovery on <Link href="/discover" className="text-accent">Discover</Link>.
                  </Empty>
                )}
              </Section>
            );
          })}
        </div>
        <aside>
          <div className="card p-4">
            <h3 className="mb-2 font-semibold">Write a post yourself</h3>
            <ActionForm action={newManualDraftAction} className="space-y-3" submit="Create draft">
              <select name="platform" className="input">
                <option value="linkedin">LinkedIn</option>
                <option value="x">X</option>
              </select>
              <textarea name="text" rows={6} className="input" placeholder="Start writing…" required />
            </ActionForm>
          </div>
        </aside>
      </div>
    </div>
  );
}
