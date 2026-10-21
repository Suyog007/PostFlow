import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { currentUserId, uid } from "./context";
import { log } from "./log";

/** Human-readable activity feed for the current user (system-wide when there is no user). */
export async function addEvent(kind: string, message: string, postId?: string) {
  const userId = await currentUserId();
  log.info(kind, { message, postId, userId });
  await db().insert(schema.events).values({ userId, kind, message: message.slice(0, 500), postId: postId ?? null }).catch(() => {});
}

export async function recentEvents(limit = 30) {
  return db().select().from(schema.events).where(eq(schema.events.userId, await uid())).orderBy(desc(schema.events.at)).limit(limit);
}
