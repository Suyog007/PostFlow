"use server";

import { fieldOf } from "@/lib/fields";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireActiveUser, requireOwnerUser } from "@/server/auth";
import { withUser } from "@/server/context";
import { activePlatforms, assertFeature, assertFeedQuota, CONNECT_FIRST, entitlementFor, LimitError, X_IS_PRO } from "@/server/billing/plans";
import { db, schema } from "@/server/db/client";
import { PILLARS, type Pillar } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import { parseSlots } from "@/server/slots-parse";
import { approvePost, editPost, postNow, PostError, removePost, unapprovePost, reschedulePost, resolveUnconfirmed, restorePost, scheduleDraft } from "@/server/posts";
import { createRequest, processRequests, retryAnyway, type RequestMode } from "@/server/requests";
import { addTip } from "@/server/tips";
import { disconnectAccount, startOAuth } from "@/server/platforms/accounts";
import { newTelegramLinkUrl, registerWebhook, unlinkTelegram } from "@/server/telegram";
import { requestFillNow, requestRefresh, requestReplacement, requestSources, runForUser, tick } from "@/server/tick";
import { addEvent } from "@/server/events";
import { publishDue } from "@/server/publisher";
import { declinePost, fillNowDays, recheckPost, refillSlot, rewordPost, swapToAlternative, writeLesson } from "@/server/generate";
import { warnOnError } from "@/server/log";
import { redrawPostImage } from "@/server/post-images";
import { isPublicHttpUrl } from "@/server/net";

function back(path: string, kind: "error" | "ok", message: string): never {
  const [base, hash] = path.split("#");
  redirect(`${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`);
}

/** Runs a change; on failure returns to `path` with the reason, on success to `donePath` (default: the same page). */
async function guarded(path: string, fn: () => Promise<unknown>, okMessage?: string, donePath?: string): Promise<never> {
  await requireActiveUser();
  try {
    await fn();
  } catch (err) {
    if (err instanceof PostError || err instanceof LimitError || err instanceof Error) back(path, "error", err.message);
    throw err;
  }
  revalidatePath("/", "layout");
  return back(donePath ?? path, "ok", okMessage ?? "Saved");
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
/** Where a post action returns to: the home list when it was pressed there, else the post's own page. */
const backTo = (form: FormData, id: string) => (form.get("back") === "home" ? `/calendar#post-${id}` : `/posts/${id}`);

export async function approvePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(backTo(form, id), () => approvePost(id), "Approved. It goes out at its time.");
}
export async function unapprovePostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(backTo(form, id), () => unapprovePost(id), "Approval withdrawn. It will not be posted until you approve it again.");
}
export async function rejectPostAction(form: FormData) {
  const id = String(form.get("id"));
  const user = await requireActiveUser();
  try {
    await declinePost(id);
  } catch (err) {
    back(`/posts/${id}`, "error", (err as Error).message);
  }
  // The replacement takes longer than a page may wait, so it is written in the background.
  await requestReplacement(user.id, id, (job) => after(job));
  revalidatePath("/", "layout");
  back("/calendar", "ok", "Rejected. Writing a different story for the same slot; it appears here in a minute or two, and on Telegram if you linked it.");
}
export async function rewordPostAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(`/posts/${id}`, () => rewordPost(id, String(form.get("feedback") ?? ""), form.get("remember") === "on"), "Reworded. Check it and approve when it sounds like you.");
}
/** Draw a new picture for one post. */
export async function redrawImageAction(form: FormData) {
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  const user = await requireActiveUser();
  await guarded(`/posts/${id}`, async () => {
    const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), eq(schema.posts.userId, user.id)) });
    if (!p) throw new Error("Post not found.");
    if (!(await redrawPostImage(p))) throw new Error("Could not find another photo right now. Try again in a minute.");
  }, "Swapped in a new photo.");
}
/** Switch the picture on or off for one post. */
export async function togglePostImageAction(form: FormData) {
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  const user = await requireActiveUser();
  await guarded(`/posts/${id}`, async () => {
    const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), eq(schema.posts.userId, user.id)) });
    if (!p) throw new Error("Post not found.");
    const review = (p.review ?? {}) as Record<string, unknown>;
    await db().update(schema.posts).set({ review: { ...review, noImage: !review.noImage }, updatedAt: new Date() }).where(eq(schema.posts.id, id));
  }, "Saved.");
}

/** Swap a post with its other version (normal take vs plain explainer). */
export async function swapVersionAction(form: FormData) {
  const id = String(form.get("id"));
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  await guarded(`/posts/${id}`, () => swapToAlternative(id), "Switched versions. Approve it when you are happy.");
}

/** Rewrite every queued post that is not approved or edited, in the latest writing style. */
export async function refreshQueuedAction() {
  const user = await requireActiveUser();
  await guarded("/calendar", () => requestRefresh(user.id, (job) => after(job)), "Rewriting your queued posts in the new style. This takes a few minutes; posts you approved or edited stay as they are.");
}

/** Fill a slot you emptied by removing a post, with a lesson or a news story. */
export async function refillSlotAction(form: FormData) {
  const id = String(form.get("id"));
  const kind = form.get("kind") === "lesson" ? "lesson" : "news";
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("/calendar", "error", "Post not found.");
  await requireActiveUser();
  let newId = "";
  try {
    newId = await refillSlot(id, kind);
  } catch (err) {
    back(`/posts/${id}`, "error", (err as Error).message);
  }
  revalidatePath("/", "layout");
  back(`/posts/${newId}`, "ok", kind === "lesson" ? "Here is a short lesson for that slot. Check it and approve it." : "Here is a story for that slot. Check it and approve it.");
}

/** "Add a lesson": a short, simple post that teaches your audience one thing, in the next free slots. */
export async function writeLessonAction(form: FormData) {
  const user = await requireActiveUser();
  const topic = String(form.get("topic") ?? "").trim().slice(0, 200);
  await guarded(
    "/calendar",
    async () => {
      if (!(await activePlatforms(user.id)).length) throw new Error(CONNECT_FIRST);
      after(() => withUser(user.id, () => writeLesson({ topic: topic || undefined })).then(() => undefined).catch(warnOnError("lesson_failed", { userId: user.id })));
    },
    topic ? `Writing a short lesson on "${topic}". It appears in the next free slot within a minute or two.` : "Writing a short lesson on one of your topics. It appears in the next free slot within a minute or two.",
  );
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
  await guarded("/settings/you", async () => {
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
      await createRequest({ text: String(form.get("text") ?? ""), platforms: [...platforms], mode: ["schedule", "soon", "draft"].includes(mode) ? mode : "schedule", own: form.get("own") === "on", research: form.get("research") === "on", force: form.get("force") === "on" });
      const user = await requireActiveUser();
      after(() => withUser(user.id, () => processRequests({ max: 1 }).then(() => undefined)));
    },
    "Writing it now. It shows up on the calendar (or under Drafts) within a minute or two.",
  );
}

/** A request the research found weak: write it anyway. */
export async function retryAnywayAction(form: FormData) {
  const id = String(form.get("id"));
  await guarded(
    "/create",
    async () => {
      const user = await requireActiveUser();
      await retryAnyway(id);
      after(() => withUser(user.id, () => processRequests({ max: 1 }).then(() => undefined)));
    },
    "Writing it anyway. It shows up on the calendar (or under Drafts) within a minute or two.",
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

/** Settings > Voice: who you are and how you sound. */
export async function saveVoiceAction(form: FormData) {
  await guarded("/settings/you", async () => {
    const s = await getSettings();
    await saveSettings({
      profile: {
        ...s.profile,
        name: String(form.get("name") ?? ""),
        field: fieldOf(String(form.get("field") ?? s.profile.field)).id,
        audience: String(form.get("audience") ?? s.profile.audience).trim().slice(0, 160),
        role: String(form.get("role") ?? ""),
        bio: String(form.get("bio") ?? ""),
        region: String(form.get("region") ?? "").trim().slice(0, 60),
        voice: String(form.get("voice") ?? ""),
        avoid: String(form.get("avoid") ?? ""),
        expertise: String(form.get("expertise") ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean),
      },
    });
  });
}

/** Settings > Your voice: name, how you describe your work, voice, things never to write about, what posts include. */
export async function saveYouAction(form: FormData) {
  await guarded("/settings/you", async () => {
    const s = await getSettings();
    const voice = String(form.get("voice") ?? "").trim();
    if (!voice) throw new Error("Pick the post that sounds like you, or describe your voice in your own words.");
    await saveSettings({
      profile: {
        ...s.profile,
        name: String(form.get("name") ?? s.profile.name).trim().slice(0, 80),
        role: String(form.get("role") ?? s.profile.role).trim().slice(0, 100),
        voice: voice.slice(0, 600),
        avoid: String(form.get("avoid") ?? s.profile.avoid).trim().slice(0, 600),
      },
      hashtags: { ...s.hashtags, linkedin: form.get("tags_linkedin") === "on" },
      images: { ...s.images, linkedin: form.get("img_linkedin") === "on" },
      includeLinks: { ...s.includeLinks, linkedin: form.get("link_linkedin") === "on" },
    });
  }, "Saved", "/settings");
}

/** Settings > What to write about: field, topics, readers, place. */
export async function saveTopicsAction(form: FormData) {
  await guarded("/settings/topics", async () => {
    const s = await getSettings();
    const expertise = String(form.get("expertise") ?? "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
    if (!expertise.length) throw new Error("Add at least one topic you know well.");
    await saveSettings({
      profile: {
        ...s.profile,
        field: fieldOf(String(form.get("field") ?? s.profile.field)).id,
        expertise,
        audience: String(form.get("audience") ?? s.profile.audience).trim().slice(0, 160),
        region: String(form.get("region") ?? s.profile.region).trim().slice(0, 60),
        bio: String(form.get("bio") ?? s.profile.bio).trim().slice(0, 400),
      },
    });
  }, "Saved", "/settings");
}

/** Settings > About you > Post style: what goes into every post. */
export async function savePostStyleAction(form: FormData) {
  await guarded("/settings/you", async () => {
    const s = await getSettings();
    await saveSettings({
      hashtags: { ...s.hashtags, linkedin: form.get("tags_linkedin") === "on" },
      images: { ...s.images, linkedin: form.get("img_linkedin") === "on" },
      includeLinks: { ...s.includeLinks, linkedin: form.get("link_linkedin") === "on" },
    });
  });
}

/** Settings > Advanced: content mix, thresholds and what goes into a post. */
export async function saveAdvancedAction(form: FormData) {
  await guarded("/settings/more", async () => {
    const s = await getSettings();
    await saveSettings({
      horizonDays: Number(form.get("horizonDays") || s.horizonDays),
      minRelevance: Number(form.get("minRelevance") || s.minRelevance),
      linkedinMinRelevance: Number(form.get("linkedinMinRelevance") || s.linkedinMinRelevance),
      fillerPosts: form.get("fillerPosts") === "on",
      ownDomains: String(form.get("ownDomains") ?? "").split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean),
      pillars: {
        own_work: Number(form.get("w_own_work") ?? 0),
        news: Number(form.get("w_news") ?? 0),
        local: Number(form.get("w_local") ?? 0),
        learning: Number(form.get("w_learning") ?? 0),
      },
      hashtags: { linkedin: form.get("tags_linkedin") === "on", x: form.get("tags_x") === "on" },
      images: { linkedin: form.get("img_linkedin") === "on", x: form.get("img_x") === "on" },
      // Links on X cost far more per post; only owners can turn them on.
      includeLinks: { linkedin: form.get("link_linkedin") === "on", x: (await requireActiveUser()).isOwner && form.get("link_x") === "on" },
    });
  });
}

export async function saveFastLaneAction(form: FormData) {
  await guarded("/settings/times", async () => {
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
  await guarded("/settings/times", async () => {
    const timezone = String(form.get("timezone") ?? "").trim();
    if (timezone && !DateTime.local().setZone(timezone).isValid) throw new Error(`"${timezone}" is not a timezone PostFlow knows.`);
    await saveSettings({ slots: parseSlots(String(form.get("slots") ?? "")), ...(timezone ? { timezone } : {}) });
  }, "Saved", "/settings");
}
export async function toggleApprovalAction(form?: FormData) {
  await guarded(switchBack(form), async () => {
    const s = await getSettings();
    if (s.requireApproval) await assertFeature("autoMode", "Auto mode");
    await saveSettings({ requireApproval: !s.requireApproval });
  });
}
/** Where an on/off switch returns to: the home list, the Settings list, or Connections. */
const switchBack = (form?: FormData) => (form?.get("back") === "home" ? "/calendar" : form?.get("back") === "list" ? "/settings" : "/settings/accounts");

export async function togglePauseAction(form?: FormData) {
  await guarded(switchBack(form), async () => saveSettings({ paused: !(await getSettings()).paused }), (await getSettings()).paused ? "PostFlow is on again." : "PostFlow is paused.");
}

export async function connectAction(form: FormData) {
  const user = await requireActiveUser();
  const platform = String(form.get("platform"));
  if (platform !== "x" && platform !== "linkedin") return;
  if (platform === "x" && !(await entitlementFor(user.id)).features.x) back("/settings/accounts", "error", X_IS_PRO);
  let url: string;
  try {
    url = await startOAuth(platform);
  } catch (err) {
    back("/settings/accounts", "error", (err as Error).message);
  }
  redirect(url);
}
export async function disconnectAction(form: FormData) {
  const platform = String(form.get("platform"));
  await guarded("/settings/accounts", () => disconnectAccount(platform as "x" | "linkedin"), "Disconnected.");
}
/** Makes a fresh 15-minute link code only when the user asks for it, then opens the bot. */
export async function connectTelegramAction() {
  await requireActiveUser();
  const url = await newTelegramLinkUrl();
  if (!url) back("/settings/accounts", "error", "Telegram is not available yet.");
  redirect(url!);
}
export async function unlinkTelegramAction() {
  await guarded("/settings/accounts", () => unlinkTelegram(), "Telegram disconnected.");
}
/** Runs the pipeline for the signed-in user only. */
export async function runTickAction() {
  await guarded("/settings/accounts", async () => {
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

/** "Find more sources for me": picks, checks and adds sources for the person's field in the background. */
export async function findSourcesAction() {
  const user = await requireActiveUser();
  await guarded("/settings/sources", () => requestSources(user.id, (job) => after(job)), "Looking for journals and news for your field. New sources appear here in a minute or two.");
}

export async function addSourceAction(form: FormData) {
  await guarded("/settings/sources", async () => {
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
  await guarded("/settings/sources", async () => {
    const user = await requireActiveUser();
    const s = await db().query.sources.findFirst({ where: and(eq(schema.sources.id, id), eq(schema.sources.userId, user.id)) });
    if (s && !s.enabled) await assertFeedQuota();
    if (s) await db().update(schema.sources).set({ enabled: !s.enabled }).where(and(eq(schema.sources.id, id), eq(schema.sources.userId, user.id)));
  });
}
export async function deleteSourceAction(form: FormData) {
  await guarded("/settings/sources", async () => {
    const user = await requireActiveUser();
    await db().delete(schema.sources).where(and(eq(schema.sources.id, String(form.get("id"))), eq(schema.sources.userId, user.id)));
  }, "Feed removed.");
}
