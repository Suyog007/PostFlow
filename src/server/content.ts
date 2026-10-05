import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "./db/client";
import { runTask, untrusted, LLMError } from "./llm";
import {
  PRESET_FORMAT,
  PROMPT_VERSIONS,
  REVISION_PRESETS,
  carouselScriptSchema,
  carouselSystem,
  draftOutputSchema,
  draftSystem,
  researchSchema,
  researchSystem,
  type Research,
} from "./llm/prompts";
import { getUserPreferences } from "./preferences";
import { fetchArticleText, isPublicHttpUrl } from "./discovery/collect";
import { canonicalUrl, hostOf, normalizeTitle, titleSimilarity, titleTokens, urlHash } from "./discovery/normalize";
import { createDraft, addRevision, DomainError } from "./drafts/service";
import { firstPersonActionClaim, postLength, validateParts } from "./drafts/state";
import { freshnessHorizon } from "./scheduling/rules";
import { recordItemFeedback } from "./feedback";
import { voiceContext } from "./voice";
import { renderCarousel } from "./images/carousel";
import { renderCardPng, cardAlt, SIZE_LI, SIZE_X } from "./images/render";
import { cardSpecFromSuggestion, type CardSuggestion } from "./images/card-form";
import { saveMedia } from "./images/store";
import type { MediaRef } from "./db/schema";
import { sha256 } from "./crypto";
import { env } from "./env";

type Platform = "linkedin" | "x";

// ---------------------------------------------------------------------------
// Research deeper
// ---------------------------------------------------------------------------

export async function researchItem(userId: string, itemId: string, opts: { refresh?: boolean } = {}): Promise<Research> {
  const prefs = await getUserPreferences(userId);
  const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
  if (!item) throw new DomainError("Discovery not found.");
  if (item.research && !opts.refresh) return item.research as Research;

  const srcs = await db().query.itemSources.findMany({ where: eq(schema.itemSources.itemId, itemId), limit: 6 });
  // Read the original pages (bounded) so the summary is based on more than a feed snippet.
  const texts = await Promise.all(srcs.slice(0, 4).map((s) => fetchArticleText(s.url, 6000)));

  // Earlier coverage in our own library, to answer "what is new".
  const earlier = (
    await db().query.items.findMany({
      where: and(ne(schema.items.id, itemId), gte(schema.items.firstSeenAt, new Date(Date.now() - 45 * 86_400_000)), inArray(schema.items.status, ["analyzed", "saved"])),
      columns: { title: true, publishedAt: true, analysis: true },
      orderBy: desc(schema.items.firstSeenAt),
      limit: 400,
    })
  )
    .filter((e) => titleSimilarity(e.title, item.title) >= 0.25)
    .slice(0, 5);

  const blocks = srcs.map((s, i) =>
    [
      `ref: s${i}`,
      `publisher: ${s.publisher ?? hostOf(s.url)}${s.isPrimary ? " (primary/official source)" : ""}`,
      `url: ${s.url}`,
      `published: ${s.publishedAt?.toISOString().slice(0, 10) ?? "unknown"}`,
      untrusted(s.publisher ?? hostOf(s.url), `${s.title}\n${texts[i] ?? s.excerpt ?? ""}`, 6000),
    ].join("\n"),
  );
  const analysis = item.analysis as { summary?: string } | null;
  const repo = (item.meta as { repo?: unknown }).repo;
  const user = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Development: ${item.title}`,
    analysis?.summary ? `Earlier triage summary: ${analysis.summary}` : "",
    repo ? `Repository stats measured via the GitHub API: ${JSON.stringify(repo)}` : "",
    earlier.length
      ? `Related items seen earlier (for "what is new"):\n${earlier.map((e) => `- ${e.publishedAt?.toISOString().slice(0, 10) ?? "?"}: ${e.title}`).join("\n")}`
      : "No related earlier items in the library.",
    "Sources:",
    blocks.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const research = await runTask({
    task: "research_item",
    promptVersion: PROMPT_VERSIONS.research,
    tier: "research",
    system: researchSystem(JSON.stringify(prefs.interests), prefs.aboutMe),
    user,
    output: researchSchema,
    maxTokens: 6000,
    temperature: 0.3,
    budget: prefs.llm,
    useCache: !opts.refresh,
  });

  await db().transaction(async (tx) => {
    await tx
      .update(schema.items)
      .set({ research, researchedAt: new Date(), timeliness: research.timeliness, status: item.status === "new" ? "analyzed" : item.status })
      .where(eq(schema.items.id, itemId));
    await tx.delete(schema.claims).where(eq(schema.claims.itemId, itemId));
    for (const f of research.keyFacts) {
      const refs = f.sourceRefs.map((r) => srcs[Number(r.replace(/\D/g, ""))]).filter(Boolean);
      const verification = refs.some((s) => s.isPrimary) ? "primary_source" : refs.length >= 2 ? "multi_source" : refs.length === 1 ? "single_source" : "unverified";
      const [c] = await tx.insert(schema.claims).values({ itemId, text: f.text, kind: "fact", verification }).returning();
      for (const s of refs) await tx.insert(schema.claimEvidence).values({ claimId: c.id, itemSourceId: s.id, url: s.url });
    }
    for (const t of research.implications) await tx.insert(schema.claims).values({ itemId, text: t, kind: "interpretation", verification: "unverified" });
    for (const o of research.opportunities) await tx.insert(schema.claims).values({ itemId, text: o.idea, kind: "speculation", verification: "unverified" });
  });
  await recordItemFeedback(userId, "researched", itemId);
  return research;
}

/**
 * "Research a topic": gather material from permitted public APIs (HN Algolia search, GitHub search)
 * plus the local library, store it as a topic item, then run the normal research step.
 */
export async function researchTopic(userId: string, topic: string) {
  const q = topic.trim().slice(0, 120);
  if (q.length < 3) throw new DomainError("Describe the topic in a few words.");
  const found: { url: string; title: string; excerpt: string; publisher: string; publishedAt: Date | null; isPrimary: boolean }[] = [];

  const local = await db().query.items.findMany({
    where: gte(schema.items.firstSeenAt, new Date(Date.now() - 30 * 86_400_000)),
    columns: { canonicalUrl: true, title: true, excerpt: true, publishedAt: true, kind: true },
    orderBy: desc(schema.items.firstSeenAt),
    limit: 1500,
  });
  const qt = titleTokens(q);
  for (const it of local) {
    if (it.kind === "topic") continue;
    const tt = titleTokens(`${it.title} ${it.excerpt ?? ""}`);
    let hits = 0;
    for (const t of qt) if (tt.has(t)) hits++;
    if (qt.size && hits / qt.size >= 0.6) found.push({ url: it.canonicalUrl, title: it.title, excerpt: it.excerpt ?? "", publisher: hostOf(it.canonicalUrl), publishedAt: it.publishedAt, isPrimary: false });
    if (found.length >= 4) break;
  }

  try {
    const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=6`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { hits: { title: string; url: string | null; objectID: string; points: number; created_at: string }[] };
      for (const h of json.hits) {
        const url = h.url && isPublicHttpUrl(h.url) ? h.url : `https://news.ycombinator.com/item?id=${h.objectID}`;
        found.push({ url, title: h.title, excerpt: `Discussed on Hacker News (${h.points} points).`, publisher: hostOf(url), publishedAt: new Date(h.created_at), isPrimary: false });
      }
    }
  } catch {}

  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "PostFlow/0.1" };
    if (env().GITHUB_TOKEN) headers.Authorization = `Bearer ${env().GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} pushed:>${new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)}`)}&sort=stars&per_page=3`, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { items: { html_url: string; full_name: string; description: string | null; stargazers_count: number; created_at: string }[] };
      for (const r of json.items) {
        found.push({ url: r.html_url, title: `${r.full_name}: ${r.description ?? ""}`, excerpt: `${r.stargazers_count} stars. Created ${r.created_at.slice(0, 10)}.`, publisher: "GitHub", publishedAt: new Date(r.created_at), isPrimary: true });
      }
    }
  } catch {}

  if (found.length === 0) throw new DomainError("No recent material found for that topic. Try different words or save it as an idea.");

  const now = new Date();
  const slug = normalizeTitle(q).replace(/\s+/g, "-");
  const [item] = await db()
    .insert(schema.items)
    .values({
      kind: "topic",
      title: q,
      normalizedTitle: normalizeTitle(q),
      canonicalUrl: `topic:${slug}:${now.getTime()}`,
      excerpt: `Topic research across ${found.length} sources.`,
      contentHash: sha256(`topic:${q}:${now.getTime()}`),
      publishedAt: now,
      status: "analyzed",
      category: "Topic research",
      timeliness: "evergreen",
      meta: { topic: true },
    })
    .returning();
  const seen = new Set<string>();
  for (const f of found) {
    // Topic items reference sources by their own hash namespace so they never collide with discoveries.
    const h = sha256(`${item.id}:${urlHash(f.url)}`);
    if (seen.has(h)) continue;
    seen.add(h);
    await db().insert(schema.itemSources).values({ itemId: item.id, url: canonicalUrl(f.url), urlHash: h, title: f.title, publisher: f.publisher, excerpt: f.excerpt, publishedAt: f.publishedAt, isPrimary: f.isPrimary });
  }
  await researchItem(userId, item.id, { refresh: true });
  return item.id;
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

interface Material {
  title: string;
  text: string;
  sourceUrl: string | null;
  timeliness: "breaking" | "timely" | "evergreen";
  publishedAt: Date | null;
  itemId: string | null;
  ideaId: string | null;
  intakeId: string | null;
}

async function materialFor(
  userId: string,
  ref: { itemId?: string; ideaId?: string; intakeId?: string; atomIds?: string[] },
): Promise<Material> {
  if (ref.intakeId) {
    const intake = await db().query.intakes.findFirst({ where: and(eq(schema.intakes.id, ref.intakeId), eq(schema.intakes.userId, userId)) });
    if (!intake) throw new DomainError("Intake not found.");
    const wanted = ref.atomIds && ref.atomIds.length ? intake.atoms.filter((a) => ref.atomIds!.includes(a.id)) : intake.atoms;
    const atoms = wanted.length ? wanted : intake.atoms;
    const group = (kind: string) => atoms.filter((a) => a.kind === kind).map((a) => `- ${a.text}${a.note ? ` (note: ${a.note})` : ""}`);
    const text = [
      `Intake: ${intake.title}`,
      intake.summary ? `Summary: ${intake.summary}` : "",
      intake.kind === "url"
        ? `This is an article the author found${intake.siteName ? ` on ${intake.siteName}` : ""}${intake.byline ? `, written by ${intake.byline}` : ""}. Attribute claims to it; never claim the author's own experience.`
        : "Pasted by the author themselves. It may be their own writing or an article they typed in; attribute correctly either way.",
      group("stat").length ? `Numbers/stats:\n${group("stat").join("\n")}` : "",
      group("quote").length ? `Quotable verbatim lines (quote exactly, attribute):\n${group("quote").join("\n")}` : "",
      group("insight").length ? `Insights:\n${group("insight").join("\n")}` : "",
      group("contrarian").length ? `Contrarian claims:\n${group("contrarian").join("\n")}` : "",
      group("takeaway").length ? `Takeaways:\n${group("takeaway").join("\n")}` : "",
      group("question").length ? `Open questions:\n${group("question").join("\n")}` : "",
      intake.url ? `Source URL (may be linked): ${intake.url}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      title: intake.title,
      text,
      sourceUrl: intake.url,
      timeliness: "evergreen",
      publishedAt: null,
      itemId: null,
      ideaId: null,
      intakeId: intake.id,
    };
  }
  if (ref.itemId) {
    const item = await db().query.items.findFirst({ where: eq(schema.items.id, ref.itemId) });
    if (!item) throw new DomainError("Discovery not found.");
    const srcs = await db().query.itemSources.findMany({ where: eq(schema.itemSources.itemId, item.id), limit: 5 });
    const a = item.analysis as Record<string, unknown> | null;
    const r = item.research as Research | null;
    const primary = srcs.find((s) => s.isPrimary) ?? srcs[0];
    const text = [
      `Development: ${(a?.headline as string) ?? item.title}`,
      r ? `Research summary: ${r.summary}` : a ? `Summary: ${a.summary}` : untrusted("feed", item.excerpt ?? "", 1500),
      r ? `Key facts (sourced):\n${r.keyFacts.map((f) => `- ${f.text}`).join("\n")}` : Array.isArray(a?.facts) && a.facts.length ? `Facts:\n${(a.facts as string[]).map((f) => `- ${f}`).join("\n")}` : "",
      r ? `What is new: ${r.whatIsNew}` : "",
      r ? `Counterpoints:\n${r.counterpoints.map((c) => `- ${c}`).join("\n")}` : a?.uncertainty ? `Uncertainty: ${a.uncertainty}` : "",
      r ? `Implications:\n${r.implications.map((c) => `- ${c}`).join("\n")}` : a ? `Why it matters: ${a.whyItMatters}` : "",
      r?.opportunities.length ? `Opportunity hypotheses (unproven):\n${r.opportunities.map((o) => `- ${o.idea} (uncertain: ${o.uncertainty})`).join("\n")}` : a?.opportunity ? `Possible opportunity (speculative): ${a.opportunity}` : "",
      `Sources: ${srcs.map((s) => `${s.publisher ?? hostOf(s.url)} ${s.url}`).join("; ")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      title: (a?.headline as string) ?? item.title,
      text,
      sourceUrl: primary?.url ?? null,
      timeliness: item.timeliness ?? "timely",
      publishedAt: item.publishedAt,
      itemId: item.id,
      ideaId: null,
      intakeId: null,
    };
  }
  const idea = await db().query.ideas.findFirst({ where: and(eq(schema.ideas.id, ref.ideaId!), eq(schema.ideas.userId, userId)) });
  if (!idea) throw new DomainError("Idea not found.");
  return {
    title: idea.title,
    text: [`Idea: ${idea.title}`, idea.notes ? `The author's own notes (may include their genuine experiences): ${idea.notes}` : "", idea.links.length ? `Links: ${idea.links.join(" ")}` : "", idea.tags.length ? `Tags: ${idea.tags.join(", ")}` : ""]
      .filter(Boolean)
      .join("\n\n"),
    sourceUrl: idea.links[0] ?? null,
    timeliness: "evergreen",
    publishedAt: null,
    itemId: null,
    ideaId: idea.id,
    intakeId: null,
  };
}


/**
 * Models are bad at counting characters. If a draft breaks the platform limit, ask once for a
 * version that fits (shorter, or split into a thread on X). Deterministic check, one retry.
 */
async function fitToLimits(
  platform: Platform,
  parts: string[],
  ctx: { system: string; material: string; budget: Parameters<typeof runTask>[0]["budget"] },
): Promise<string[]> {
  const tooLong = validateParts(platform, parts).some((e) => e.includes("limit"));
  if (!tooLong) return parts;
  const counts = parts.map((p) => postLength(platform, p)).join(", ");
  const out = await runTask({
    task: `fit_${platform}`,
    promptVersion: PROMPT_VERSIONS.revise,
    tier: "routine",
    system: ctx.system,
    user: [
      platform === "x"
        ? `These X posts are too long (lengths: ${counts}; limit 280, URLs count as 23). Rewrite so EVERY post is under 250 characters. Keep the same point and voice. You may split into a short thread (max 5 posts) if needed.`
        : `This LinkedIn post is too long (${counts} characters; limit 3000). Rewrite it under 2,500 characters, keeping the key points.`,
      `Current:\n${parts.map((p, i) => (parts.length > 1 ? `[${i + 1}] ${p}` : p)).join("\n\n")}`,
      `Material (for accuracy):\n${ctx.material}`,
      "Set skip=false.",
    ].join("\n\n"),
    output: draftOutputSchema,
    maxTokens: 3000,
    temperature: 0.4,
    budget: ctx.budget,
    useCache: false,
  });
  const fixed = platform === "linkedin" ? [out.parts.join("\n\n")] : out.parts.filter((p) => p.trim());
  return fixed.length ? fixed : parts;
}

/**
 * Personal-experience guard: models sometimes absorb the subject's actions ("In my repo…").
 * Runs one rewrite pass when a first-person action claim is detected (or the model flagged itself).
 * If the material genuinely shows the author did it, the model keeps it.
 */
async function fixAttribution(
  platform: Platform,
  parts: string[],
  force: boolean,
  ctx: { system: string; material: string; budget: Parameters<typeof runTask>[0]["budget"] },
): Promise<{ parts: string[]; rewritten: boolean }> {
  const hit = parts.map(firstPersonActionClaim).find(Boolean);
  if (!hit && !force) return { parts, rewritten: false };
  try {
    const out = await runTask({
      task: `fix_attribution_${platform}`,
      promptVersion: PROMPT_VERSIONS.draft,
      tier: "research",
      system: ctx.system,
      user: [
        `This ${platform === "x" ? "X" : "LinkedIn"} draft claims a first-person action${hit ? ` ("${hit}")` : ""} that may not belong to the author.`,
        "Rewrite the draft so actions are attributed to their real owner (name the person or organisation). If the material explicitly shows the author did it themselves, keep it; otherwise remove the claim entirely. Do not add new facts or experiences, do not change the angle.",
        `Current:\n${parts.map((p, i) => (parts.length > 1 ? `[${i + 1}] ${p}` : p)).join("\n\n")}`,
        `Material (for accuracy):\n${ctx.material}`,
        "Set skip=false.",
      ].join("\n\n"),
      output: draftOutputSchema,
      maxTokens: 3000,
      temperature: 0.4,
      budget: ctx.budget,
      useCache: false,
    });
    const fixed = platform === "linkedin" ? [out.parts.join("\n\n")] : out.parts.filter((p) => p.trim());
    if (!fixed.length) return { parts, rewritten: false };
    return { parts: fixed, rewritten: true };
  } catch {
    // Best-effort: never block a draft because the guard pass failed.
    return { parts, rewritten: false };
  }
}

export interface GenerateResult {
  platform: Platform;
  draftId?: string;
  skipped?: string;
  error?: string;
}

/**
 * If the drafting model suggested a companion card (a strong number, quote, list or headline),
 * render it and bind it to the new draft. Best-effort: a failure just means no image.
 */
async function autoCardMedia(userId: string, platform: Platform, suggestion: CardSuggestion | null | undefined): Promise<MediaRef[]> {
  if (!suggestion) return [];
  const spec = cardSpecFromSuggestion(suggestion);
  if (!spec) return [];
  const png = await renderCardPng(spec, platform === "linkedin" ? SIZE_LI : SIZE_X);
  const row = await saveMedia({
    userId,
    kind: "card",
    data: png.data,
    mime: "image/png",
    width: png.width,
    height: png.height,
    alt: cardAlt(spec),
    meta: { template: spec.template, spec, auto: true },
  });
  return [{ mediaId: row.id, role: "image", alt: row.alt }];
}
/** Generate LinkedIn and X drafts independently. A platform can decline the material. */
export async function generateDrafts(
  userId: string,
  ref: { itemId?: string; ideaId?: string; intakeId?: string; atomIds?: string[] },
  platforms: Platform[],
  angle?: string,
): Promise<GenerateResult[]> {
  const prefs = await getUserPreferences(userId);
  const m = await materialFor(userId, ref);
  const now = new Date();
  const results: GenerateResult[] = [];
  for (const platform of platforms) {
    try {
      const voice = await voiceContext(userId, platform, m.text).catch(() => undefined);
      const out = await runTask({
        task: `draft_${platform}`,
        promptVersion: PROMPT_VERSIONS.draft,
        tier: "research",
        system: draftSystem(platform, prefs.platforms[platform].styleNotes, prefs.aboutMe, voice),
        user: [`Write a ${platform === "x" ? "X" : "LinkedIn"} post.`, angle ? `Angle chosen by the author: ${angle}` : "Pick the most interesting angle.", m.sourceUrl ? `Primary link you may include: ${m.sourceUrl}` : "", "Material:", m.text]
          .filter(Boolean)
          .join("\n\n"),
        output: draftOutputSchema,
        maxTokens: 3000,
        temperature: 0.7,
        budget: prefs.llm,
        useCache: false,
      });
      if (out.skip || out.parts.length === 0) {
        results.push({ platform, skipped: out.skipReason ?? "The model judged this a poor fit for the platform." });
        continue;
      }
      const system = draftSystem(platform, prefs.platforms[platform].styleNotes, prefs.aboutMe, voice);
      const parts0 = await fitToLimits(platform, platform === "linkedin" ? [out.parts.join("\n\n")] : out.parts, { system, material: m.text, budget: prefs.llm });
      const guard = await fixAttribution(platform, parts0, out.selfReview.fabricatedExperience, { system, material: m.text, budget: prefs.llm });
      const parts = guard.parts;
      const media = prefs.images.autoCard ? await autoCardMedia(userId, platform, out.imageCard).catch(() => [] as MediaRef[]) : [];
      const draft = await createDraft({
        userId,
        platform,
        parts,
        author: "llm",
        itemId: m.itemId,
        ideaId: m.ideaId,
        intakeId: m.intakeId,
        angle: out.angle || angle || null,
        instruction: angle ?? null,
        review: { ...out.selfReview, attributionRewritten: guard.rewritten, validation: validateParts(platform, parts) },
        timeliness: m.timeliness,
        freshUntil: freshnessHorizon(m.timeliness, m.publishedAt, now),
        media,
      });
      results.push({ platform, draftId: draft.id });
    } catch (err) {
      results.push({ platform, error: err instanceof LLMError || err instanceof DomainError ? err.message : `Could not generate: ${(err as Error).message}` });
    }
  }
  return results;
}

/**
 * "Make carousel": LinkedIn only. Writes a 7-9 slide script, renders the slides as PNGs,
 * and lands them as a new revision whose caption is the post text. The images ride with
 * the revision, so approval covers exactly caption + slides.
 */
export async function makeCarousel(userId: string, draftId: string) {
  const prefs = await getUserPreferences(userId);
  const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)) });
  if (!draft?.currentRevisionId) throw new DomainError("Draft not found.");
  if (draft.platform !== "linkedin") throw new DomainError("Carousels are a LinkedIn format. Use a thread on X instead.");
  const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, draft.currentRevisionId) });
  const hasRef = draft.itemId || draft.ideaId || draft.intakeId;
  const m = hasRef
    ? await materialFor(userId, { itemId: draft.itemId ?? undefined, ideaId: draft.ideaId ?? undefined, intakeId: draft.intakeId ?? undefined })
    : null;
  const materialText = m?.text ?? `Current draft:\n${rev?.parts.join("\n\n") ?? ""}`;
  const voice = await voiceContext(userId, "linkedin", materialText).catch(() => undefined);

  const out = await runTask({
    task: "carousel_linkedin",
    promptVersion: PROMPT_VERSIONS.carousel,
    tier: "research",
    system: carouselSystem(prefs.platforms.linkedin.styleNotes, prefs.aboutMe, voice),
    user: [
      "Write the LinkedIn carousel for this material. 7-9 slides. The caption stands alone as the post text.",
      m?.sourceUrl ? `Source link you may include in the caption: ${m.sourceUrl}` : "",
      "Material:",
      materialText,
    ]
      .filter(Boolean)
      .join("\n\n"),
    output: carouselScriptSchema,
    maxTokens: 4500,
    temperature: 0.7,
    budget: prefs.llm,
    useCache: false,
  });

  const source = m?.sourceUrl ? hostOf(m.sourceUrl) : undefined;
  const media = await renderCarousel(userId, out, source);
  const caption = out.caption.trim();
  if (!caption) throw new DomainError("The model returned an empty caption. Try again.");
  const system = carouselSystem(prefs.platforms.linkedin.styleNotes, prefs.aboutMe, voice);
  const parts = await fitToLimits("linkedin", [caption], { system, material: materialText, budget: prefs.llm });
  return addRevision(userId, draftId, parts, "llm", "carousel", { selfReview: out.selfReview, validation: validateParts("linkedin", parts) }, { format: "carousel", media });
}

/** One-click revisions ("shorter", "more analytical", a format like "whatif"…) create a new revision. */
export async function reviseDraft(userId: string, draftId: string, preset: string, custom?: string) {
  const prefs = await getUserPreferences(userId);
  const draft = await db().query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.userId, userId)) });
  if (!draft?.currentRevisionId) throw new DomainError("Draft not found.");
  const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.id, draft.currentRevisionId) });
  const m =
    draft.itemId || draft.ideaId || draft.intakeId
      ? await materialFor(userId, { itemId: draft.itemId ?? undefined, ideaId: draft.ideaId ?? undefined, intakeId: draft.intakeId ?? undefined })
      : null;
  const instruction = preset === "angle" ? `Rewrite with this angle: ${custom}` : preset === "custom" ? custom ?? "" : REVISION_PRESETS[preset];
  if (!instruction) throw new DomainError("Unknown revision type.");
  const voice = await voiceContext(userId, draft.platform, m?.text ?? rev!.parts.join("\n\n")).catch(() => undefined);

  const out = await runTask({
    task: `revise_${draft.platform}`,
    promptVersion: PROMPT_VERSIONS.revise,
    tier: "research",
    system: draftSystem(draft.platform, prefs.platforms[draft.platform].styleNotes, prefs.aboutMe, voice),
    user: [
      `Revise this ${draft.platform === "x" ? "X" : "LinkedIn"} post. Instruction: ${instruction}`,
      `Current version:\n${rev!.parts.map((p, i) => (rev!.parts.length > 1 ? `[${i + 1}] ${p}` : p)).join("\n\n")}`,
      m ? `Material (for accuracy):\n${m.text}` : "",
      m?.sourceUrl ? `Primary link: ${m.sourceUrl}` : "",
      "Set skip=false.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    output: draftOutputSchema,
    maxTokens: 3000,
    temperature: 0.7,
    budget: prefs.llm,
    useCache: false,
  });
  if (out.parts.length === 0) throw new DomainError("The model returned an empty revision. Try again.");
  const system = draftSystem(draft.platform, prefs.platforms[draft.platform].styleNotes, prefs.aboutMe, voice);
  const parts0 = await fitToLimits(draft.platform, draft.platform === "linkedin" ? [out.parts.join("\n\n")] : out.parts, {
    system,
    material: m?.text ?? "",
    budget: prefs.llm,
  });
  const guard = await fixAttribution(draft.platform, parts0, out.selfReview.fabricatedExperience, { system, material: m?.text ?? "", budget: prefs.llm });
  const parts = guard.parts;
  if (preset === "angle" && custom) await db().update(schema.drafts).set({ angle: custom }).where(eq(schema.drafts.id, draftId));
  const format = PRESET_FORMAT[preset] ?? rev!.format;
  return addRevision(
    userId,
    draftId,
    parts,
    "llm",
    instruction,
    { ...out.selfReview, attributionRewritten: guard.rewritten, validation: validateParts(draft.platform, parts) },
    { format, media: rev!.media },
  );
}
