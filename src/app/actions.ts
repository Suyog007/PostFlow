"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireActiveUser, requireOwnerUser } from "@/server/auth";
import { withUser } from "@/server/context";
import { assertFeature, assertFeedQuota, LimitError } from "@/server/billing/plans";
import { db, schema } from "@/server/db/client";
import { PILLARS, type Pillar } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import { parseSlots } from "@/server/slots-parse";
import { approvePost, editPost, postNow, PostError, removePost, unapprovePost, reschedulePost, resolveUnconfirmed, restorePost, scheduleDraft } from "@/server/posts";
import { createRequest, processRequests, type RequestMode } from "@/server/requests";
import { addTip } from "@/server/tips";
import { disconnectAccount, startOAuth } from "@/server/platforms/accounts";
import { registerWebhook, unlinkTelegram } from "@/server/telegram";
import { requestFillNow, runForUser, tick } from "@/server/tick";
import { addEvent } from "@/server/events";
import { publishDue } from "@/server/publisher";
import { fillNowDays, recheckPost, rejectAndReplace, rewordPost, swapToAlternative } from "@/server/generate";
import { isPublicHttpUrl } from "@/server/net";

function back(path: string, kind: "error" | "ok", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function guarded(path: string, fn: () => Promise<unknown>, okMessage?: string): Promise<never> {
  await requireActiveUser();
  try {
    await fn();
  } catch (err) {
    if (err instanceof PostError || err instanceof LimitError || err instanceof Error) back(path, "error", err.message);
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
  const user = await requireActiveUser();
  await guarded(
    `/posts/${id}`,
    async () => {
      if ((await withUser(user.id, () => getSettings())).paused) throw new Error("Posting is paused. Resume it in Settings first.");
      await postNow(id);
      // Publish straight away instead of waiting for the next scheduler run.
      after(() => withUser(user.id, () => publishDue()).then(() => undefined).catch(() => undefined));
    },
    "Posting now. It should be live within a minute. Its original slot stays empty.",
  );
}
export async function approvePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => approvePost(id), "Approved. It goes out at its scheduled time.");
}
export async function unapprovePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => unapprovePost(id), "Approval withdrawn. It will not be posted until you approve it again.");
}
export async function rejectPostAction(form: FormData) {
  const id = String(form.get("id"));
  await requireActiveUser();
  let r: Awaited<ReturnType<typeof rejectAndReplace>>;
  try {
    r = await rejectAndReplace(id);
  } catch (err) {
    back(`/posts/${id}`, "error", (err as Error).message);
  }
  revalidatePath("/", "layout");
  back(r.replacementId ? `/posts/${r.replacementId}` : "/calendar", "ok", r.message);
}
export async function rewordPostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => rewordPost(id, String(form.get("feedback") ?? ""), form.get("remember") === "on"), "Reworded. Check it and approve when it sounds like you.");
}
/** Swap a post with its other version (normal take vs plain explainer). */
export async function swapVersionAction(form: FormData) {
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  await guarded(`/posts/${id}`, () => swapToAlternative(id), "Switched versions. Approve it when you are happy.");
}

/** A second, more careful review of a post the reviewer held back. */
export async function recheckPostAction(form: FormData) {
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  await requireActiveUser();
  let r: { approved: boolean; message: string };
  try {
    r = await recheckPost(id);
  } catch (err) {
    back(`/posts/${id}`, "error", (err as Error).message);
  }
  revalidatePath("/", "layout");
  back(`/posts/${id}`, r.approved ? "ok" : "error", r.message);
}
export async function removeStyleNoteAction(form: FormData) {
  const i = Number(form.get("i"));
  await guarded("/settings", async () => {
    const s = await getSettings();
    await saveSettings({ styleNotes: s.styleNotes.filter((_, j) => j !== i) });
  }, "Removed.");
}
export async function resolveAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => resolveUnconfirmed(id, form.get("published") === "yes"), "Updated.");
}

export async function scheduleDraftAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => scheduleDraft(id), "On the calendar at the next free slot.");
}

// ---- create from an idea or link ------------------------------------------

export async function createPostAction(form: FormData) {
  await guarded(
    "/create",
    async () => {
      const platforms = (["linkedin", "x"] as const).filter((p) => form.get(`p_${p}`) === "on");
      if (!platforms.length) throw new Error("Pick at least one platform.");
      const mode = String(form.get("mode")) as RequestMode;
      await createRequest({ text: String(form.get("text") ?? ""), platforms: [...platforms], mode: ["schedule", "soon", "draft"].includes(mode) ? mode : "schedule", own: form.get("own") === "on" });
      const user = await requireActiveUser();
      after(() => withUser(user.id, () => processRequests({ max: 1 }).then(() => undefined)));
    },
    "Writing it now. It shows up on the calendar (or under Drafts) within a minute or two.",
  );
}

export async function addTipAction(form: FormData) {
  await guarded(
    "/create",
    async () => {
      const r = await addTip(String(form.get("url") ?? ""));
      if (!r.ok) throw new Error(r.message);
    },
    "Tip saved. It is posted only if other publishers confirm it.",
  );
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
      const user = await requireActiveUser();
      await db().insert(schema.notes).values({ userId: user.id, text: text.slice(0, 4000), pillar, via: "web" });
    },
    "Note saved. It will be used for an upcoming slot.",
  );
}
export async function deleteNoteAction(form: FormData) {
  await guarded("/notes", async () => {
    const user = await requireActiveUser();
    await db().delete(schema.notes).where(and(eq(schema.notes.id, String(form.get("id"))), eq(schema.notes.userId, user.id)));
  }, "Deleted.");
}

// ---- settings -------------------------------------------------------------

export async function saveProfileAction(form: FormData) {
  await guarded("/settings", async () => {
    const s = await getSettings();
    await saveSettings({
      timezone: String(form.get("timezone") || s.timezone),
      horizonDays: Number(form.get("horizonDays") || s.horizonDays),
      minRelevance: Number(form.get("minRelevance") || s.minRelevance),
      linkedinMinRelevance: Number(form.get("linkedinMinRelevance") || s.linkedinMinRelevance),
      fillerPosts: form.get("fillerPosts") === "on",
      ownDomains: String(form.get("ownDomains") ?? "").split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean),
      profile: {
        name: String(form.get("name") ?? ""),
        role: String(form.get("role") ?? ""),
        bio: String(form.get("bio") ?? ""),
        region: String(form.get("region") ?? "").trim().slice(0, 60),
        voice: String(form.get("voice") ?? ""),
        avoid: String(form.get("avoid") ?? ""),
        expertise: String(form.get("expertise") ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      },
      pillars: {
        own_work: Number(form.get("w_own_work") ?? 0),
        news: Number(form.get("w_news") ?? 0),
        local: Number(form.get("w_local") ?? 0),
        learning: Number(form.get("w_learning") ?? 0),
      },
      hashtags: { linkedin: form.get("tags_linkedin") === "on", x: form.get("tags_x") === "on" },
      // Links on X cost far more per post; only owners can turn them on.
      includeLinks: { linkedin: form.get("link_linkedin") === "on", x: (await requireActiveUser()).isOwner && form.get("link_x") === "on" },
    });
  });
}

export async function saveFastLaneAction(form: FormData) {
  await guarded("/settings", async () => {
    if (form.get("fl_enabled") === "on") await assertFeature("fastLane", "The fast lane");
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
export async function toggleApprovalAction() {
  await guarded("/settings", async () => {
    const s = await getSettings();
    if (s.requireApproval) await assertFeature("autoMode", "Auto mode");
    await saveSettings({ requireApproval: !s.requireApproval });
  });
}
export async function togglePauseAction() {
  await guarded("/settings", async () => saveSettings({ paused: !(await getSettings()).paused }));
}

export async function connectAction(form: FormData) {
  await requireActiveUser();
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
export async function unlinkTelegramAction() {
  await guarded("/settings", () => unlinkTelegram(), "Telegram disconnected.");
}
/** Runs the pipeline for the signed-in user only. */
export async function runTickAction() {
  await guarded("/settings", async () => {
    const user = await requireActiveUser();
    const r = await runForUser(user.id, { budgetMs: 45_000 });
    if (r.errors.length) throw new Error(r.errors[0]);
  }, "Checked for new material and filled open slots.");
}

/** "Fill now" on the calendar: writes for every open slot in the planning window, in the background. */
export async function fillCalendarAction() {
  const user = await requireActiveUser();
  const s = await withUser(user.id, () => getSettings());
  await guarded("/calendar", () => requestFillNow(user.id, (job) => after(job)), `Filling the next ${fillNowDays(s)} days. New posts appear here over the next few minutes.`);
}

// ---- admin ------------------------------------------------------------------

async function adminGuarded(fn: () => Promise<unknown>, okMessage: string): Promise<never> {
  await requireOwnerUser();
  try {
    await fn();
  } catch (err) {
    back("/admin", "error", (err as Error).message);
  }
  revalidatePath("/admin");
  return back("/admin", "ok", okMessage);
}
export async function telegramWebhookAction() {
  await adminGuarded(async () => {
    const msg = await registerWebhook();
    if (!/registered/i.test(msg)) throw new Error(msg);
  }, "Telegram webhook registered.");
}
export async function adminTickAction() {
  await adminGuarded(async () => {
    const r = await tick({ budgetMs: 45_000 });
    if (r.skipped) throw new Error(`Skipped: ${r.skipped}`);
  }, "Ran one scheduler pass for all users.");
}

// ---- sources --------------------------------------------------------------

export async function addSourceAction(form: FormData) {
  await guarded("/settings", async () => {
    const url = String(form.get("url") ?? "").trim();
    if (!isPublicHttpUrl(url)) throw new Error("Enter a public http(s) feed URL.");
    const pillar = form.get("pillar") === "local" ? "local" : "news";
    await assertFeedQuota();
    const user = await requireActiveUser();
    await db().insert(schema.sources).values({ userId: user.id, name: String(form.get("name") || new URL(url).hostname).slice(0, 80), url, pillar }).onConflictDoNothing();
  }, "Feed added.");
}
export async function toggleSourceAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded("/settings", async () => {
    const user = await requireActiveUser();
    const s = await db().query.sources.findFirst({ where: and(eq(schema.sources.id, id), eq(schema.sources.userId, user.id)) });
    if (s && !s.enabled) await assertFeedQuota();
    if (s) await db().update(schema.sources).set({ enabled: !s.enabled }).where(and(eq(schema.sources.id, id), eq(schema.sources.userId, user.id)));
  });
}
export async function deleteSourceAction(form: FormData) {
  await guarded("/settings", async () => {
    const user = await requireActiveUser();
    await db().delete(schema.sources).where(and(eq(schema.sources.id, String(form.get("id"))), eq(schema.sources.userId, user.id)));
  }, "Feed removed.");
}
