import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./ui";

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-2 px-4">
          <Link href="/" className="flex items-center gap-2"><Logo size={22} /><span className="font-semibold">PostFlow</span></Link>
        </div>
      </header>
      <main className="legal mx-auto max-w-[760px] px-4 py-10 text-[15px] leading-relaxed">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-[var(--subtle)]">Last updated {updated}</p>
        <div className="mt-8 space-y-4">{children}</div>
      </main>
    </div>
  );
}
