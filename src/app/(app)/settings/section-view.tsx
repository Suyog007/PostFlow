import { notFound } from "next/navigation";
import { Flash } from "../flash";
import { Advanced, General, Schedule, Sources, Voice, settingsContext } from "./sections";

export const SECTIONS = ["you", "times", "accounts", "sources", "more"] as const;
export type Section = (typeof SECTIONS)[number];

/** One settings page: its saved/error message, then its forms. */
export async function SectionView({ section, ok, error, connected }: { section: string; ok?: string; error?: string; connected?: string }) {
  if (!SECTIONS.includes(section as Section)) notFound();
  const { user, ent, s, field, showX, pro, keep } = await settingsContext();
  return (
    <div className="max-w-[680px] space-y-10">
      <Flash ok={ok ?? (connected ? `Connected ${connected}.` : undefined)} error={error} />
      {section === "you" && <Voice s={s} field={field} />}
      {section === "times" && <Schedule s={s} ent={ent} showX={showX} pro={pro} keep={keep} />}
      {section === "accounts" && <General user={user} s={s} ent={ent} showX={showX} pro={pro} />}
      {section === "sources" && <Sources userId={user.id} s={s} feeds={ent.quota.feeds} />}
      {section === "more" && <Advanced s={s} field={field} showX={showX} isOwner={user.isOwner} keep={keep} />}
    </div>
  );
}
