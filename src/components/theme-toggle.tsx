"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "postflow-theme";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Theme: match device", light: "Theme: light", dark: "Theme: dark" };

function apply(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // Private windows can refuse storage; the theme still applies for this visit.
  }
}

/** Cycles device → light → dark. The choice is remembered on this device. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "system");
  }, []);
  const next = () => {
    const t = NEXT[theme];
    apply(t);
    setTheme(t);
  };
  return (
    <button type="button" onClick={next} aria-label={`${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]].replace("Theme: ", "")}`} title={LABEL[theme]} className={`inline-flex h-9 w-9 flex-none items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--side)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}>
      {theme === "light" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      )}
    </button>
  );
}
