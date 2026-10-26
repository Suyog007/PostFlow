"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

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
