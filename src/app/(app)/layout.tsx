import Link from "next/link";
import { requireActiveUser } from "@/server/auth";
import { entitlementOf, postsThisMonth } from "@/server/billing/plans";
import { getSettings } from "@/server/settings";
import { lastHeartbeat } from "@/server/health";
import { Avatar, Logo } from "@/components/ui";
import { SideNav, TabBar } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { logoutAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const s = await getSettings();
  const ent = entitlementOf(user);
  const used = ent.plan === "owner" ? null : await postsThisMonth(user.id);
  const beat = await lastHeartbeat();
  const mins = beat ? Math.round((Date.now() - beat.getTime()) / 60_000) : null;
  const alive = mins !== null && mins < 30;
  const name = s.profile.name || user.name || user.email;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-6 border-r border-[var(--line)] bg-[var(--surface)] p-4 md:sticky md:top-0 md:flex md:h-screen">
        <div className="px-2 pt-2">
          <Link href="/calendar" className="flex items-baseline gap-2">
            <span className="self-center"><Logo size={24} /></span>
            <span className="text-[20px] font-extrabold tracking-[-0.03em]">PostFlow</span>
          </Link>
        </div>
        <SideNav owner={user.isOwner} />
        {used !== null && (
          <Link href="/billing" className="mx-1 rounded-[14px] bg-[var(--bg)] p-3.5 text-[12px] hover:bg-[var(--raised)]">
            <div className="flex justify-between font-medium"><span>{ent.plan === "beta" ? "Free beta" : ent.plan === "pro" ? "Pro plan" : "Starter plan"}</span><span className="tnum text-[var(--muted)]">{used}/{ent.quota.postsPerMonth}</span></div>
            <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line)]"><div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (used / ent.quota.postsPerMonth) * 100)}%` }} /></div>
            <div className="mt-1 text-[12px] text-[var(--subtle)]">posts used this month{user.subscriptionStatus === "trialing" ? " · free trial" : ""}</div>
          </Link>
        )}
        <div className="mt-auto space-y-3">
          {/* One plain line about whether PostFlow is working, with the switch in Settings. */}
          <Link href="/settings?tab=accounts" className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px] text-[var(--muted)] hover:bg-[var(--surface)]">
            <span className={`inline-block h-2 w-2 rounded-full ${s.paused ? "bg-[var(--warn)]" : alive ? "bg-[var(--good)]" : "bg-[var(--subtle)]"}`} />
            {s.paused ? "PostFlow is paused" : "PostFlow is on"}
          </Link>
          <div className="flex items-center gap-2 px-1">
            <Avatar name={name} size={28} />
            <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</div>
          </div>
          <div className="flex items-center justify-between px-1">
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm" title="Sign out" aria-label="Sign out">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur md:hidden">
          <Logo size={22} />
          <span className="text-[19px] font-extrabold tracking-[-0.03em]">PostFlow</span>
          <span className="ml-auto"><ThemeToggle /></span>
          <Link href="/account" aria-label="Account"><Avatar name={name} size={28} /></Link>
        </header>
        {s.paused && (
          <div className="border-b border-[var(--line)] bg-[var(--warn-soft)] px-4 py-2 text-[13px] text-[var(--warn)] md:px-8">
            PostFlow is paused. Nothing is being written or posted. <Link href="/settings?tab=accounts" className="underline">Turn it back on</Link>
          </div>
        )}
        <main className="mx-auto max-w-[1180px] px-4 pb-28 pt-6 md:px-10 md:pb-14 md:pt-10">{children}</main>
      </div>
      <TabBar />
    </div>
  );
}
