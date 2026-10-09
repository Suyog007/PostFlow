import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { defaultPreferences, saveUserPreferences, type Preferences } from "@/server/preferences";
import { encryptSecret } from "@/server/crypto";
import type { PlatformClient, PublishResult } from "@/server/platforms/types";

export async function resetDb() {
  await db().execute(sql`truncate users, sources, items, item_sources, repo_snapshots, briefings, job_runs, llm_calls, llm_cache cascade`);
}

/** Preferences with permissive limits and an all-day window so tests control the variables. */
export function openPrefs(overrides: Partial<Preferences["platforms"]["x"]> = {}): Preferences {
  const p = defaultPreferences();
  const open = { paused: false, maxPerDay: 10, maxPerWeek: 50, minIntervalMinutes: 0, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" }], allowEvergreenFill: true, prioritizeTimely: true, linkInReply: false, styleNotes: "" };
  p.platforms.x = { ...open, ...overrides };
  p.platforms.linkedin = { ...open, ...overrides };
  return p;
}

export async function makeUser(prefs: Preferences = openPrefs()) {
  const [u] = await db().insert(schema.users).values({ email: `u${Math.random()}@test.dev` }).returning();
  await saveUserPreferences(u.id, prefs);
  return u.id;
}

export async function connect(userId: string, platform: "x" | "linkedin") {
  await db().insert(schema.platformAccounts).values({
    userId,
    platform,
    externalUserId: platform === "x" ? "42" : "abc",
    handle: "@me",
    accessTokenEnc: encryptSecret("token"),
    status: "connected",
  });
}

export class FakeClient implements PlatformClient {
  calls: string[][] = [];
  results: PublishResult[] = [];
  existing: { text: string; id: string }[] = [];
  reconcileSupported = true;
  async publish(parts: string[]): Promise<PublishResult> {
    this.calls.push(parts);
    const r = this.results.shift() ?? { kind: "success", externalIds: [`ext-${this.calls.length}`], url: `https://example.test/${this.calls.length}` };
    if (r.kind === "success") this.existing.push({ text: parts[0], id: r.externalIds[0] });
    return r;
  }
  async findRecentPost(text: string) {
    if (!this.reconcileSupported) {
      const { ReconcileNotSupported } = await import("@/server/platforms/types");
      throw new ReconcileNotSupported("linkedin");
    }
    const hit = this.existing.find((e) => e.text === text);
    return hit ? { externalId: hit.id } : null;
  }
}
