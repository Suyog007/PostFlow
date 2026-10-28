import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ResendForm } from "@/components/auth-forms";
import { requireUser } from "@/server/auth";
import { logoutAction } from "@/app/auth-actions";

export const metadata: Metadata = { title: "Confirm your email · PostFlow" };
// Reads the session cookie: must never be prerendered at build time (it would bake in a redirect).
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  if (user.emailVerifiedAt) redirect("/calendar");
  const { error } = await searchParams;
  return (
    <AuthShell
      title="Check your inbox"
      subtitle={<>We sent a confirmation link to <span className="font-medium text-[var(--ink)]">{user.email}</span>. Open it to continue.</>}
      footer={
        <form action={logoutAction}>
          <button className="underline">Use a different email</button>
        </form>
      }
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{error}</p>}
      <ResendForm />
    </AuthShell>
  );
}
