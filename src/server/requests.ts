import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import { assertFeature } from "./billing/plans";
import { getSettings, type Settings } from "./settings";
import { fetchArticle } from "./net";
import { produceForSlot, type Material } from "./generate";
import { checkStory, registrableDomain } from "./verify";
import { nextFreeSlot } from "./slots";
import { LLMError, untrusted } from "./llm";
import { addEvent } from "./events";
import { notifyText } from "./telegram";

type Platform = "x" | "linkedin";
type RequestRow = typeof schema.requests.$inferSelect;
const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export type RequestMode = "schedule" | "soon" | "draft";

export async function createRequest(input: { text: string; platforms?: Platform[]; mode?: RequestMode; via?: string; own?: boolean }): Promise<RequestRow> {
  const text = input.text.trim();
  if (text.length < 8) throw new Error("Give me a bit more to work with: an idea in a sentence or two, or a link.");
  const platforms = (input.platforms?.length ? input.platforms : ["linkedin", "x"]) as Platform[];
  if (URL_RE.test(text) || input.own) await assertFeature("links", "Writing posts from a link");
  const [row] = await db()
    .insert(schema.requests)
    .values({ userId: await uid(), input: text.slice(0, 4000), mode: input.mode ?? "schedule", platforms, via: input.via ?? "web", own: !!input.own })
    .returning();
  return row;
}

async function claimNext(): Promise<RequestRow | null> {
  const userId = await uid();
  const rows = await db().execute(sql`
    update requests set status = 'processing'
    where id = (select id from requests where user_id = ${userId}::uuid and status = 'pending' order by created_at limit 1 for update skip locked)
    returning id`);
  const id = (rows[0] as { id?: string } | undefined)?.id;
  return id ? (await db().query.requests.findFirst({ where: eq(schema.requests.id, id) })) ?? null : null;
}

async function materialFor(input: string, own: boolean, s: Settings): Promise<{ material: Material; unverifiedRisk: boolean }> {
  const url = input.match(URL_RE)?.[0];
  const angle = url ? input.replace(url, "").trim() : input;
  const isOwn = !!url && (own || s.ownDomains.some((d) => registrableDomain(url) === registrableDomain(d)));
  if (url && isOwn) {
    const article = await fetchArticle(url);
    if (!article && angle.length < 20) throw new Error("I could not read your article. Paste a short summary of what it says and I will write from that.");
    const source = [
      "THE OWNER'S OWN ARTICLE (they wrote it; write as its author):",
      `Title: ${article?.title ?? url}`,
      article ? `Article text:\n${untrusted("owner article", article.text, 7000)}` : "(The page could not be read; rely only on the owner's description below.)",
      angle ? `What the owner wants to stress:\n${angle}` : "",
      "Rules for this post: first person is fine for what the article itself says (\"I walk through\", \"I argue\"). Claim nothing the article does not say. Do not write \"Source:\" or \"according to\". Give the reader one concrete reason to open the article (a specific takeaway, number or surprise from it), and end on a line that points to it. The link is added for you after your text; do not write the URL yourself.",
    ].filter(Boolean).join("\n");
    return { material: { kind: "note", pillar: "own_work", source, label: article?.title ?? url, ownUrl: url, firstPerson: true }, unverifiedRisk: false };
  }
  if (!url) {
    return { material: { kind: "note", pillar: "own_work", source: angle, label: angle.slice(0, 80), firstPerson: true }, unverifiedRisk: false };
  }
  const article = await fetchArticle(url);
  if (!article && angle.length < 20) throw new Error("I could not read that page (it may be behind a paywall). Paste the key points as text and I will write from those.");
  const title = article?.title ?? new URL(url).hostname;
  const v = await checkStory({ url, title, summary: article?.text.slice(0, 400) });
  const lines = [
    `Source: ${new URL(url).hostname}`,
    `Title: ${title}`,
    article ? `Article text:\n${article.text}` : "(The page could not be read; rely only on the owner's description below.)",
    v.mentions.length ? `Also reported by (independent publishers):\n${v.mentions.map((m) => `- ${m.domain}: ${m.title}`).join("\n")}` : "",
    angle ? `OWNER'S ANGLE (their own view or instruction; use it as the point of the post, framed as their opinion):\n${angle}` : "",
  ].filter(Boolean);
  return {
    material: { kind: "news", pillar: "news", source: lines.join("\n"), label: title, sourceUrl: url, firstPerson: false, verification: v },
    // A risky claim (price, offer, money, security) that other publishers do not confirm stays a draft for you to check.
    unverifiedRisk: !v.ok && v.risky,
  };
}

async function slotTime(platform: Platform, mode: RequestMode, s: Settings, now: Date): Promise<Date> {
  if (mode === "draft") return now;
  if (mode === "soon") {
    let at = new Date(Math.ceil((now.getTime() + 20 * 60_000) / 60_000) * 60_000);
    for (let i = 0; i < 30; i++) {
      const clash = await db()
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(and(eq(schema.posts.userId, await uid()), eq(schema.posts.platform, platform), eq(schema.posts.scheduledAt, at), sql`${schema.posts.status} in ('scheduled','publishing')`));
      if (!clash.length) return at;
      at = new Date(at.getTime() + 60_000);
    }
    return at;
  }
  return (await nextFreeSlot(s, platform, new Date(now.getTime() + 20 * 60_000))) ?? new Date(now.getTime() + 24 * 3_600_000);
}

async function processOne(req: RequestRow, now: Date) {
  const s = await getSettings();
  try {
    const { material, unverifiedRisk } = await materialFor(req.input, req.own, s);
    const ids: string[] = [];
    for (const platform of req.platforms as Platform[]) {
      const at = await slotTime(platform, req.mode as RequestMode, s, now);
      const requested = req.mode === "draft" || unverifiedRisk ? "draft" : "schedule";
      const out = await produceForSlot(platform, at, material, s, 3, { requested });
      ids.push(out.postId);
    }
    if (unverifiedRisk) await notifyText("⚠️ I kept these as drafts: the claim is about a price, offer or money and other publishers do not confirm it yet. Check it, then put it on the calendar yourself.").catch(() => {});
    await db().update(schema.requests).set({ status: "done", postIds: ids, finishedAt: new Date() }).where(eq(schema.requests.id, req.id));
    await addEvent("request", `Created ${ids.length} post(s) from your ${req.input.match(URL_RE) ? "link" : "idea"}.`);
  } catch (err) {
    const message = err instanceof LLMError ? err.message : (err as Error).message;
    await db().update(schema.requests).set({ status: "failed", error: message.slice(0, 400), finishedAt: new Date() }).where(eq(schema.requests.id, req.id));
    await notifyText(`I could not create a post from that: ${message}`).catch(() => {});
  }
}

/** Works through pending requests (oldest first). Safe to call from several places at once. */
export async function processRequests(opts: { max?: number; now?: Date; deadline?: number } = {}): Promise<number> {
  const { max = 2, now = new Date(), deadline = Infinity } = opts;
  let done = 0;
  while (done < max && Date.now() < deadline) {
    const req = await claimNext();
    if (!req) break;
    await processOne(req, now);
    done++;
  }
  return done;
}

export async function recentRequests(limit = 10) {
  const userId = await uid();
  return db().query.requests.findMany({ where: (r, { eq }) => eq(r.userId, userId), orderBy: (r, { desc }) => [desc(r.createdAt)], limit });
}

