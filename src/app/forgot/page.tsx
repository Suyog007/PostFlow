import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Reset your password · PostFlow" };

export default function ForgotPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new one." footer={<Link href="/login" className="underline">Back to sign in</Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
