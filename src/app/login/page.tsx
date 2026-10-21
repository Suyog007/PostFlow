import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { Divider, GoogleButton, LoginForm } from "@/components/auth-forms";
import { getSessionUser } from "@/server/auth";
import { googleConfigured, safeNext } from "@/server/google";
import { signupsOpen } from "@/server/users";

export const metadata: Metadata = { title: "Sign in · PostFlow" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSessionUser()) redirect(next);
  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back."
      footer={signupsOpen() ? <>New to PostFlow? <Link href="/signup" className="font-medium text-[var(--ink)] underline">Start a free trial</Link></> : <>No account yet? <Link href="/#early-access" className="font-medium text-[var(--ink)] underline">Join the waitlist</Link></>}
    >
      {sp.error && <p role="alert" className="mb-4 rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{sp.error}</p>}
      {googleConfigured() && (
        <>
          <GoogleButton next={next} />
          <Divider />
        </>
      )}
      <LoginForm next={next} />
    </AuthShell>
  );
}
