import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ConfirmEmailForm } from "@/components/auth-forms";
import { getSessionUser } from "@/server/auth";
import { peekTokenUser } from "@/server/users";

export const metadata: Metadata = { title: "Confirm your email · PostFlow" };
export const dynamic = "force-dynamic";

/**
 * The link in the "confirm your email" message lands here. Opening the page changes nothing (mail
 * scanners open links too); the button does.
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const [owner, current] = await Promise.all([peekTokenUser(token, "verify"), getSessionUser()]);
  if (!owner) {
    return (
      <AuthShell title="Link expired" footer={<Link href="/login" className="underline">Sign in</Link>}>
        <p className="text-[14px] text-[var(--muted)]">
          This confirmation link has expired or was already used.{" "}
          {current && !current.emailVerifiedAt ? (
            <Link href="/verify-email" className="font-medium text-[var(--ink)] underline">Send a new one</Link>
          ) : (
            <>Sign in to send a new one, or carry on if your email is already confirmed.</>
          )}
        </p>
      </AuthShell>
    );
  }
  const sameDevice = current?.id === owner.id;
  return (
    <AuthShell
      title="Confirm your email"
      subtitle={
        sameDevice ? (
          <>Confirm <span className="font-medium text-[var(--ink)]">{owner.email}</span> to finish setting up your account.</>
        ) : (
          <>You opened this link on a different device or browser. Enter your password to confirm <span className="font-medium text-[var(--ink)]">{owner.email}</span>.</>
        )
      }
    >
      <ConfirmEmailForm token={token} needsPassword={!sameDevice && !!owner.passwordHash} />
    </AuthShell>
  );
}
