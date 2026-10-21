import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "@/components/auth-forms";
import { peekToken } from "@/server/users";

export const metadata: Metadata = { title: "Choose a new password · PostFlow" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = await peekToken(token, "reset");
  return (
    <AuthShell title="Choose a new password" footer={<Link href="/login" className="underline">Back to sign in</Link>}>
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
