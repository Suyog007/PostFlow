import { z } from "zod";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db, schema } from "./db/client";
import { runTask, untrusted } from "./llm";
import { ANALYST_SYSTEM, profileBlock } from "./prompts";
import { getSettings } from "./settings";
import { tipsSourceId } from "./tips";
import { addEvent } from "./events";

const out = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      relevance: z.number().min(0).max(10),
      urgency: z.enum(["breaking", "week", "evergreen"]),
      angle: z.string(),
    }),
  ),
});

/** Scores one batch of not-yet-analyzed recent items. Returns how many were scored. */
export async function analyzeBatch(batchSize = 15): Promise<number> {
  const s = await getSettings();
  const rows = await db()
    .select()
    .from(schema.items)
    .where(and(isNull(schema.items.analyzedAt), eq(schema.items.status, "new"), gte(schema.items.publishedAt, new Date(Date.now() - 4 * 86_400_000))))
    .orderBy(desc(schema.items.publishedAt))
    .limit(batchSize);
  if (!rows.length) return 0;

  const listing = rows.map((r, i) => `[${i}] (${r.pillar}) ${r.title}\n${r.summary.slice(0, 300)}`).join("\n\n");
  const res = await runTask({
    task: "analyze_items",
    role: "analyst",
    system: `${ANALYST_SYSTEM}\n\n${profileBlock(s)}\nUse the bracketed index as the id.`,
    user: untrusted("feed items", listing, 9000),
    output: out,
    maxTokens: 1800,
    temperature: 0.1,
  });
  const tipsId = await tipsSourceId();
  const byIdx = new Map(res.items.map((x) => [x.id.replace(/\D/g, ""), x]));
  let n = 0;
  for (const [i, row] of rows.entries()) {
    const r = byIdx.get(String(i));
    await db()
      .update(schema.items)
      .set(
        r
          ? { relevance: row.sourceId === tipsId ? Math.max(8, Math.round(r.relevance)) : Math.round(r.relevance), urgency: r.urgency, angle: r.angle.slice(0, 300), analyzedAt: new Date() }
          : // The model skipped it; treat as not worth posting rather than retrying forever.
            { relevance: 0, urgency: "evergreen", analyzedAt: new Date() },
      )
      .where(eq(schema.items.id, row.id));
    if (r) n++;
  }
  await addEvent("analyze", `Scored ${n} of ${rows.length} items.`);
  return n;
}
