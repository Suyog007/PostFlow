import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "@/components/auth-forms";
import { peekToken } from "@/server/users";

export const metadata: Metadata = { title: "Choose a new password · PostFlow" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; confirmed?: string }> }) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const valid = await peekToken(token, "reset");
  return (
    <AuthShell title="Choose a new password" subtitle={sp.confirmed ? "Your email is confirmed. Choose the password you will sign in with." : undefined} footer={<Link href="/login" className="underline">Back to sign in</Link>}>
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <p className="text-[14px] text-[var(--muted)]">
          This link has expired or was already used. <Link href="/forgot" className="font-medium text-[var(--ink)] underline">Request a new one</Link>.
        </p>
      )}
    </AuthShell>
  );
}
