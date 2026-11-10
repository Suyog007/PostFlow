import { redirect } from "next/navigation";
import { SectionView } from "./section-view";

/** Old links used ?tab=…; they now open that setting's own page. */
const OLD: Record<string, string> = { you: "you", voice: "you", times: "times", schedule: "times", accounts: "accounts", general: "accounts", sources: "sources", more: "more", advanced: "more" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; connected?: string; tab?: string }> }) {
  const sp = await searchParams;
  const to = sp.connected ? "accounts" : OLD[sp.tab ?? ""];
  if (to) {
    const q = new URLSearchParams(Object.entries({ ok: sp.ok, error: sp.error, connected: sp.connected }).filter((e): e is [string, string] => !!e[1]));
    redirect(`/settings/${to}${q.size ? `?${q}` : ""}`);
  }
  // Phones show only the list here; wider screens show the list with "About you" open beside it.
  return <SectionView section="you" ok={sp.ok} error={sp.error} />;
}
