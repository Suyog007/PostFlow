import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { currentUserId, uid } from "./context";
import { log, warnOnError } from "./log";

/** Human-readable activity feed for the current user (system-wide when there is no user). */
export async function addEvent(kind: string, message: string, postId?: string) {
  const userId = await currentUserId();
  log.info(kind, { message, postId, userId });
  // The feed is a convenience: a failed insert is logged and never stops the work that triggered it.
  await db().insert(schema.events).values({ userId, kind, message: message.slice(0, 500), postId: postId ?? null }).catch(warnOnError("event_insert_failed", { kind }));
}

export async function recentEvents(limit = 30) {
  return db().select().from(schema.events).where(eq(schema.events.userId, await uid())).orderBy(desc(schema.events.at)).limit(limit);
}
