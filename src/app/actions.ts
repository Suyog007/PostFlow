"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { requireUser, login, logout } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import {
  DomainError,
  addRevision,
  approveDraft,
  cancelDraft,
  cancelScheduledPost,
  createDraft,
  markNotPublished,
  markPublishedManually,
  rejectDraft,
  reopenDraft,
  reschedulePost,
  retryFailedPost,
  scheduleDraft,
} from "@/server/drafts/service";
import { processScheduledPost } from "@/server/publishing/publisher";
import { platformSlotContext } from "@/server/drafts/service";
import { suggestSlot } from "@/server/scheduling/rules";
import { generateDrafts, makeCarousel, researchItem, researchTopic, reviseDraft } from "@/server/content";
import { enqueueDiscovery } from "@/server/jobs";
import { recordItemFeedback } from "@/server/feedback";
import { createIntake, archiveIntake } from "@/server/intake/service";
import { IntakeError } from "@/server/intake/extract";
import { sizeFor, specFromForm } from "@/server/images/card-form";
import { renderCardPng, cardAlt } from "@/server/images/render";
import { saveMedia } from "@/server/images/store";
import { fetchOgImage } from "@/server/images/og";
import { generateImage } from "@/server/images/generate";
import { recordManualMetrics } from "@/server/metrics";
import { getUserPreferences, preferencesSchema, saveUserPreferences, windowSchema } from "@/server/preferences";
import { disconnectAccount, startOAuth } from "@/server/platforms/accounts";
import { LLMError } from "@/server/llm";
import { log } from "@/server/log";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function guard(fn: (userId: string) => Promise<ActionResult | void>, paths: string[] = ["/"]): Promise<ActionResult> {
  const userId = await requireUser();
  try {
    const r = (await fn(userId)) ?? { ok: true };
    for (const p of paths) revalidatePath(p, "layout");
    return r;
  } catch (err) {
    if (err instanceof DomainError || err instanceof LLMError || err instanceof IntakeError) return { ok: false, error: err.message };
    if (err && typeof err === "object" && "digest" in err) throw err; // next redirect
    log.error("action_failed", { error: (err as Error).message });
    return { ok: false, error: "Something went wrong. Details are in the server log." };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await login(str(fd, "password"));
  if (!r.ok) return { ok: false, error: r.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export async function runDiscoveryAction(): Promise<ActionResult> {
  return guard(async (u) => {
    await enqueueDiscovery(u, "manual");
    return { ok: true, message: "Discovery started. New ideas appear here when it finishes (usually 1–3 minutes)." };
  });
}

export async function itemAction(itemId: string, action: "save" | "dismiss" | "restore"): Promise<ActionResult> {
  return guard(async (u) => {
    const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
    if (!item) throw new DomainError("Not found.");
    const status = action === "save" ? "saved" : action === "dismiss" ? "dismissed" : item.analysis ? "analyzed" : "new";
    await db().update(schema.items).set({ status }).where(eq(schema.items.id, itemId));
    if (action !== "restore") await recordItemFeedback(u, action === "save" ? "saved" : "dismissed", itemId);
    return { ok: true, message: action === "save" ? "Saved for later." : action === "dismiss" ? "Dismissed." : "Restored." };
  });
}

export async function researchAction(itemId: string, refresh = false): Promise<ActionResult> {
  return guard(async (u) => {
    await researchItem(u, itemId, { refresh });
    return { ok: true, message: "Research ready." };
  });
}

export async function researchTopicAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await guard(async (u) => {
    id = await researchTopic(u, str(fd, "topic"));
  });
  if (r.ok && id) redirect(`/discover/${id}`);
  return r;
}

export async function generateAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let firstDraft: string | null = null;
  const r = await guard(async (u) => {
    const platforms = (["linkedin", "x"] as const).filter((p) => fd.get(`platform_${p}`) === "on");
    if (platforms.length === 0) throw new DomainError("Pick at least one platform.");
    const itemId = str(fd, "itemId") || undefined;
    const ideaId = str(fd, "ideaId") || undefined;
    const results = await generateDrafts(u, { itemId, ideaId }, platforms, str(fd, "angle") || undefined);
    firstDraft = results.find((x) => x.draftId)?.draftId ?? null;
    const notes = results.map((x) =>
      x.draftId ? `${label(x.platform)} draft ready.` : x.skipped ? `${label(x.platform)} skipped: ${x.skipped}` : `${label(x.platform)}: ${x.error}`,
    );
    if (!firstDraft) return { ok: false, error: notes.join(" ") };
    return { ok: true, message: notes.join(" ") };
  });
  if (r.ok && firstDraft) redirect(`/drafts/${firstDraft}?notice=${encodeURIComponent(r.message ?? "")}`);
  return r;
}

const label = (p: "x" | "linkedin") => (p === "x" ? "X" : "LinkedIn");

/**
 * One click from the briefing: write drafts for the platforms the item suits (or both),
 * then open them side by side. Re-uses existing open drafts instead of writing new ones.
 */
export async function writePostAction(itemId: string): Promise<ActionResult> {
  let target: string | null = null;
  const r = await guard(async (u) => {
    const existing = await db().query.drafts.findMany({ where: and(eq(schema.drafts.itemId, itemId), eq(schema.drafts.userId, u)) });
    const open = existing.find((d) => !["rejected", "cancelled"].includes(d.status));
    if (open) {
      target = open.id;
      return;
    }
    const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
    if (!item) throw new DomainError("Discovery not found.");
    const suggested = ((item.analysis as { platforms?: ("linkedin" | "x")[] } | null)?.platforms ?? []).filter((p) => p === "linkedin" || p === "x");
    const results = await generateDrafts(u, { itemId }, suggested.length ? suggested : ["linkedin", "x"]);
    target = results.find((x) => x.draftId)?.draftId ?? null;
    if (!target) {
      return { ok: false, error: results.map((x) => `${label(x.platform)}: ${x.skipped ?? x.error}`).join(" ") };
    }
  });
  if (r.ok && target) redirect(`/drafts/${target}`);
  return r;
}

/** Write a version for one more platform from the same source. */
export async function writePlatformAction(ref: { itemId?: string; ideaId?: string }, platform: "linkedin" | "x"): Promise<ActionResult> {
  let target: string | null = null;
  const r = await guard(async (u) => {
    const [res] = await generateDrafts(u, ref, [platform]);
    if (res.draftId) target = res.draftId;
    else return { ok: false, error: res.skipped ? `Skipped: ${res.skipped}` : res.error };
  });
  if (r.ok && target) redirect(`/drafts/${target}`);
  return r;
}

/**
 * "Approve" on the Home queue: approve the current text and, per Settings, either publish now or
 * schedule at the platform's next open slot (computed now, so several approvals spread out).
 */
export async function approveQuickAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, u)) });
    if (!draft?.currentRevisionId) throw new DomainError("Draft not found.");
    await approveDraft(u, draftId, draft.currentRevisionId);
    const name = label(draft.platform);
    if (prefs.approval.mode === "now") {
      const { scheduledPostId } = await scheduleDraft(u, draftId, new Date(), { publishNow: true });
      const outcome = await processScheduledPost(scheduledPostId, new Date(Date.now() + 1000));
      if (outcome === "published") return { ok: true, message: `Posted to ${name}.` };
      const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
      return { ok: false, error: `Approved, but not posted: ${sp?.lastError ?? outcome}` };
    }
    const ctx = await platformSlotContext(db(), u, draft.platform, new Date(), draftId);
    const slot = suggestSlot(ctx, draft.timeliness, draft.freshUntil);
    if (!slot) return { ok: true, message: `Approved. No open ${name} slot in the next 2 weeks; pick a time in the calendar.` };
    await scheduleDraft(u, draftId, slot.at);
    return { ok: true, message: `Approved. Posts to ${name} ${DateTime.fromJSDate(slot.at, { zone: prefs.timezone }).toFormat("ccc d LLL, h:mm a")}.` };
  });
}

/** "Not interested": reject every open draft for this idea and hide it. */
export async function rejectIdeaAction(itemId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const ds = await db().query.drafts.findMany({ where: and(eq(schema.drafts.itemId, itemId), eq(schema.drafts.userId, u)) });
    for (const d of ds) if (["draft", "awaiting_approval", "approved"].includes(d.status)) await rejectDraft(u, d.id);
    await db().update(schema.items).set({ status: "dismissed" }).where(eq(schema.items.id, itemId));
    await recordItemFeedback(u, "dismissed", itemId);
    return { ok: true, message: "Removed." };
  });
}

/**
 * The main review button: saves any edits, approves exactly that text, and schedules it
 * (suggested/picked time), publishes it now, or just approves it.
 */
export async function approveAndScheduleAction(
  draftId: string,
  parts: string[],
  mode: "at" | "now" | "approve_only",
  atLocal?: string,
): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, u)) });
    if (!draft) throw new DomainError("Draft not found.");
    // Save edits first (no-op when unchanged), then approve the exact saved revision.
    const rev = await addRevision(u, draftId, parts, "user", "edited during review");
    await approveDraft(u, draftId, rev.id);
    if (mode === "approve_only") return { ok: true, message: "Approved. It's waiting in your approved queue." };
    if (mode === "now") {
      const { scheduledPostId } = await scheduleDraft(u, draftId, new Date(), { publishNow: true });
      const outcome = await processScheduledPost(scheduledPostId, new Date(Date.now() + 1000));
      if (outcome === "published") return { ok: true, message: "Published." };
      const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
      if (outcome === "not_claimed") return { ok: true, message: "Queued for immediate publishing." };
      return { ok: false, error: `Approved, but not published: ${sp?.lastError ?? sp?.reviewReason ?? outcome}` };
    }
    if (!atLocal) throw new DomainError("Pick a time.");
    const at = parseLocal(atLocal, prefs.timezone);
    try {
      const { warnings } = await scheduleDraft(u, draftId, at);
      const when = DateTime.fromJSDate(at, { zone: prefs.timezone }).toFormat("ccc d LLL, h:mm a");
      return { ok: true, message: `Approved and scheduled for ${when}.${warnings.length ? ` Note: ${warnings.map((w) => w.message).join(" ")}` : ""}` };
    } catch (err) {
      if (err instanceof DomainError) return { ok: false, error: `Approved, but not scheduled: ${err.message}` };
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function newManualDraftAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await guard(async (u) => {
    const platform = z.enum(["linkedin", "x"]).parse(str(fd, "platform"));
    const d = await createDraft({ userId: u, platform, parts: [str(fd, "text")], author: "user", ideaId: str(fd, "ideaId") || null, timeliness: "evergreen" });
    id = d.id;
  });
  if (r.ok && id) redirect(`/drafts/${id}`);
  return r;
}

export async function saveRevisionAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const parts = fd.getAll("part").map(String);
    const draftId = str(fd, "draftId");
    const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, u)) });
    const before = draft?.status;
    await addRevision(u, draftId, parts, "user", "manual edit");
    const wasApproved = before === "approved" || before === "scheduled" || before === "failed";
    return { ok: true, message: wasApproved ? "Saved. The text changed, so it needs approval again (any schedule was cancelled)." : "Saved." };
  });
}

export async function saveRevisionDirectAction(draftId: string, parts: string[]): Promise<ActionResult> {
  return guard(async (u) => {
    await addRevision(u, draftId, parts, "user", "manual edit");
    return { ok: true, message: "Saved. It still needs your approval." };
  });
}

export async function reviseAction(draftId: string, preset: string, custom?: string): Promise<ActionResult> {
  return guard(async (u) => {
    await reviseDraft(u, draftId, preset, custom);
    return { ok: true, message: "New version ready. Review it before approving." };
  });
}

export async function approveAction(draftId: string, revisionId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await approveDraft(u, draftId, revisionId);
    return { ok: true, message: "Approved. Choose when to publish it." };
  });
}

export async function rejectAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await rejectDraft(u, draftId);
    return { ok: true, message: "Rejected." };
  });
}

export async function reopenAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await reopenDraft(u, draftId);
    return { ok: true, message: "Back in your approval queue." };
  });
}

export async function cancelDraftAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await cancelDraft(u, draftId);
    return { ok: true, message: "Cancelled." };
  });
}

function parseLocal(value: string, tz: string) {
  const dt = DateTime.fromISO(value, { zone: tz });
  if (!dt.isValid) throw new DomainError("Pick a valid date and time.");
  return dt.toJSDate();
}

export async function scheduleAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    const draftId = str(fd, "draftId");
    const mode = str(fd, "mode");
    if (mode === "now") {
      const { scheduledPostId } = await scheduleDraft(u, draftId, new Date(), { publishNow: true });
      const outcome = await processScheduledPost(scheduledPostId, new Date(Date.now() + 1000));
      const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
      if (outcome === "published") return { ok: true, message: "Published." };
      if (outcome === "not_claimed") return { ok: true, message: "Queued for immediate publishing by the worker." };
      return { ok: false, error: sp?.lastError ?? sp?.reviewReason ?? `Not published (${outcome}).` };
    }
    const at = parseLocal(str(fd, "at"), prefs.timezone);
    const { warnings } = await scheduleDraft(u, draftId, at);
    const when = DateTime.fromJSDate(at, { zone: prefs.timezone }).toFormat("ccc d LLL, h:mm a");
    return { ok: true, message: `Scheduled for ${when}.${warnings.length ? ` Note: ${warnings.map((w) => w.message).join(" ")}` : ""}` };
  });
}

export async function rescheduleAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    const at = parseLocal(str(fd, "at"), prefs.timezone);
    const { warnings } = await reschedulePost(u, str(fd, "scheduledPostId"), at);
    return { ok: true, message: `Rescheduled.${warnings.length ? ` Note: ${warnings.map((w) => w.message).join(" ")}` : ""}` };
  });
}

export async function cancelScheduleAction(scheduledPostId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await cancelScheduledPost(u, scheduledPostId);
    return { ok: true, message: "Schedule cancelled. The post is still approved." };
  });
}

export async function retryAction(scheduledPostId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await retryFailedPost(u, scheduledPostId, new Date());
    const outcome = await processScheduledPost(scheduledPostId, new Date(Date.now() + 1000));
    if (outcome === "published") return { ok: true, message: "Published." };
    const sp = await db().query.scheduledPosts.findFirst({ where: eq(schema.scheduledPosts.id, scheduledPostId) });
    return { ok: outcome !== "failed", error: outcome === "failed" ? sp?.lastError ?? "Failed again." : undefined, message: outcome !== "failed" ? `Status: ${outcome.replace(/_/g, " ")}` : undefined };
  });
}

export async function confirmPublishedAction(scheduledPostId: string, url?: string): Promise<ActionResult> {
  return guard(async (u) => {
    await markPublishedManually(u, scheduledPostId, url || undefined);
    return { ok: true, message: "Marked as published." };
  });
}

export async function confirmNotPublishedAction(scheduledPostId: string): Promise<ActionResult> {
  return guard(async (u) => {
    await markNotPublished(u, scheduledPostId);
    return { ok: true, message: "Marked as not published. You can retry safely." };
  });
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

export async function saveIdeaAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const id = str(fd, "id");
    const values = {
      title: str(fd, "title"),
      notes: str(fd, "notes"),
      links: str(fd, "links").split(/\s+/).filter((l) => /^https?:\/\//.test(l)).slice(0, 10),
      tags: str(fd, "tags").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10),
      updatedAt: new Date(),
    };
    if (!values.title) throw new DomainError("Give the idea a title.");
    if (id) await db().update(schema.ideas).set(values).where(and(eq(schema.ideas.id, id), eq(schema.ideas.userId, u)));
    else await db().insert(schema.ideas).values({ userId: u, ...values });
    return { ok: true, message: "Idea saved." };
  });
}

export async function ideaFromItemAction(itemId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
    if (!item) throw new DomainError("Not found.");
    const a = item.analysis as { headline?: string; whyItMatters?: string; opportunity?: string | null } | null;
    const src = await db().query.itemSources.findFirst({ where: eq(schema.itemSources.itemId, itemId) });
    await db().insert(schema.ideas).values({
      userId: u,
      itemId,
      title: a?.headline ?? item.title,
      notes: [a?.whyItMatters, a?.opportunity ? `Possible opportunity: ${a.opportunity}` : ""].filter(Boolean).join("\n\n"),
      links: src ? [src.url] : [],
      tags: item.category ? [item.category] : [],
    });
    await db().update(schema.items).set({ status: "saved" }).where(eq(schema.items.id, itemId));
    await recordItemFeedback(u, "saved", itemId);
    return { ok: true, message: "Added to your idea library." };
  });
}

export async function ideaStatusAction(ideaId: string, status: "active" | "used" | "archived"): Promise<ActionResult> {
  return guard(async (u) => {
    await db().update(schema.ideas).set({ status, updatedAt: new Date() }).where(and(eq(schema.ideas.id, ideaId), eq(schema.ideas.userId, u)));
  });
}

// ---------------------------------------------------------------------------
// Intake (articles the user found or wrote)
// ---------------------------------------------------------------------------

export async function createIntakeAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const r = await guard(
    async (u) => {
      const input = str(fd, "input");
      if (!input) throw new DomainError("Paste a URL or some text first.");
      const out = await createIntake(u, input);
      id = out.id;
      return { ok: true, message: `Extracted ${out.atoms.length} atoms.` };
    },
    ["/intake"],
  );
  if (r.ok && id) redirect(`/intake/${id}`);
  return r;
}

export async function archiveIntakeAction(intakeId: string): Promise<ActionResult> {
  return guard(
    async (u) => {
      await archiveIntake(u, intakeId);
      return { ok: true, message: "Archived." };
    },
    ["/intake"],
  );
}

export async function draftFromAtomsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let first: string | null = null;
  const r = await guard(async (u) => {
    const intakeId = str(fd, "intakeId");
    const atomIds = fd.getAll("atom").map(String);
    const platforms = (["linkedin", "x"] as const).filter((p) => fd.get(`platform_${p}`) === "on");
    if (platforms.length === 0) throw new DomainError("Pick at least one platform.");
    const results = await generateDrafts(u, { intakeId, atomIds }, platforms, str(fd, "angle") || undefined);
    first = results.find((x) => x.draftId)?.draftId ?? null;
    const notes = results.map((x) =>
      x.draftId ? `${label(x.platform)} draft ready.` : x.skipped ? `${label(x.platform)} skipped: ${x.skipped}` : `${label(x.platform)}: ${x.error}`,
    );
    if (!first) return { ok: false, error: notes.join(" ") };
    return { ok: true, message: notes.join(" ") };
  });
  if (r.ok && first) redirect(`/drafts/${first}`);
  return r;
}

// ---------------------------------------------------------------------------
// Images, cards, carousel
// ---------------------------------------------------------------------------

async function currentRevisionOf(userId: string, draftId: string) {
  const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)) });
  if (!draft?.currentRevisionId) throw new DomainError("Draft not found.");
  const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, draft.currentRevisionId) });
  if (!rev) throw new DomainError("Draft revision not found.");
  return { draft, rev };
}

/** Renders a stat/quote/list/headline card and binds it to a new revision. */
export async function attachCardAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const draftId = str(fd, "draftId");
    const { rev } = await currentRevisionOf(u, draftId);
    const spec = specFromForm(fd);
    const size = sizeFor(str(fd, "size"));
    const png = await renderCardPng(spec, size);
    const row = await saveMedia({
      userId: u,
      kind: "card",
      data: png.data,
      mime: "image/png",
      width: png.width,
      height: png.height,
      alt: str(fd, "alt") || cardAlt(spec),
      meta: { template: spec.template, spec },
    });
    await addRevision(u, draftId, rev.parts, "user", "attached image card", undefined, {
      media: [{ mediaId: row.id, role: "image", alt: row.alt }],
    });
    return { ok: true, message: "Image attached to a new revision. Review it, then approve." };
  });
}

/** Pulls the source page's OG preview image (opt-in fallback for link posts). */
export async function attachOgImageAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const { draft, rev } = await currentRevisionOf(u, draftId);
    let url: string | null = null;
    if (draft.intakeId) {
      const intake = await db().query.intakes.findFirst({ where: eq(schema.intakes.id, draft.intakeId) });
      url = intake?.url ?? null;
    }
    if (!url && draft.itemId) {
      const src = await db().query.itemSources.findFirst({ where: eq(schema.itemSources.itemId, draft.itemId) });
      url = src?.url ?? null;
    }
    if (!url) throw new DomainError("This draft has no source page to pull an image from. Use a card instead.");
    let og;
    try {
      og = await fetchOgImage(url);
    } catch (err) {
      throw new DomainError((err as Error).message);
    }
    const row = await saveMedia({
      userId: u,
      kind: "og",
      data: og.data,
      mime: og.mime,
      width: og.width,
      height: og.height,
      alt: strLike(og.alt) || `${og.site} preview image`,
      meta: { sourceUrl: og.sourceUrl, site: og.site },
    });
    await addRevision(u, draftId, rev.parts, "user", `attached source image (${og.site})`, undefined, {
      media: [{ mediaId: row.id, role: "image", alt: row.alt }],
    });
    const credited = rev.parts.join(" ").toLowerCase().includes(og.site.toLowerCase());
    return {
      ok: true,
      message: credited
        ? "Source image attached to a new revision."
        : `Source image attached. Consider naming ${og.site} in the text — reuse of others' images is only clearly safe with credit + a link back.`,
    };
  });
}

const strLike = (s: string | undefined | null) => (s ?? "").trim();

/** Removes images from the current revision (creates a new revision without media). */
export async function detachMediaAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const { rev } = await currentRevisionOf(u, draftId);
    if (!rev.media.length) return { ok: true, message: "No image attached." };
    await addRevision(u, draftId, rev.parts, "user", "removed image", undefined, { media: [] });
    return { ok: true, message: "Image removed from a new revision." };
  });
}

/** Optional paid generation (decorative only; disabled until a provider key is set). */
export async function generateImageAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const draftId = str(fd, "draftId");
    const prompt = str(fd, "prompt");
    const { rev } = await currentRevisionOf(u, draftId);
    let img;
    try {
      img = await generateImage(prompt);
    } catch (err) {
      throw new DomainError((err as Error).message);
    }
    const row = await saveMedia({
      userId: u,
      kind: "generated",
      data: img.data,
      mime: img.mime,
      width: img.width,
      height: img.height,
      alt: `${prompt.slice(0, 220)} (AI-generated image)`,
      meta: { provider: img.provider, prompt },
    });
    await addRevision(u, draftId, rev.parts, "user", "attached generated image", undefined, {
      media: [{ mediaId: row.id, role: "image", alt: row.alt }],
    });
    return { ok: true, message: "AI image attached. Disclose it in the post (e.g. \"AI-generated illustration\") — readers punish silent synthetic art." };
  });
}

/** LinkedIn carousel: script + slides bound to a new revision. */
export async function makeCarouselAction(draftId: string): Promise<ActionResult> {
  return guard(async (u) => {
    const rev = await makeCarousel(u, draftId);
    return { ok: true, message: `Carousel ready (${rev.media.length} slides). Review the caption, then approve.` };
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function recordMetricsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const scheduledPostId = str(fd, "scheduledPostId");
    const num = (k: string) => {
      const v = str(fd, k);
      if (!v) return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
    };
    await recordManualMetrics(u, scheduledPostId, { impressions: num("impressions"), likes: num("likes"), reposts: num("reposts"), replies: num("replies") });
    return { ok: true, message: "Metrics saved." };
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function savePlatformRulesAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const platform = z.enum(["linkedin", "x"]).parse(str(fd, "platform"));
    const prefs = await getUserPreferences(u);
    const windows = z.array(windowSchema).min(1, "Add at least one posting window.").parse(JSON.parse(str(fd, "windows") || "[]"));
    const next = {
      ...prefs,
      platforms: {
        ...prefs.platforms,
        [platform]: {
          ...prefs.platforms[platform],
          maxPerDay: Number(str(fd, "maxPerDay")),
          maxPerWeek: Number(str(fd, "maxPerWeek")),
          minIntervalMinutes: Math.round(Number(str(fd, "minIntervalHours")) * 60),
          allowEvergreenFill: fd.get("allowEvergreenFill") === "on",
          prioritizeTimely: fd.get("prioritizeTimely") === "on",
          linkInReply: fd.get("linkInReply") === "on",
          styleNotes: str(fd, "styleNotes"),
          windows,
        },
      },
    };
    const parsed = preferencesSchema.safeParse(next);
    if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => `${String(i.path.slice(-1)[0])}: ${i.message}`).join("; "));
    await saveUserPreferences(u, parsed.data);
    return { ok: true, message: `${label(platform)} rules saved.` };
  }, ["/settings", "/calendar"]);
}

export async function setPausedAction(platform: "linkedin" | "x", paused: boolean): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    prefs.platforms[platform].paused = paused;
    await saveUserPreferences(u, prefs);
    return { ok: true, message: `${label(platform)} publishing ${paused ? "paused" : "resumed"}.` };
  });
}

export async function saveGeneralAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async (u) => {
    const prefs = await getUserPreferences(u);
    const interests: Record<string, number> = {};
    for (const line of str(fd, "interests").split("\n")) {
      const m = line.match(/^(.*?)[\s:=]+([01](?:\.\d+)?)\s*$/);
      const name = (m ? m[1] : line).trim();
      if (name) interests[name] = m ? Math.min(1, Math.max(0, Number(m[2]))) : 0.5;
    }
    const next = {
      ...prefs,
      timezone: str(fd, "timezone") || prefs.timezone,
      aboutMe: str(fd, "aboutMe"),
      voiceRules: str(fd, "voiceRules"),
      voiceExemplars: fd.get("voiceExemplars") === "on",
      learnFromFeedback: fd.get("learnFromFeedback") === "on",
      interests,
      mutedTerms: str(fd, "mutedTerms").split(",").map((t) => t.trim()).filter(Boolean),
      weights: {
        relevance: Number(str(fd, "w_relevance")),
        recency: Number(str(fd, "w_recency")),
        evidence: Number(str(fd, "w_evidence")),
        insight: Number(str(fd, "w_insight")),
        audience: Number(str(fd, "w_audience")),
      },
      briefing: {
        ...prefs.briefing,
        maxItems: Number(str(fd, "maxItems")),
        minScore: Number(str(fd, "minScore")),
        staleNewsDays: Number(str(fd, "staleNewsDays")),
      },
      llm: {
        ...prefs.llm,
        enabled: fd.get("llmEnabled") === "on",
        dailyBudgetUsd: Number(str(fd, "dailyBudgetUsd")),
        dailyTokenLimit: Number(str(fd, "dailyTokenLimit")),
        maxItemsAnalyzedPerRun: Number(str(fd, "maxItemsAnalyzedPerRun")),
      },
      discovery: { autoRunTimes: str(fd, "autoRunTimes").split(",").map((t) => t.trim()).filter(Boolean) },
      autoDraft: { enabled: fd.get("autoDraftEnabled") === "on", perRun: Number(str(fd, "autoDraftPerRun") || 0) },
      images: { autoCard: fd.get("autoCardEnabled") === "on" },
      approval: { mode: str(fd, "approvalMode") === "now" ? ("now" as const) : ("next_slot" as const) },
    };
    if (!DateTime.local().setZone(next.timezone).isValid) throw new DomainError("Unknown timezone. Use an IANA name like Asia/Kathmandu.");
    const parsed = preferencesSchema.safeParse(next);
    if (!parsed.success) throw new DomainError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    await saveUserPreferences(u, parsed.data);
    return { ok: true, message: "Preferences saved." };
  });
}

export async function addSourceAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const kind = z.enum(["rss", "github_search"]).parse(str(fd, "kind"));
    const name = str(fd, "name");
    const value = str(fd, "url");
    if (!name || !value) throw new DomainError("Name and URL/query are required.");
    if (kind === "rss" && !/^https:\/\//.test(value)) throw new DomainError("Feed URLs must start with https://");
    await db()
      .insert(schema.sources)
      .values({
        name,
        kind,
        url: kind === "rss" ? value : `https://api.github.com/search/repositories#${encodeURIComponent(value)}`,
        topicHint: str(fd, "topicHint") || null,
        isPrimary: fd.get("isPrimary") === "on",
        pollIntervalMinutes: Number(str(fd, "poll") || 180),
        config: kind === "github_search" ? { query: value, perPage: 20 } : {},
      })
      .onConflictDoNothing();
    return { ok: true, message: "Source added. It will be polled on the next discovery run." };
  }, ["/settings"]);
}

export async function toggleSourceAction(id: string, enabled: boolean): Promise<ActionResult> {
  return guard(async () => {
    await db().update(schema.sources).set({ enabled }).where(eq(schema.sources.id, id));
  }, ["/settings"]);
}

export async function deleteSourceAction(id: string): Promise<ActionResult> {
  return guard(async () => {
    await db().delete(schema.sources).where(eq(schema.sources.id, id));
  }, ["/settings"]);
}

export async function connectAction(platform: "linkedin" | "x") {
  const u = await requireUser();
  let url: string;
  try {
    url = await startOAuth(u, platform);
  } catch (err) {
    redirect(`/settings?error=${encodeURIComponent((err as Error).message)}`);
  }
  redirect(url);
}

export async function disconnectAction(platform: "linkedin" | "x"): Promise<ActionResult> {
  return guard(async (u) => {
    await disconnectAccount(u, platform);
    return { ok: true, message: "Disconnected. Stored tokens were deleted." };
  }, ["/settings"]);
}
