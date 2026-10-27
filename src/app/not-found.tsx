import Link from "next/link";
import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Link href="/" className="mb-8 flex items-center gap-2" aria-label="PostFlow home">
        <Logo size={26} />
        <span className="display text-[24px]">PostFlow</span>
      </Link>
      <p className="mono text-[13px] uppercase tracking-[.14em] text-[var(--muted)]">Error 404</p>
      <h1 className="display mt-3 text-[44px]">
        This page <span className="em">isn&apos;t in print.</span>
      </h1>
      <p className="mt-4 max-w-[420px] text-[15px] text-[var(--muted)]">The link may be old, or the post may have been removed.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/calendar" className="btn btn-primary h-10 px-4 text-[14px]">Open the calendar</Link>
        <Link href="/" className="btn h-10 px-4 text-[14px]">Home</Link>
      </div>
    </main>
  );
}
