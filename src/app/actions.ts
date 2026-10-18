"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { login, logout, requireOwner } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { PILLARS, type Pillar } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import { parseSlots } from "@/server/slots-parse";
import { editPost, postNow, PostError, removePost, reschedulePost, resolveUnconfirmed, restorePost } from "@/server/posts";
import { disconnectAccount, startOAuth } from "@/server/platforms/accounts";
import { registerWebhook } from "@/server/telegram";
import { tick } from "@/server/tick";
import { isPublicHttpUrl } from "@/server/net";

export async function loginAction(_: unknown, form: FormData) {
  const r = await login(String(form.get("password") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

function back(path: string, kind: "error" | "ok", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function guarded(path: string, fn: () => Promise<unknown>, okMessage?: string): Promise<never> {
  await requireOwner();
  try {
    await fn();
  } catch (err) {
    if (err instanceof PostError || err instanceof Error) back(path, "error", err.message);
    throw err;
  }
  revalidatePath("/", "layout");
  return back(path, "ok", okMessage ?? "Saved");
}

// ---- posts ----------------------------------------------------------------

export async function removePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => removePost(id), "Removed from the calendar. It will not be posted.");
}
export async function restorePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => restorePost(id), "Back on the calendar.");
}
export async function editPostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => editPost(id, String(form.get("text") ?? "")), "Saved. Your wording will be posted as written.");
}
export async function reschedulePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(
    `/posts/${id}`,
    async () => {
      const tz = (await getSettings()).timezone;
      const dt = DateTime.fromISO(String(form.get("at")), { zone: tz });
      if (!dt.isValid) throw new PostError("Pick a valid date and time.");
      await reschedulePost(id, dt.toJSDate());
    },
    "Rescheduled.",
  );
}
export async function postNowAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => postNow(id), "Queued. It goes out on the next scheduler tick (within about 5 minutes).");
}
export async function resolveAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => resolveUnconfirmed(id, form.get("published") === "yes"), "Updated.");
}

// ---- notes ----------------------------------------------------------------

export async function addNoteAction(form: FormData) {
  await guarded(
    "/notes",
    async () => {
      const text = String(form.get("text") ?? "").trim();
      const pillar = String(form.get("pillar")) as Pillar;
      if (text.length < 15) throw new Error("Add a bit more detail (at least a sentence).");
      if (!PILLARS.includes(pillar)) throw new Error("Pick a category.");
      await db().insert(schema.notes).values({ text: text.slice(0, 4000), pillar, via: "web" });
    },
    "Note saved. It will be used for an upcoming slot.",
  );
}
export async function deleteNoteAction(form: FormData) {
  await guarded("/notes", () => db().delete(schema.notes).where(eq(schema.notes.id, String(form.get("id")))), "Deleted.");
}

// ---- settings -------------------------------------------------------------

export async function saveProfileAction(form: FormData) {
  await guarded("/settings", async () => {
    const s = await getSettings();
    await saveSettings({
      timezone: String(form.get("timezone") || s.timezone),
      horizonDays: Number(form.get("horizonDays") || s.horizonDays),
      minRelevance: Number(form.get("minRelevance") || s.minRelevance),
      profile: {
        name: String(form.get("name") ?? ""),
        role: String(form.get("role") ?? ""),
        bio: String(form.get("bio") ?? ""),
        voice: String(form.get("voice") ?? ""),
        avoid: String(form.get("avoid") ?? ""),
        expertise: String(form.get("expertise") ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      },
      pillars: {
        own_work: Number(form.get("w_own_work") ?? 0),
        news: Number(form.get("w_news") ?? 0),
        nepal: Number(form.get("w_nepal") ?? 0),
        learning: Number(form.get("w_learning") ?? 0),
      },
      includeLinks: { linkedin: form.get("link_linkedin") === "on", x: form.get("link_x") === "on" },
    });
  });
}

export async function saveFastLaneAction(form: FormData) {
  await guarded("/settings", async () => {
    const platforms = (["x", "linkedin"] as const).filter((p) => form.get(`fl_${p}`) === "on");
    await saveSettings({
      fastLane: {
        enabled: form.get("fl_enabled") === "on",
        minRelevance: Number(form.get("fl_min") || 9),
        maxPerDay: Number(form.get("fl_max") || 1),
        leadMinutes: Number(form.get("fl_lead") || 45),
        platforms,
        quietStart: String(form.get("fl_qs") || "23:00"),
        quietEnd: String(form.get("fl_qe") || "07:00"),
      },
    });
  });
}
export async function saveSlotsAction(form: FormData) {
  await guarded("/settings", async () => saveSettings({ slots: parseSlots(String(form.get("slots") ?? "")) }));
}
export async function togglePauseAction() {
  await guarded("/settings", async () => saveSettings({ paused: !(await getSettings()).paused }));
}

export async function connectAction(form: FormData) {
  await requireOwner();
  const platform = String(form.get("platform"));
  if (platform !== "x" && platform !== "linkedin") return;
  let url: string;
  try {
    url = await startOAuth(platform);
  } catch (err) {
    back("/settings", "error", (err as Error).message);
  }
  redirect(url);
}
export async function disconnectAction(form: FormData) {
  const platform = String(form.get("platform"));
  await guarded("/settings", () => disconnectAccount(platform as "x" | "linkedin"), "Disconnected.");
}
export async function telegramWebhookAction() {
  await guarded("/settings", async () => {
    const msg = await registerWebhook();
    if (!/registered/i.test(msg)) throw new Error(msg);
  }, "Telegram webhook registered. Send /start to your bot.");
}
export async function runTickAction() {
  await guarded("/settings", async () => {
    const r = await tick({ budgetMs: 45_000 });
    if (r.skipped) throw new Error(`Skipped: ${r.skipped}`);
  }, "Ran one scheduler pass.");
}

// ---- sources --------------------------------------------------------------

export async function addSourceAction(form: FormData) {
  await guarded("/settings", async () => {
    const url = String(form.get("url") ?? "").trim();
    if (!isPublicHttpUrl(url)) throw new Error("Enter a public http(s) feed URL.");
    const pillar = form.get("pillar") === "nepal" ? "nepal" : "news";
    await db().insert(schema.sources).values({ name: String(form.get("name") || new URL(url).hostname).slice(0, 80), url, pillar }).onConflictDoNothing();
  }, "Feed added.");
}
export async function toggleSourceAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded("/settings", async () => {
    const s = await db().query.sources.findFirst({ where: eq(schema.sources.id, id) });
    if (s) await db().update(schema.sources).set({ enabled: !s.enabled }).where(eq(schema.sources.id, id));
  });
}
export async function deleteSourceAction(form: FormData) {
  await guarded("/settings", () => db().delete(schema.sources).where(eq(schema.sources.id, String(form.get("id")))), "Feed removed.");
}
