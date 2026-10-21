import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./ui";

/** Frame for sign-in, sign-up and other account pages. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <Link href="/" className="mb-6 flex items-center gap-2.5">
          <Logo size={28} />
          <span className="text-[18px] font-semibold tracking-tight">PostFlow</span>
        </Link>
        <div className="panel p-6">
          <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-[var(--muted)]">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-[13px] text-[var(--muted)]">{footer}</div>}
      </div>
    </main>
  );
}
