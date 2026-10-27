"use client";

import { useEffect } from "react";
import { SOURCE_COOKIE, SOURCE_MAX_AGE_DAYS, sourceFor } from "@/lib/attribution";

/** Remembers where this visitor first came from (first visit wins), for sign-up attribution. */
export function SourceTracker() {
  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search);
      const tagged = q.has("ref") || q.has("utm_source") || q.has("source");
      // A tagged link replaces an untagged first visit; otherwise the first visit wins.
      const existing = document.cookie.split("; ").find((c) => c.startsWith(`${SOURCE_COOKIE}=`));
      if (existing && !tagged) return;
      const label = sourceFor(location.search, document.referrer, location.hostname);
      document.cookie = `${SOURCE_COOKIE}=${encodeURIComponent(label)}; Max-Age=${SOURCE_MAX_AGE_DAYS * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      /* cookies blocked: no attribution, nothing else changes */
    }
  }, []);
  return null;
}
