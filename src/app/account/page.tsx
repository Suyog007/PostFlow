import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { entitlementOf } from "@/server/billing/plans";
import { Logo } from "@/components/ui";
import { logoutAction } from "../auth-actions";
import { changePasswordAction, deleteAccountAction, sendSetPasswordLinkAction, signOutEverywhereAction } from "../account-actions";

export const metadata: Metadata = { title: "Account · PostFlow" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const active = entitlementOf(user).active;
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[720px] items-center gap-4 px-4">
          <Link href={active ? "/calendar" : "/billing"} className="flex items-center gap-2">
            <Logo size={22} />
            <span className="display text-[20px]">PostFlow</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-[13px]">
            {active && <Link href="/calendar" className="btn btn-ghost btn-sm">Open app</Link>}
            <Link href="/billing" className="btn btn-ghost btn-sm">Billing</Link>
            <form action={logoutAction}><button className="btn btn-ghost btn-sm">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[720px] space-y-6 px-4 py-10">
        <h1 className="display text-[34px]">Account</h1>
        {sp.ok && <p role="status" className="rounded-md bg-[var(--good-soft)] px-3 py-2 text-[13px] text-[var(--good)]">{sp.ok}</p>}
        {sp.error && <p role="alert" className="rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{sp.error}</p>}

        <section className="panel p-5">
          <h2 className="font-semibold">Profile</h2>
          <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-2 text-[14px]">
            <dt className="text-[var(--muted)]">Name</dt><dd>{user.name || "Not set"}</dd>
            <dt className="text-[var(--muted)]">Email</dt><dd>{user.email}{user.emailVerifiedAt ? "" : " (not confirmed)"}</dd>
            <dt className="text-[var(--muted)]">Sign-in</dt><dd>{[user.passwordHash && "Password", user.googleSub && "Google"].filter(Boolean).join(" and ") || "None"}</dd>
          </dl>
          <p className="mt-3 text-[12px] text-[var(--subtle)]">Your writing profile (role, voice, topics) is in Settings inside the app.</p>
        </section>

        <section className="panel p-5">
          <h2 className="font-semibold">{user.passwordHash ? "Change password" : "Set a password"}</h2>
          {user.passwordHash ? (
            <form action={changePasswordAction} className="mt-3 grid gap-3 sm:max-w-[360px]">
              <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required autoComplete="current-password" className="input h-10" /></div>
              <div><label className="label" htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-10" /></div>
              <button className="btn btn-primary w-fit">Change password</button>
            </form>
          ) : (
            <form action={sendSetPasswordLinkAction} className="mt-3">
              <p className="mb-3 text-[14px] text-[var(--muted)]">You sign in with Google. To also sign in with a password, we will email you a link to set one.</p>
              <button className="btn">Email me a link</button>
            </form>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-semibold">Sessions</h2>
          <p className="mt-1 text-[14px] text-[var(--muted)]">Signed in somewhere you do not recognise? Sign out on every device, including this one.</p>
          <form action={signOutEverywhereAction} className="mt-3"><button className="btn">Sign out everywhere</button></form>
        </section>

        <section className="panel border-[var(--bad)]/40 p-5">
          <h2 className="font-semibold text-[var(--bad)]">Delete account</h2>
          <p className="mt-1 text-[14px] text-[var(--muted)]">Cancels your subscription immediately and permanently deletes your posts, notes, feeds, settings and connected accounts. Posts already published on LinkedIn or X stay there.</p>
          <form action={deleteAccountAction} className="mt-3 grid gap-3 sm:max-w-[360px]">
            <div><label className="label" htmlFor="confirm">Type <span className="font-mono">{user.email}</span> to confirm</label><input id="confirm" name="confirm" required autoComplete="off" className="input h-10" /></div>
            <button className="btn btn-danger w-fit">Delete my account</button>
          </form>
        </section>
      </main>
    </div>
  );
}
