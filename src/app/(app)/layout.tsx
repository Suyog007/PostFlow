import Link from "next/link";
import { requireActiveUser } from "@/server/auth";
import { entitlementOf, postsThisMonth } from "@/server/billing/plans";
import { getSettings } from "@/server/settings";
import { Avatar, Logo } from "@/components/ui";
import { MobileMenu, TopNav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const s = await getSettings();
  const ent = entitlementOf(user);
  const used = ent.plan === "owner" ? null : await postsThisMonth(user.id);
  const name = s.profile.name || user.name || user.email;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-4 md:h-[72px] md:gap-10 md:px-8">
          <MobileMenu name={name} used={used !== null ? `${used} of ${ent.quota.postsPerMonth} posts used this month` : undefined} />
          <Link href="/calendar" className="flex items-center gap-2.5" aria-label="PostFlow home">
            <Logo size={30} />
            <span className="display text-[24px] md:text-[28px]">PostFlow</span>
          </Link>
          <TopNav />
          <div className="ml-auto flex items-center gap-4">
            {used !== null && <Link href="/billing" className="hidden text-[15px] text-[var(--muted)] hover:text-[var(--ink)] lg:inline">{used} of {ent.quota.postsPerMonth} posts used this month</Link>}
            <Link href="/settings" aria-label="Your settings"><Avatar name={name} size={40} /></Link>
          </div>
        </div>
      </header>
      {s.paused && (
        <div className="border-b border-[var(--line)] bg-[var(--warn-soft)] px-4 py-2.5 text-center text-[14px] text-[var(--warn)]">
          PostFlow is paused, so nothing is written or posted. <Link href="/settings/accounts" className="font-semibold underline">Turn it back on</Link>
        </div>
      )}
      <main className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 md:px-8 md:pt-12">{children}</main>
    </div>
  );
}
