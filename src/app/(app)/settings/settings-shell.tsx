"use client";

// Phone: the list alone, or one setting page with a back link. Wider screens: the list on the left,
// the open page on the right, the open row highlighted.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

const TITLES: Record<string, string> = {
  you: "About you",
  times: "Posting times",
  accounts: "Connections",
  sources: "News sources",
  more: "More options",
};

export function SettingsShell({ list, children }: { list: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const section = path.split("/")[2] ?? "";
  const atList = !section;
  return (
    <div className="md:grid md:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] md:gap-10">
      <div className={atList ? "" : "hidden md:block"}>{list}</div>
      <div className={atList ? "hidden md:block" : ""}>
        {!atList && (
          <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-[15px] font-medium text-[var(--accent)] md:hidden">
            <Icon name="left" size={18} />Settings
          </Link>
        )}
        <h2 className="display mb-6 text-[30px] sm:text-[34px]">{TITLES[section] ?? "About you"}</h2>
        {children}
      </div>
    </div>
  );
}

/** A list row that opens a page. It is marked as open while that page shows on the right. */
export function RowLink({ href, children, tall }: { href: string; children: ReactNode; tall?: boolean }) {
  const path = usePathname();
  const base = href.split("#")[0];
  const open = !href.includes("#") && (path === base || (path === "/settings" && base === "/settings/you"));
  return (
    <Link
      href={href}
      aria-current={open ? "page" : undefined}
      className={`flex items-center gap-3 px-4 transition-colors ${tall ? "min-h-[76px] py-3" : "min-h-[52px] py-2.5"} ${open ? "md:bg-[var(--accent-soft)]" : "hover:bg-[var(--raised)]"}`}
    >
      {children}
    </Link>
  );
}
