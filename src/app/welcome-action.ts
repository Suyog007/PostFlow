"use server";

import { redirect } from "next/navigation";
import { requireActiveUser } from "@/server/auth";
import { withUser } from "@/server/context";
import { completeWelcome } from "@/server/welcome";
import { log } from "@/server/log";

export type WelcomeValues = { field: string; audience: string; role: string; expertise: string; region: string; feed1: string; feed2: string };
export type WelcomeState = { error: string; values: WelcomeValues } | null;

export async function welcomeAction(_: WelcomeState, form: FormData): Promise<WelcomeState> {
  const user = await requireActiveUser();
  const values: WelcomeValues = {
    field: String(form.get("field") ?? "tech"),
    audience: String(form.get("audience") ?? ""),
    role: String(form.get("role") ?? ""),
    expertise: String(form.get("expertise") ?? ""),
    region: String(form.get("region") ?? ""),
    feed1: String(form.get("feed1") ?? ""),
    feed2: String(form.get("feed2") ?? ""),
  };
  let added: string[] = [];
  try {
    const r = await withUser(user.id, () =>
      completeWelcome({ field: values.field, audience: values.audience, role: values.role, expertise: values.expertise, region: values.region, feeds: [values.feed1, values.feed2] }),
    );
    if (!r.ok) return { error: r.error, values };
    added = r.added;
  } catch (err) {
    log.error("welcome_failed", { error: (err as Error).message });
    return { error: "Something went wrong. Please try again.", values };
  }
  const ok = added.length ? `You're set. Added ${added.join(" and ")} to your feeds.` : "You're set.";
  redirect(`/calendar?welcome=1&ok=${encodeURIComponent(ok)}`);
}
