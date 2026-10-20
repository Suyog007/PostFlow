import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { fetchArticle, isPublicHttpUrl, normalizeUrl } from "./net";

const TIPS_URL = "tips://manual";

export async function tipsSourceId(): Promise<string> {
  const [row] = await db()
    .insert(schema.sources)
    .values({ name: "Your tips", url: TIPS_URL, pillar: "news", enabled: false })
    .onConflictDoUpdate({ target: schema.sources.url, set: { name: "Your tips" } })
    .returning({ id: schema.sources.id });
  return row.id;
}

/**
 * A story you saw yourself. It joins the normal pipeline, with a boosted score,
 * and is only posted once other publishers confirm it.
 */
export async function addTip(rawUrl: string): Promise<{ ok: boolean; message: string }> {
  const url = normalizeUrl(rawUrl.trim());
  if (!isPublicHttpUrl(url)) return { ok: false, message: "That is not a public web link." };
  const existing = await db().query.items.findFirst({ where: eq(schema.items.url, url) });
  if (existing) return { ok: true, message: "I already have that story. It will be considered with the rest." };
  const article = await fetchArticle(url);
  if (!article) return { ok: false, message: "I could not read that page. Use /post with your own description instead." };
  await db()
    .insert(schema.items)
    .values({ sourceId: await tipsSourceId(), url, title: article.title, summary: article.text.slice(0, 600), body: article.text, pillar: "news", publishedAt: new Date() })
    .onConflictDoNothing();
  return { ok: true, message: "Got it. I will cross-check it against other publishers and post about it only if it holds up." };
}
