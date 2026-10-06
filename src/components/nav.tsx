"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Home, Compass, CalendarDays, FileText, ClipboardPaste, BarChart3, Settings } from "lucide-react";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/intake", label: "Intake", icon: ClipboardPaste },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/drafts", label: "Drafts", icon: FileText },
  { href: "/scorecard", label: "Scorecard", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ counts }: { counts: { drafts: number; problems: number } }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="flex gap-1 md:flex-col">
      {NAV.map(({ href, label, icon: Icon }) => {
        const badge = href === "/drafts" ? counts.drafts + counts.problems : 0;
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              active(href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-card hover:text-ink",
            )}
          >
            <Icon size={17} strokeWidth={2} />
            <span className="hidden sm:inline">{label}</span>
            {badge > 0 && (
              <span className={clsx("ml-auto rounded-full px-1.5 text-xs text-white", counts.problems ? "bg-bad" : "bg-accent")}>{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
