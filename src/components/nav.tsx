"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const ITEMS = [
  { href: "/", label: "Calendar", icon: "calendar" },
  { href: "/create", label: "Create", icon: "create" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

function active(path: string, href: string) {
  return href === "/" ? path === "/" || path.startsWith("/posts") : path.startsWith(href);
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(path, i.href) ? "page" : undefined}
          className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium ${active(path, i.href) ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_0_0_1px_var(--line)]" : "text-[var(--muted)] hover:bg-[var(--surface)]/60 hover:text-[var(--ink)]"}`}
        >
          <Icon name={i.icon} size={16} />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--line)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom,0px)] md:hidden">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(path, i.href) ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active(path, i.href) ? "text-[var(--ink)]" : "text-[var(--subtle)]"}`}>
          <Icon name={i.icon} size={20} />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
