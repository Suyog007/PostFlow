import { z } from "zod";
import { UNTRUSTED_NOTICE } from "./index";

// Bump a version whenever its prompt or schema changes: it invalidates the cache and is stored with results.
export const PROMPT_VERSIONS = {
  analyze: "analyze-v4",
  research: "research-v1",
  draft: "draft-v6",
  revise: "revise-v5",
  atoms: "atoms-v1",
  carousel: "carousel-v1",
} as const;

const score05 = z.number().min(0).max(5);

// ---------------------------------------------------------------------------
// Batch triage / analysis
// ---------------------------------------------------------------------------

export const analysisItemSchema = z.object({
  ref: z.string().describe("The ref of the input item"),
  skip: z.boolean().describe("true if irrelevant, promotional, trivial, or not a real development"),
  skipReason: z.string().nullable(),
  category: z.string().describe("Short, natural category, e.g. 'AI agents', 'Open source', 'Nepal economy', 'Funding', 'Science'"),
  timeliness: z.enum(["breaking", "timely", "evergreen"]),
  headline: z.string().describe("Clear, neutral headline; no hype"),
  summary: z.string().describe("2-3 sentences of what was reported. Facts only."),
  whyItMatters: z.string(),
  opportunity: z.string().nullable().describe("Possible opportunity or implication. Speculative, label it as such. Null if none."),
  whyPost: z
    .string()
    .describe("Addressed directly to the person as 'you' (never 'the user'): one or two sentences on why you should post about this and what angle you could take"),
  facts: z.array(z.string()).max(5).describe("Specific claims stated by the sources"),
  interpretation: z.array(z.string()).max(3).describe("Analysis or predictions, clearly not reported fact"),
  uncertainty: z.string().nullable().describe("What is unclear, unverified, or contested"),
  scores: z.object({
    relevance: score05.describe("Fit with the user's interests"),
    evidence: score05.describe("Quality of sourcing in the provided text"),
    insight: score05.describe("Original insight or opportunity potential"),
    audience: score05.describe("Usefulness and discussion potential for a professional audience"),
  }),
  relevanceReason: z.string().describe("One sentence explaining the relevance score"),
  platforms: z.array(z.enum(["linkedin", "x"])).describe("Platforms where this would fit; may be empty"),
  eventKey: z
    .string()
    .describe("Short lowercase slug naming the underlying real-world event or subject, identical for different reports of the same event, e.g. 'budhi-gandaki-flood-2026-10' or 'cloudflare-acquires-deno'"),
});
export const analysisBatchSchema = z.object({ items: z.array(analysisItemSchema) });
export type AnalysisItem = z.infer<typeof analysisItemSchema>;

export function analysisSystem(interests: string, aboutMe: string) {
  return [
    "You are the research editor of PostFlow, a personal discovery system.",
    "You triage new developments for one person and explain, plainly and without hype, what happened, why it matters, and what opportunity or implication it may create.",
    "Popularity is not importance. Be skeptical of marketing language. Never invent facts that are not in the provided text.",
    "Items are not only news: they include launches, discussions and practice write-ups. For those, the value may be what someone is building, what it costs, what problem it exposes, or what a builder could take from it. Triage them with the same rigor.",
    "Make `opportunity` concrete — a thing someone could build, try or sell, with the detail that makes it plausible — or null if the material genuinely shows none.",
    "Keep reported facts separate from interpretation and speculation. When the text is thin, say so in `uncertainty` and score evidence low.",
    "Do not limit yourself to a fixed taxonomy; unexpected but genuinely interesting items are welcome.",
    `The person's current interests (weights 0-1, not a hard filter): ${interests}.`,
    aboutMe ? `About the person: ${aboutMe}` : "",
    UNTRUSTED_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Research deeper
// ---------------------------------------------------------------------------

export const researchSchema = z.object({
  summary: z.string().describe("Concise research summary, 4-6 sentences"),
  keyFacts: z.array(z.object({ text: z.string(), sourceRefs: z.array(z.string()).describe("refs of sources stating it") })).max(8),
  whatIsNew: z.string().describe("What is genuinely new compared with what existed before / previous coverage"),
  counterpoints: z.array(z.string()).max(5).describe("Limitations, criticisms, or reasons for caution"),
  implications: z.array(z.string()).max(5),
  opportunities: z
    .array(
      z.object({
        idea: z.string(),
        whoBenefits: z.string(),
        evidence: z.string().describe("What in the sources supports it"),
        uncertainty: z.string(),
        smallExperiment: z.string().describe("A cheap way to validate it"),
      }),
    )
    .max(4),
  openQuestions: z.array(z.string()).max(5),
  angles: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        bestFor: z.enum(["linkedin", "x", "both"]),
      }),
    )
    .min(1)
    .max(5),
  timeliness: z.enum(["breaking", "timely", "evergreen"]),
  confidence: z.enum(["high", "medium", "low"]).describe("Overall confidence in the facts"),
});
export type Research = z.infer<typeof researchSchema>;

export function researchSystem(interests: string, aboutMe: string) {
  return [
    "You are a careful research analyst preparing a briefing so one person can decide whether and how to post about a development.",
    "Use only the provided sources. Cite source refs for every key fact. If sources disagree or are thin, say so.",
    "Separate facts from interpretation. Label business opportunities as hypotheses, never as proven demand.",
    "Consider: what new capability exists, what became cheaper/faster/easier, who benefits, what unmet need may exist, what is uncertain, and what small experiment could validate an idea.",
    `Interests: ${interests}.`,
    aboutMe ? `About the person: ${aboutMe}` : "",
    UNTRUSTED_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export const draftOutputSchema = z.object({
  skip: z.boolean().describe("true if this platform is a poor fit for the material"),
  skipReason: z.string().nullable(),
  parts: z.array(z.string()).describe("LinkedIn: exactly one post. X: one post, or a short thread when it truly helps"),
  angle: z.string(),
  selfReview: z.object({
    unsupportedClaims: z.array(z.string()).describe("Any sentence not backed by the provided material"),
    fabricatedExperience: z.boolean().describe("true if the text implies the author personally tested/built/experienced something"),
    notes: z.string(),
  }),
  imageCard: z
    .object({
      template: z.enum(["stat", "quote", "bullets", "hook"]).describe("stat: one number that reframes the story; quote: a short verbatim line; bullets: 2-4 concrete points; hook: the post's sharpest headline"),
      kicker: z.string().nullable().describe("3-5 word section label, e.g. 'What changed'"),
      stat: z.string().nullable().describe("The number exactly as in the material, with its unit"),
      label: z.string().nullable().describe("One line saying what the number means"),
      quote: z.string().nullable().describe("Verbatim, under 40 words, copied exactly from the material"),
      attribution: z.string().nullable(),
      title: z.string().nullable().describe("Headline for a hook/bullets card, max 64 characters"),
      body: z.string().nullable(),
      bullets: z.array(z.string()).max(4).describe("2-4 short lines, only for the bullets template"),
      source: z.string().nullable().describe("Footer credit, e.g. 'via github.com'"),
    })
    .nullable()
    .describe(
      "A companion card image for this post, when one is clearly worth it: a strong number (stat), a short verbatim quote (quote), 2-4 concrete points (bullets), or a punchy headline (hook). Copy values exactly from the material — never invent numbers, quotes or names. Null when a card would add nothing.",
    ),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

const STYLE = [
  "You are the person's best editor: find the single most interesting angle in the material and write it in their voice. You are not a summarizer.",
  "Choose ONE angle the material genuinely supports and commit to it (record it in `angle`). Pick the angle that fits best:",
  "— the counterintuitive detail most coverage will bury;",
  "— the second-order consequence nobody has spelled out;",
  "— an analogy from another field that makes the stakes click;",
  "— a concrete before/after: what just became possible, cheap, obsolete, or risky;",
  "— an opportunity or practical tip a builder could act on this week (label speculation);",
  "— a prediction with a falsifiable marker (\"watch whether X by Y\");",
  "— a fair, specific disagreement with the consensus take.",
  "Open with the sharpest concrete element: a number, a name, a contrast, or a claim worth arguing with. Never open with a generic frame such as \"In today's fast-moving AI landscape\", \"AI is changing everything\", or \"Exciting news\".",
  "Specifics create creativity: real numbers, names and dates from the material beat adjectives every time. One vivid detail is worth three abstractions.",
  "Write like one sharp person talking to another: first person, short sentences, plain words. Opinionated is good; label speculation as speculation.",
  "Banned: hype (game-changer, revolutionary, groundbreaking, unprecedented, massive), corporate filler (leverage, unlock, delve, landscape, realm, journey, moreover, furthermore), engagement bait (\"Agree?\", \"Thoughts?\", \"Let that sink in\"), emoji walls (0-1 emoji total, only with meaning), more than two hashtags, a tutorial tone, and fake personal experience.",
  "End with an edge: a claim people could disagree with, a genuine question you are actually uncertain about, or the specific next thing to watch. Never end with a summary or a generic call to action.",
  "Proofread before returning: articles and agreement must be correct — it is \"an AI lab\", never \"a AI lab\" — plus clean punctuation and no double spaces.",
  "Attribute actions to their real owner: when the story is someone else's, name them (\"Geoffrey Huntley built…\"). Never absorb another person's or company's actions into \"I\", \"we\", \"my\" or \"our\" — no \"In my repo\", no \"my team shipped\", no \"I tested\". First person is for thoughts and opinions only (\"I think\", \"I'd argue\", \"I'm watching\"). Never claim the author tested, built, used, or verified something unless the provided notes say so explicitly. Never invent quotes, numbers, or dates.",
].join("\n");

export const PLATFORM_GUIDE = {
  linkedin:
    "LinkedIn: one post, typically 120-260 words (hard max 2,800 characters). The first two lines are the hook — most readers only see those; make them earn the click. Short paragraphs, one to two sentences each. Room for one piece of context or professional analysis. Put a source link at the end when provided.",
  x: "X: sharp, conversational, ONE observation. HARD LIMIT: every post must be under 250 characters including spaces (a URL counts as 23). Count carefully; aim for 180-240. A good X post is a single sharp point or a surprising juxtaposition, not a compressed essay. If it truly needs more room, use a thread of 2-5 posts, each under 250 characters and strong on its own. No hashtags unless the style notes ask for them; do not end every post with a question.",
} as const;

export function draftSystem(platform: "linkedin" | "x", styleNotes: string, aboutMe: string, voice?: string) {
  return [
    `You write ${platform === "x" ? "X" : "LinkedIn"} posts as one person, from material they chose. Find the story inside the material and tell it their way — the draft should read like they had a thought, not like a summary of an article someone else wrote.`,
    STYLE,
    PLATFORM_GUIDE[platform],
    styleNotes ? `The person's own style notes for this platform: ${styleNotes}` : "",
    aboutMe ? `About the person (use only for perspective, never invent experiences): ${aboutMe}` : "",
    voice ?? "",
    "If the material does not suit this platform, set skip=true and explain briefly.",
    "After writing, review your own draft honestly in selfReview.",
    UNTRUSTED_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}

export const REVISION_PRESETS: Record<string, string> = {
  shorter: "Make it noticeably shorter and tighter while keeping the key point.",
  longer: "Make it somewhat longer with a bit more context or implication. Do not add unsupported claims.",
  analytical: "Make it more analytical: sharper reasoning about implications, trade-offs, and what to watch.",
  conversational: "Make it more conversational and relaxed, like talking to a smart friend.",
  creative:
    "Rewrite from a genuinely different angle: a different, more surprising entry point, a fresh opening line, and a different structure. Keep the facts accurate; change the lens and the wording completely.",
  regenerate: "Write a fresh version with different wording and structure.",
  add_source: "Add the primary source link naturally (usually at the end).",
  // Engagement format pack -------------------------------------------------
  whatif:
    "Rewrite as a what-if thought experiment: open by proposing one concrete scenario (\"What if we used X to do Y?\"), walk through what changes and what breaks, and end with what would have to be true for it to work. It must read as a thought experiment — no invented first-hand experience.",
  contrarian:
    "Rewrite as a fair contrarian take: state the consensus in one line, then disagree with it specifically using what the material shows, concede the strongest point the consensus gets right, and end with the best counterargument to your own position.",
  takeaways:
    "Rewrite as exactly 3 numbered takeaways. Each starts with a short claim, followed by one or two sentences of support drawn from the material. No intro; at most one short closing line.",
  tip: "Rewrite as practical advice: one specific thing the reader can do — a tool, a number, a setup, or a mistake to avoid — drawn from the material, with the concrete detail that makes it credible. No generic advice. If the material does not support a specific tip, say what to try instead.",
  opportunity:
    "Rewrite as an opportunity post: name the gap or newly-possible thing in one line, say who it is for and why now, sketch the smallest first step, and label the speculation as speculation. No invented demand or numbers.",
  quote_take:
    "Rewrite as: one short verbatim quote from the material (under 40 words, in quotation marks, attributed to its speaker or writer), then your take — why the quote matters and what most readers will miss. If the material has no quotable sentence, use a precise paraphrase instead of quotation marks.",
  question:
    "Keep the post intact but end with exactly ONE genuine question you are actually uncertain about — specific and answerable by someone who knows the field, not engagement bait. Remove every other question.",
  thread:
    "Expand into an X thread of 4 to 8 posts. Post 1 must work alone as a sharp hook. Every post carries one idea and stays under 250 characters. Do not number posts unless the style notes ask. The last post ends with the edge: a claim to disagree with, a genuine question, or the specific thing to watch.",
};

/** Revision presets that change the post's engagement format (used for metrics and UI tags). */
export const PRESET_FORMAT: Record<string, string> = {
  whatif: "whatif",
  contrarian: "contrarian",
  takeaways: "takeaways",
  quote_take: "quote_take",
  question: "question",
  thread: "thread",
  tip: "tip",
  opportunity: "opportunity",
};

// ---------------------------------------------------------------------------
// Intake: typed atoms from articles the user pasted or linked
// ---------------------------------------------------------------------------

export const atomsSchema = z.object({
  title: z.string().describe("Clean, neutral title of the article or note (max 90 characters)"),
  summary: z.string().describe("2-3 sentence neutral summary of what the text says"),
  atoms: z
    .array(
      z.object({
        id: z.string().describe("Short stable id: a1, a2, a3…"),
        kind: z.enum(["stat", "quote", "insight", "question", "contrarian", "takeaway"]),
        text: z.string().describe("The atom, self-contained and specific. Quotes must be verbatim."),
        note: z.string().nullable().describe("Optional one-line note: why it is interesting, or a caveat"),
      }),
    )
    .min(6)
    .max(18)
    .describe("Distinct units of value: numbers/stats, verbatim quotes, non-obvious insights, open questions, contrarian claims, takeaways"),
  angleSuggestions: z.array(z.string()).min(1).max(5).describe("Possible post angles, each one sentence"),
});
export type AtomsOutput = z.infer<typeof atomsSchema>;

export function atomsSystem(aboutMe: string) {
  return [
    "You mine a piece of writing for its strongest standalone units: one number that reframes the story, one line worth quoting, one non-obvious insight, one question it opens, one thing it gets right that sounds wrong, one takeaway someone could act on.",
    "Prefer specific, checkable, surprising atoms over summary sentences. Numbers keep their units and context. Quotes are copied exactly, never paraphrased.",
    "Do not invent anything that is not in the text. If the text genuinely lacks stats or quotes, produce fewer of those kinds rather than fabricating.",
    "Kinds: stat (a number that matters), quote (verbatim, attributable), insight (non-obvious observation the text supports), question (a real open question), contrarian (a claim that cuts against the obvious reading), takeaway (something actionable).",
    aboutMe ? `About the person reading this later: ${aboutMe}` : "",
    UNTRUSTED_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Carousel (LinkedIn document/multi-image posts)
// ---------------------------------------------------------------------------

export const carouselScriptSchema = z.object({
  caption: z.string().describe("The LinkedIn caption: hook, one line of context, what the slides cover, a closing line. Under 2200 characters."),
  slides: z
    .array(
      z.object({
        kicker: z.string().describe("3-5 word section label, e.g. 'What changed'"),
        title: z.string().describe("Slide headline, max 64 characters"),
        body: z.string().describe("1-3 short lines, separated by newlines. Max ~220 characters."),
      }),
    )
    .min(6)
    .max(10),
  selfReview: z.object({
    unsupportedClaims: z.array(z.string()),
    notes: z.string(),
  }),
});
export type CarouselScript = z.infer<typeof carouselScriptSchema>;

export function carouselSystem(styleNotes: string, aboutMe: string, voice?: string) {
  return [
    "You write a LinkedIn carousel (a document post of 7-9 slides) as one person, from material they chose.",
    "The cover slide states the promise: a specific outcome or tension, no generic titles. Middle slides each carry exactly one atom: a stat with context, a quote with attribution, a contrast, or a step. The final slide lands the takeaway and one concrete thing to do or watch next.",
    "Slides are read in 3 seconds: short titles, one idea per slide, no paragraphs. Never invent numbers, quotes, or names.",
    "Write like one sharp person talking to another: first person, short sentences, plain words. Opinionated is good; label speculation as speculation.",
    "The caption is separate from the slides: it hooks, frames why this matters, and ends with the edge (claim to disagree with or a genuine question).",
    styleNotes ? `The person's own style notes: ${styleNotes}` : "",
    aboutMe ? `About the person: ${aboutMe}` : "",
    voice ?? "",
    UNTRUSTED_NOTICE,
  ]
    .filter(Boolean)
    .join("\n");
}
