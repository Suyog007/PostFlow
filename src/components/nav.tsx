"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

const ITEMS = [
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/create", label: "Create", icon: "create" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

const SECONDARY = [
  { href: "/billing", label: "Billing", icon: "chart" },
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
          className={`relative flex h-9 items-center gap-2.5 rounded-md px-3 text-[14px] font-semibold ${active(path, i.href) ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_2px_0_var(--line)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--ink)]"}`}
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
        <Link key={i.href} href={i.href} aria-current={active(path, i.href) ? "page" : undefined} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active(path, i.href) ? "text-[var(--ink)] after:absolute after:top-0 after:h-[3px] after:w-8 after:rounded-b-full after:bg-[var(--accent)]" : "text-[var(--subtle)]"}`}>
          <Icon name={i.icon} size={20} />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
