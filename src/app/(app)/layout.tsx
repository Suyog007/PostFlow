import Link from "next/link";
import { DateTime } from "luxon";
import { requireActiveUser } from "@/server/auth";
import { entitlementOf, postsThisMonth } from "@/server/billing/plans";
import { getSettings } from "@/server/settings";
import { lastHeartbeat } from "@/server/health";
import { Avatar, Logo } from "@/components/ui";
import { SideNav, TabBar } from "@/components/nav";
import { togglePauseAction } from "../actions";
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
      <aside className="hidden flex-col gap-6 border-r border-[var(--line)] bg-[var(--side)] p-3 md:sticky md:top-0 md:flex md:h-screen">
        <div className="px-2 pt-2">
          <Link href="/calendar" className="flex items-baseline gap-2">
            <span className="self-center"><Logo size={24} /></span>
            <span className="display text-[22px]">PostFlow</span>
          </Link>
          <p className="typed mt-1 text-[12px] text-[var(--accent)]">news desk</p>
          <div className="press-stripe mt-3" aria-hidden="true" />
        </div>
        <SideNav owner={user.isOwner} />
        {used !== null && (
          <Link href="/billing" className="mx-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-[12px] hover:border-[var(--line-strong)]">
            <div className="flex justify-between font-medium"><span>{ent.plan === "pro" ? "Pro" : "Starter"} plan</span><span className="tnum text-[var(--muted)]">{used}/{ent.quota.postsPerMonth}</span></div>
            <div className="mt-1.5 h-1.5 rounded-full bg-[var(--side)]"><div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (used / ent.quota.postsPerMonth) * 100)}%` }} /></div>
            <div className="mt-1 text-[11px] text-[var(--subtle)]">posts this month{user.subscriptionStatus === "trialing" ? " · free trial" : ""}</div>
          </Link>
        )}
        <div className="mt-auto space-y-3">
          <form action={togglePauseAction} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <span className={`inline-block h-2 w-2 rounded-full ${s.paused ? "bg-[var(--warn)]" : alive ? "bg-[var(--good)]" : "bg-[var(--subtle)]"}`} />
              {s.paused ? "Autopilot paused" : "Autopilot on"}
            </div>
            <p className="mt-1 text-[11px] text-[var(--subtle)]">{beat ? `Scheduler checked in ${mins === 0 ? "just now" : `${mins} min ago`}` : "Scheduler has not run yet"}</p>
            <button className="btn btn-sm mt-2 w-full">{s.paused ? "Resume" : "Pause"}</button>
          </form>
          <div className="flex items-center gap-2 px-1">
            <Avatar name={name} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">{name}</div>
              <div className="truncate text-[11px] text-[var(--subtle)]">{DateTime.now().setZone(s.timezone).toFormat("ccc d LLL, HH:mm")}</div>
            </div>
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm" title="Sign out" aria-label="Sign out">Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="relative flex items-center gap-2 bg-[var(--surface)] px-4 py-3 md:hidden">
          <Logo size={22} />
          <span className="display text-[20px]">PostFlow</span>
          <span className="typed text-[11px] text-[var(--accent)]">news desk</span>
          <div className="press-stripe absolute inset-x-0 bottom-0" aria-hidden="true" />
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <span className={`inline-block h-2 w-2 rounded-full ${s.paused ? "bg-[var(--warn)]" : "bg-[var(--good)]"}`} />
            {s.paused ? "Paused" : "On"}
          </span>
        </header>
        {s.paused && (
          <div className="border-b border-[var(--line)] bg-[var(--warn-soft)] px-4 py-2 text-[13px] text-[var(--warn)] md:px-8">
            Autopilot is paused. Nothing is being written or posted.
          </div>
        )}
        <main className="mx-auto max-w-[1180px] px-4 pb-24 pt-5 md:px-8 md:pb-12 md:pt-7">{children}</main>
      </div>
      <TabBar />
    </div>
  );
}
