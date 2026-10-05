/**
 * Intake service: store an article (URL or pasted text), mine typed atoms from it,
 * and keep everything the drafting pipeline needs. One LLM call per intake.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { IntakeAtom } from "../db/schema";
import { runTask, untrusted } from "../llm";
import { PROMPT_VERSIONS, atomsSchema, atomsSystem } from "../llm/prompts";
import { getUserPreferences } from "../preferences";
import { extractIntake, IntakeError } from "./extract";

export { IntakeError };

export interface IntakeResult {
  id: string;
  title: string;
  summary: string;
  atoms: IntakeAtom[];
  angles: string[];
  url: string | null;
}

export async function createIntake(userId: string, input: string): Promise<IntakeResult> {
  const prefs = await getUserPreferences(userId);
  const extracted = await extractIntake(input);

  const out = await runTask({
    task: "intake_atoms",
    promptVersion: PROMPT_VERSIONS.atoms,
    tier: "research",
    system: atomsSystem(prefs.aboutMe),
    user: [
      `Source: ${extracted.url ? `${extracted.siteName ?? "web"} — ${extracted.url}` : "Text the author pasted (may be their own writing)"}`,
      extracted.byline ? `Author: ${extracted.byline}` : "",
      "Mine the atoms from this text:",
      untrusted(extracted.siteName ?? "pasted text", extracted.text, 18_000),
    ]
      .filter(Boolean)
      .join("\n\n"),
    output: atomsSchema,
    maxTokens: 4500,
    temperature: 0.4,
    budget: prefs.llm,
    useCache: false,
  });

  const atoms: IntakeAtom[] = out.atoms.map((a, i) => ({
    id: a.id?.trim() || `a${i + 1}`,
    kind: a.kind,
    text: a.text.trim(),
    note: a.note?.trim() || undefined,
  }));

  const [row] = await db()
    .insert(schema.intakes)
    .values({
      userId,
      kind: extracted.url ? "url" : "text",
      url: extracted.url,
      title: out.title.trim() || extracted.title,
      byline: extracted.byline,
      siteName: extracted.siteName,
      text: extracted.text,
      summary: out.summary.trim(),
      atoms,
      status: "ready",
    })
    .returning();

  return { id: row.id, title: row.title, summary: row.summary ?? "", atoms, angles: out.angleSuggestions, url: row.url };
}

export async function listIntakes(userId: string, limit = 30) {
  return db().query.intakes.findMany({
    where: and(eq(schema.intakes.userId, userId)),
    orderBy: desc(schema.intakes.createdAt),
    limit,
  });
}

export async function getIntake(userId: string, id: string) {
  return db().query.intakes.findFirst({ where: and(eq(schema.intakes.id, id), eq(schema.intakes.userId, userId)) });
}

export async function archiveIntake(userId: string, id: string) {
  await db()
    .update(schema.intakes)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(schema.intakes.id, id), eq(schema.intakes.userId, userId)));
}
