import { and, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import { getSettings, saveSettings, type Settings } from "./settings";
import { seedSourcesIfEmpty } from "./collect";
import { discoverFeed } from "./feed-discover";
import { fieldOf } from "../lib/fields";
import { assertFeedQuota, LimitError } from "./billing/plans";

/** True until the account has said who it is: a role and at least one topic. */
export function needsWelcome(s: Settings) {
  return !s.profile.role.trim() || s.profile.expertise.length === 0;
}

export function splitTopics(raw: string) {
  return [...new Set(raw.split(/[\n,;]/).map((x) => x.trim().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean))].slice(0, 12);
}

export interface WelcomeInput {
  field?: string;
  audience?: string;
  role: string;
  expertise: string;
  region?: string;
  feeds?: string[];
}

export type WelcomeResult = { ok: true; added: string[] } | { ok: false; error: string };

/** Saves the first-run answers. Feeds are optional; one that cannot be found stops the save with a clear message. */
export async function completeWelcome(input: WelcomeInput): Promise<WelcomeResult> {
  const role = input.role.trim().replace(/\s+/g, " ").slice(0, 100);
  const expertise = splitTopics(input.expertise);
  if (role.length < 2) return { ok: false, error: "Add your role, for example \"Backend engineer at a fintech\"." };
  if (expertise.length < 2) return { ok: false, error: "Add at least two topics you know well, separated by commas." };

  // Find every feed before saving anything, so a typo does not leave half the answers saved.
  const found: { url: string; name: string }[] = [];
  for (const raw of (input.feeds ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 2)) {
    const feed = await discoverFeed(raw);
    if (!feed) return { ok: false, error: `No news feed found at "${raw.slice(0, 80)}". Try the blog's homepage or its RSS link, or leave it empty.` };
    found.push(feed);
  }

  const s = await getSettings();
  await saveSettings({
    profile: {
      ...s.profile,
      field: fieldOf(input.field ?? s.profile.field).id,
      audience: (input.audience ?? "").trim().replace(/\s+/g, " ").slice(0, 160) || s.profile.audience,
      role,
      expertise,
      region: (input.region ?? "").trim().slice(0, 60) || s.profile.region,
    },
  });

  // The default feeds are only added to an account with no feeds, so add them before the user's own.
  await seedSourcesIfEmpty();
  const userId = await uid();
  const added: string[] = [];
  for (const f of found) {
    const exists = await db().query.sources.findFirst({ where: and(eq(schema.sources.userId, userId), eq(schema.sources.url, f.url)) });
    if (exists) continue;
    try {
      await assertFeedQuota();
    } catch (err) {
      if (err instanceof LimitError) return { ok: false, error: err.message };
      throw err;
    }
    await db().insert(schema.sources).values({ userId, name: f.name, url: f.url, pillar: "news" }).onConflictDoNothing();
    added.push(f.name);
  }
  return { ok: true, added };
}
