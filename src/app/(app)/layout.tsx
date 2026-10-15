import Link from "next/link";
import { requireOwner } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
        <Link href="/" className="font-semibold">PostFlow</Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/" className="hover:text-ink">Calendar</Link>
          <Link href="/notes" className="hover:text-ink">Notes</Link>
          <Link href="/settings" className="hover:text-ink">Settings</Link>
        </nav>
        <form action={logoutAction} className="ml-auto">
          <button className="btn-ghost">Sign out</button>
        </form>
      </header>
      {s.paused && (
        <div className="mb-4 rounded-lg border border-line bg-accent-soft px-4 py-2 text-sm">
          Autopilot is <strong>paused</strong>. Nothing is being written or posted. <Link href="/settings" className="underline">Resume in Settings</Link>.
        </div>
      )}
      {children}
    </div>
  );
}
