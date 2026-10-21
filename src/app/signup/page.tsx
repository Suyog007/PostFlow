import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { Divider, GoogleButton, SignupForm } from "@/components/auth-forms";
import { getSessionUser } from "@/server/auth";
import { googleConfigured } from "@/server/google";
import { signupsOpen } from "@/server/users";
import { planById, TRIAL_DAYS } from "@/lib/pricing";

export const metadata: Metadata = { title: "Create your account · PostFlow" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string; interval?: string }> }) {
  const sp = await searchParams;
  const plan = planById(sp.plan);
  const billing = `/billing${plan && !plan.soon ? `?plan=${plan.id}&interval=${sp.interval === "month" ? "month" : "year"}` : ""}`;
  if (await getSessionUser()) redirect(billing);
  const open = signupsOpen();
  return (
    <AuthShell
      title="Create your account"
      subtitle={open ? `Then pick a plan and start your ${TRIAL_DAYS}-day free trial.` : "Sign-ups open soon."}
      footer={<>Already have an account? <Link href="/login" className="font-medium text-[var(--ink)] underline">Sign in</Link></>}
    >
      {!open && (
        <p className="mb-4 rounded-md bg-[var(--warn-soft)] px-3 py-2 text-[13px] text-[var(--warn)]">
          PostFlow is invite-only for now. <Link href="/#early-access" className="underline">Join the waitlist</Link> and we will email you.
        </p>
      )}
      {googleConfigured() && (
        <>
          <GoogleButton next={billing} label="Sign up with Google" />
          <Divider />
        </>
      )}
      <SignupForm />
    </AuthShell>
  );
}
