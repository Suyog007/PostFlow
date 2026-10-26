"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

/** True once the element has scrolled into view (and stays true unless `once` is false). */
export function useInView<T extends Element>(ref: RefObject<T | null>, { once = true, margin = "0px 0px -10% 0px" }: { once?: boolean; margin?: string } = {}) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? setSeen(true) : !once && setSeen(false)), { rootMargin: margin, threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return seen;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Page-wide behaviour, mounted once: reveals `.reveal` elements as they scroll into view and tilts
 * `[data-tilt]` elements flat as they reach the middle of the screen. Renders nothing.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.in = "true";
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    const tilted = Array.from(document.querySelectorAll<HTMLElement>("[data-tilt]"));
    let frame = 0;
    const update = () => {
      frame = 0;
      for (const el of tilted) {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // 1 while the element is still low on the screen, 0 once it has reached the upper half.
        const t = Math.min(1, Math.max(0, (r.top - vh * 0.3) / (vh * 0.55)));
        el.style.setProperty("--tilt", t.toFixed(3));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "review", label: "Reviewer" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

/** Sticky header: gains a border once you scroll, and underlines the section you are reading. */
export function LandingNav({ loggedIn, open, primary }: { loggedIn: boolean; open: boolean; primary: { href: string; label: string } }) {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Escape closes the phone menu.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <header ref={ref} data-scrolled={scrolled} className="sticky top-0 z-40 border-b border-transparent bg-[var(--bg)]/80 backdrop-blur transition-colors data-[scrolled=true]:border-[var(--line)]">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={24} />
          <span className="text-[16px] font-semibold tracking-tight">PostFlow</span>
        </Link>
        <nav className="hidden items-center gap-1 text-[14px] md:flex" aria-label="Sections">
          {SECTIONS.map((n) => (
            <a key={n.id} href={`#${n.id}`} aria-current={active === n.id ? "true" : undefined} className={`rounded-md px-3 py-1.5 transition-colors hover:text-[var(--ink)] ${active === n.id ? "bg-[var(--side)] text-[var(--ink)]" : "text-[var(--muted)]"}`}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          {loggedIn ? (
            <Link href="/calendar" className="btn btn-primary h-9 text-[14px]">Open app</Link>
          ) : (
            <>
              <span className="hidden sm:inline-flex"><Link href="/login" className="btn btn-ghost h-9 text-[14px]">Sign in</Link></span>
              <a href={primary.href} className="btn btn-primary h-9 text-[14px]">{open ? "Start free trial" : primary.label}</a>
            </>
          )}
          <span className="md:hidden"><button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--side)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" aria-expanded={menu} aria-controls="landing-menu" aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((m) => !m)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button></span>
        </div>
      </div>
      {menu && (
        <nav id="landing-menu" aria-label="Sections" className="border-t border-[var(--line)] bg-[var(--bg)] px-4 pb-4 pt-2 md:hidden">
          {SECTIONS.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={() => setMenu(false)} className="block rounded-md px-2 py-2.5 text-[15px] text-[var(--muted)] hover:bg-[var(--side)] hover:text-[var(--ink)]">
              {n.label}
            </a>
          ))}
          {!loggedIn && <Link href="/login" className="block rounded-md px-2 py-2.5 text-[15px] text-[var(--muted)] hover:bg-[var(--side)] hover:text-[var(--ink)]">Sign in</Link>}
        </nav>
      )}
    </header>
  );
}
