import Link from "next/link";
import { requireUser } from "@/server/auth";
import { listIntakes } from "@/server/intake/service";
import { getUserPreferences } from "@/server/preferences";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/client";
import { archiveIntakeAction, createIntakeAction } from "@/app/actions";
import { fmtRelative } from "@/lib/format";

export default async function IntakePage() {
  const userId = await requireUser();
  const [intakes, prefs] = await Promise.all([listIntakes(userId), getUserPreferences(userId)]);
  const ready = intakes.filter((i) => i.status !== "archived");

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Intake"
        subtitle="Paste a link or text you found — or your own notes. It gets mined into atoms (numbers, quotes, insights), and drafts are built from those."
      />

      <Section title="New intake">
        <div className="card p-5">
          <ActionForm action={createIntakeAction} submit="Extract atoms" pendingText="Reading & mining…">
            <label className="label">Article URL, or pasted text</label>
            <textarea
              name="input"
              rows={6}
              className="input"
              placeholder={"https://example.com/article\n\n…or paste the full text here (yours or someone else's, with the source in mind)"}
            />
            <p className="mt-2 text-xs text-muted">
              Links are read with the same reader-mode extraction browsers use. Your own writing works best: drafts inherit your perspective, not the article&apos;s.
            </p>
          </ActionForm>
          {!prefs.llm.enabled && <p className="mt-2 text-xs text-warn">AI is disabled in Settings — atom mining and drafting will fail.</p>}
        </div>
      </Section>

      <Section title={`Recent intakes (${ready.length})`}>
        {ready.length === 0 ? (
          <Empty>Nothing yet. Paste something above — a paper, a news piece, a thread, your own notes.</Empty>
        ) : (
          <ul className="card divide-y divide-line">
            {ready.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/intake/${i.id}`} className="font-medium hover:text-accent">
                    {i.title || "(untitled)"}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge>{i.kind === "url" ? "Link" : "Pasted text"}</Badge>
                    <span>
                      {i.atoms.length} atoms · {i.siteName ?? "own text"} · {fmtRelative(i.createdAt, prefs.timezone)}
                    </span>
                  </div>
                </div>
                <Link href={`/intake/${i.id}`} className="btn-secondary text-xs">
                  Open
                </Link>
                <ActionButton action={archiveIntakeAction.bind(null, i.id)} className="btn-ghost text-xs" confirm="Archive?">
                  Archive
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
