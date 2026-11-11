"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

/** Phone: a menu button at the top left that slides a panel in from the left. */
export function MobileMenu({ name, used }: { name: string; used?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The panel is drawn on <body>: inside the blurred header, "fixed" would be trapped in the header.
  useEffect(() => setMounted(true), []);
  const button = useRef<HTMLButtonElement>(null);

  // Close when a link is followed.
  useEffect(() => setOpen(false), [path]);

  // While open: Escape closes, the page behind does not scroll, focus moves into the panel and back out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>("a, button");
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const btn = button.current;
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; btn?.focus(); };
  }, [open]);

  if (path.startsWith("/welcome")) return null;
  const extra = [
    { href: "/create", label: "Write your own post" },
    { href: "/notes", label: "Ideas about your work" },
    { href: "/account", label: "Email and password" },
  ];
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="phone-menu" aria-label="Open menu" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--raised)] md:hidden">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
      </button>

      {mounted && createPortal(
      <div className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-[var(--ink)]/40 transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`} />
        <div
          ref={panel}
          id="phone-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 left-0 flex w-[84%] max-w-[330px] flex-col bg-[var(--bg)] shadow-[8px_0_40px_-12px_rgba(27,36,32,.35)] transition-transform duration-[320ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <span className="display text-[24px]">PostFlow</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--raised)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <nav aria-label="Main" className="mt-2 px-3">
            {ITEMS.map((i) => {
              const on = isActive(path, i.match);
              return (
                <Link key={i.href} href={i.href} tabIndex={open ? 0 : -1} aria-current={on ? "page" : undefined} className={`flex h-14 items-center gap-4 rounded-[14px] px-3 text-[19px] font-semibold ${on ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_6px_16px_-12px_rgba(27,36,32,.4)]" : "text-[var(--muted)]"}`}>
                  <span className={on ? "text-[var(--accent)]" : ""}><Glyph name={i.label} on={on} /></span>
                  {i.label}
                </Link>
              );
            })}
          </nav>

          <div className="mx-6 my-4 border-t border-[var(--line)]" />
          <nav aria-label="More" className="px-3">
            {extra.map((i) => (
              <Link key={i.href} href={i.href} tabIndex={open ? 0 : -1} className="flex h-12 items-center rounded-[12px] px-3 text-[17px] text-[var(--ink)] hover:bg-[var(--raised)]">{i.label}</Link>
            ))}
          </nav>

          <div className="mt-auto border-t border-[var(--line)] px-6 py-5">
            <p className="text-[16px] font-semibold">{name}</p>
            {used && <p className="mt-0.5 text-[14px] text-[var(--muted)]">{used}</p>}
          </div>
        </div>
      </div>,
      document.body,
      )}
    </>
  );
}
