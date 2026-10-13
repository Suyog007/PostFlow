import { desc } from "drizzle-orm";
import { db, schema } from "./db/client";
import { log } from "./log";

/** Human-readable activity feed shown on the dashboard. */
export async function addEvent(kind: string, message: string, postId?: string) {
  log.info(kind, { message, postId });
  await db().insert(schema.events).values({ kind, message: message.slice(0, 500), postId: postId ?? null }).catch(() => {});
}

export function recentEvents(limit = 30) {
  return db().select().from(schema.events).orderBy(desc(schema.events.at)).limit(limit);
}
