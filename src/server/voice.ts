/**
 * Voice profile: calibrate drafts with the person's own recently approved posts
 * (few-shot exemplars, chosen by topic overlap) plus their editable voice rules.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import { getUserPreferences } from "./preferences";
import { titleTokens } from "./discovery/normalize";

const MAX_EXEMPLARS = 5;
const MAX_POOL = 40;

export async function voiceContext(
  userId: string,
  platform: "linkedin" | "x",
  materialText: string,
  opts: { exemplars?: boolean } = {},
): Promise<string | undefined> {
  const prefs = await getUserPreferences(userId);
  const rules = (prefs as { voiceRules?: string }).voiceRules?.trim() ?? "";
  const wantExemplars = opts.exemplars !== false && (prefs as { voiceExemplars?: boolean }).voiceExemplars !== false;

  const parts: string[] = [];
  if (rules) parts.push(`Voice rules written by the person (follow these):\n${rules}`);

  if (wantExemplars) {
    const pools = await db()
      .select({ parts: schema.draftRevisions.parts, contentHash: schema.draftRevisions.contentHash, at: schema.draftRevisions.createdAt })
      .from(schema.draftRevisions)
      .innerJoin(schema.drafts, eq(schema.drafts.id, schema.draftRevisions.draftId))
      .where(
        and(
          eq(schema.drafts.userId, userId),
          eq(schema.drafts.platform, platform),
          inArray(schema.drafts.status, ["approved", "scheduled", "publishing", "published"]),
        ),
      )
      .orderBy(desc(schema.draftRevisions.createdAt))
      .limit(MAX_POOL);

    // Only current-text revisions matter; dedupe by content hash.
    const seen = new Set<string>();
    const unique = pools.filter((p) => {
      if (seen.has(p.contentHash)) return false;
      seen.add(p.contentHash);
      return true;
    });

    const query = titleTokens(materialText.slice(0, 4000));
    const scored = unique
      .map((p, index) => {
        const text = p.parts.join("\n\n");
        const tokens = titleTokens(text);
        let hits = 0;
        for (const t of query) if (tokens.has(t)) hits++;
        return { text, hits, index };
      })
      .filter((s) => s.text.trim().length > 40)
      .sort((a, b) => b.hits - a.hits || a.index - b.index)
      .slice(0, MAX_EXEMPLARS);

    if (scored.length >= 2) {
      parts.push(
        [
          "The person's own recently approved posts — calibrate VOICE and structure to these; never reuse their facts:",
          ...scored.map((s, i) => `--- example ${i + 1} ---\n${s.text}`),
        ].join("\n\n"),
      );
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
}
