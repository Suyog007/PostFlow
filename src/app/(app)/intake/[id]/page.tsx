import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getIntake } from "@/server/intake/service";
import { Badge, PageHeader, PlatformChecks, Section, TextLink } from "@/components/ui";
import { ActionForm, ExpandableText } from "@/components/client";
import { draftFromAtomsAction } from "@/app/actions";
import type { IntakeAtom } from "@/server/db/schema";

const KIND_LABEL: Record<IntakeAtom["kind"], string> = {
  stat: "Number",
  quote: "Quote",
  insight: "Insight",
  question: "Question",
  contrarian: "Contrarian",
  takeaway: "Takeaway",
};

const KIND_TONE: Record<IntakeAtom["kind"], "accent" | "good" | "warn" | "neutral"> = {
  stat: "accent",
  quote: "neutral",
  insight: "good",
  question: "warn",
  contrarian: "warn",
  takeaway: "good",
};

export default async function IntakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser();
  const { id } = await params;
  const intake = await getIntake(userId, id);
  if (!intake) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={intake.title || "(untitled)"}
        subtitle={
          <span>
            {intake.kind === "url" && intake.url ? (
              <>
                From <TextLink href={intake.url}>{intake.siteName ?? intake.url}</TextLink>
                {intake.byline ? ` · ${intake.byline}` : ""} ·{" "}
              </>
            ) : (
              "Pasted text · "
            )}
            {intake.atoms.length} atoms
          </span>
        }
      />

      {intake.summary && (
        <Section title="Summary">
          <p className="card p-4 text-sm leading-relaxed">{intake.summary}</p>
        </Section>
      )}

      <Section title="Atoms — pick what to build from">
        <ActionForm action={draftFromAtomsAction} submit="Write drafts from selected" pendingText="Writing…">
          <input type="hidden" name="intakeId" value={intake.id} />
          <ul className="card divide-y divide-line">
            {intake.atoms.map((a) => (
              <li key={a.id} className="flex gap-3 p-3 text-sm">
                <input type="checkbox" name="atom" value={a.id} defaultChecked className="mt-1" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Badge>
                    {a.note && <span className="text-xs text-muted">{a.note}</span>}
                  </div>
                  <p className="mt-1 leading-relaxed">{a.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="card mt-4 space-y-3 p-5">
            <div>
              <span className="label">Platforms</span>
              <PlatformChecks />
            </div>
            <div>
              <label className="label">Angle (optional — e.g. &ldquo;what this means for small teams&rdquo;)</label>
              <input name="angle" className="input" placeholder="Leave blank and the writer picks the most interesting angle" />
            </div>
            <p className="text-xs text-muted">
              Selected atoms become the material. Drafts land in <TextLink href="/drafts">Drafts</TextLink> awaiting your approval — nothing posts on its own.
            </p>
          </div>
        </ActionForm>
      </Section>

      {intake.kind !== "url" && (
        <Section title="Source text">
          <div className="card p-4 text-sm text-muted">
            <ExpandableText lines={6}>{intake.text}</ExpandableText>
          </div>
        </Section>
      )}
    </div>
  );
}
