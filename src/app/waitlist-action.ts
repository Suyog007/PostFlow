"use server";

import { joinWaitlist, type JoinResult } from "@/server/waitlist";
import { visitSource } from "@/server/attribution";
import { rateLimited } from "@/server/auth";

/** Public: used by the landing page form. */
export async function joinWaitlistAction(_: unknown, form: FormData): Promise<JoinResult> {
  if (form.get("company")) return { ok: true, message: "You're on the list." }; // honeypot: bots fill every field
  if (await rateLimited("waitlist", 10, 60 * 60_000)) return { ok: false, error: "Too many attempts. Try again later." };
  try {
    return await joinWaitlist({ email: form.get("email"), plan: form.get("plan"), role: form.get("role"), source: await visitSource() });
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
