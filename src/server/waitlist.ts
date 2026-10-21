import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";

export const PLANS = ["starter", "pro", "agency"] as const;

const input = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  plan: z.enum(PLANS).optional(),
  role: z.string().trim().max(80).optional(),
});

export type JoinResult = { ok: true; message: string } | { ok: false; error: string };

/** Adds an email to the early-access list. Joining twice is not an error. */
export async function joinWaitlist(raw: { email: unknown; plan?: unknown; role?: unknown }): Promise<JoinResult> {
  const parsed = input.safeParse({
    email: raw.email,
    plan: PLANS.includes(raw.plan as never) ? raw.plan : undefined,
    role: typeof raw.role === "string" && raw.role.trim() ? raw.role : undefined,
  });
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };
  const { email, plan, role } = parsed.data;
  await db()
    .insert(schema.waitlist)
    .values({ email, plan: plan ?? null, role: role ?? null })
    .onConflictDoUpdate({ target: schema.waitlist.email, set: { plan: sql`coalesce(excluded.plan, ${schema.waitlist.plan})`, role: sql`coalesce(excluded.role, ${schema.waitlist.role})` } });
  return { ok: true, message: "You're on the list. We'll email you when your invite is ready." };
}

export async function listWaitlist(limit = 200) {
  return db().select().from(schema.waitlist).orderBy(desc(schema.waitlist.createdAt)).limit(limit);
}
