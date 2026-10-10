import { loadDotEnv } from "./load-env";
loadDotEnv();

const { db, schema, closeDb } = await import("../src/server/db/client");
const { ensureOwner } = await import("../src/server/users");
const { defaultPreferences, saveUserPreferences } = await import("../src/server/preferences");
const { DEFAULT_SOURCES } = await import("../src/server/sources-default");

const owner = await ensureOwner();
const prefs = await db().query.preferences.findFirst();
if (!prefs) await saveUserPreferences(owner.id, defaultPreferences());

let added = 0;
for (const s of DEFAULT_SOURCES) {
  const r = await db()
    .insert(schema.sources)
    .values({ name: s.name, kind: s.kind, url: s.url, topicHint: s.topicHint, isPrimary: s.isPrimary ?? false, pollIntervalMinutes: s.pollIntervalMinutes ?? 180, config: s.config ?? {}, enabled: s.enabled ?? true })
    .onConflictDoNothing()
    .returning();
  added += r.length;
}
console.log(`Owner: ${owner.email}. Sources added: ${added}.`);
await closeDb();
