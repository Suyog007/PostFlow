"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Three places, named for what people do there. Writing your own post and ideas are on Home.
const ITEMS = [
  { href: "/calendar", label: "Home", match: ["/calendar", "/posts", "/create", "/notes"] },
  { href: "/week", label: "This week", match: ["/week"] },
  { href: "/settings", label: "Settings", match: ["/settings", "/account", "/billing", "/admin"] },
] as const;

const isActive = (path: string, match: readonly string[]) => match.some((m) => path === m || path.startsWith(`${m}/`) || path.startsWith(`${m}?`));

function Glyph({ name, on }: { name: string; on: boolean }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: on ? 2 : 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "Home") return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...p} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === "This week") return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect {...p} x="4" y="5" width="16" height="15" rx="2.5" /><path {...p} d="M4 10h16M9 3v4M15 3v4" /></svg>;
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...p} d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle {...p} cx="16" cy="7" r="2" /><circle {...p} cx="10" cy="17" r="2" /></svg>;
}

/** Desktop: the tabs in the top bar. */
export function TopNav() {
  const path = usePathname();
  if (path.startsWith("/welcome")) return null;
  return (
    <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
      {ITEMS.map((i) => {
        const on = isActive(path, i.match);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={`text-[17px] font-semibold transition-colors ${on ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: the tabs at the bottom, within thumb reach. */
export function TabBar() {
  const path = usePathname();
  // First-run setup is one task with its own Continue button; the tabs would only distract.
  if (path.startsWith("/welcome")) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--line)] bg-[var(--bg)]/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden">
      {ITEMS.map((i) => {
        const on = isActive(path, i.match);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-1 pb-2.5 pt-3 text-[14px] font-semibold ${on ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>
            <span className={on ? "text-[var(--accent)]" : ""}><Glyph name={i.label} on={on} /></span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
