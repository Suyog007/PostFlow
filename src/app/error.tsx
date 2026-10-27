"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails to load. The error's digest is shown so a report can be matched to the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="mono text-[13px] uppercase tracking-[.14em] text-[var(--muted)]">Something went wrong</p>
      <h1 className="display mt-3 text-[40px]">
        This page <span className="em">didn&apos;t load.</span>
      </h1>
      <p className="mt-4 max-w-[440px] text-[15px] text-[var(--muted)]">Nothing was posted or changed. Try again; if it keeps happening, the reference below helps track it down.</p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary h-10 px-4 text-[14px]">Try again</button>
        <Link href="/calendar" className="btn h-10 px-4 text-[14px]">Open the calendar</Link>
      </div>
      {error.digest && <p className="mono mt-8 text-[12px] text-[var(--muted)]">Reference {error.digest}</p>}
    </main>
  );
}
