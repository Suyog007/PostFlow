"use server";

import { headers } from "next/headers";
import { joinWaitlist, type JoinResult } from "@/server/waitlist";
import { visitSource } from "@/server/attribution";

// Best-effort limiter per server instance, enough to stop casual form spam.
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60 * 60_000 });
    return false;
  }
  return ++h.n > 10;
}

/** Public: used by the landing page form. */
export async function joinWaitlistAction(_: unknown, form: FormData): Promise<JoinResult> {
  if (form.get("company")) return { ok: true, message: "You're on the list." }; // honeypot: bots fill every field
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return { ok: false, error: "Too many attempts. Try again later." };
  try {
    return await joinWaitlist({ email: form.get("email"), plan: form.get("plan"), role: form.get("role"), source: await visitSource() });
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
