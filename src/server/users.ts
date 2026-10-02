import { asc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";

/**
 * Single-user today, but everything is keyed by user id rather than a constant.
 * The first user is the owner; their email follows APP_USER_EMAIL.
 */
export async function ensureOwner() {
  const email = env().APP_USER_EMAIL.toLowerCase();
  const first = await db().query.users.findFirst({ orderBy: asc(schema.users.createdAt) });
  if (first) {
    if (first.email !== email) await db().update(schema.users).set({ email }).where(eq(schema.users.id, first.id));
    return { ...first, email };
  }
  const [u] = await db().insert(schema.users).values({ email }).onConflictDoNothing().returning();
  return u ?? (await db().query.users.findFirst({ where: eq(schema.users.email, email) }))!;
}
