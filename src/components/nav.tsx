"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const ITEMS = [
  { href: "/calendar", label: "Posts", icon: "calendar" },
  { href: "/create", label: "Write", icon: "create" },
  { href: "/notes", label: "Ideas", icon: "notes" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

const SECONDARY = [
  { href: "/account", label: "Account", icon: "shield" },
] as const;

function active(path: string, href: string) {
  return href === "/calendar" ? path.startsWith("/calendar") || path.startsWith("/posts") : path.startsWith(href);
}

export function SideNav({ owner = false }: { owner?: boolean }) {
  const path = usePathname();
  const items = [...ITEMS, ...SECONDARY, ...(owner ? [{ href: "/admin", label: "Admin", icon: "alert" } as const] : [])];
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(path, i.href) ? "page" : undefined}
          className={`flex h-11 items-center gap-3 rounded-full px-4 text-[15px] font-semibold transition-colors ${active(path, i.href) ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--raised)] hover:text-[var(--ink)]"}`}
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
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--line)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(path, i.href) ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[12px] font-semibold ${active(path, i.href) ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
          <span className={`flex h-8 w-14 items-center justify-center rounded-full ${active(path, i.href) ? "bg-[var(--accent-soft)]" : ""}`}><Icon name={i.icon} size={20} /></span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
