import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const slotSchema = z.object({
  platform: z.enum(["x", "linkedin"]),
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  time: hhmm,
});
export type Slot = z.infer<typeof slotSchema>;

export const settingsSchema = z.object({
  /** Master switch: nothing is generated or published while true. */
  paused: z.boolean().default(false),
  /** Nothing is published until the owner approves it. Turn off for full auto mode. */
  requireApproval: z.boolean().default(true),
  /** Wording preferences the owner gave when asking for a reword. Fed to the writer on every post. */
  styleNotes: z.array(z.string()).default([]),
  /** IANA timezone; set from the browser at sign-up. */
  timezone: z.string().default("UTC"),
  profile: z
    .object({
      name: z.string().default(""),
      role: z.string().default(""),
      bio: z.string().default(""),
      /** City, country or community for "local scene" posts, e.g. "Nepal" or "Berlin". Empty = no local posts. */
      region: z.string().default(""),
      /** What the owner can credibly write about. Evergreen posts stay inside this list. */
      expertise: z.array(z.string()).default([]),
      voice: z.string().default("Direct, practical and specific. Plain words. Opinionated but fair. No hype."),
      avoid: z.string().default("Politics, religion, anything about employers, unverified claims about people or companies."),
    })
    .default({
      name: "",
      role: "",
      bio: "",
      region: "",
      expertise: [],
      voice: "Direct, practical and specific. Plain words. Opinionated but fair. No hype.",
      avoid: "Politics, religion, anything about employers, unverified claims about people or companies.",
    }),
  slots: z.array(slotSchema).default([
    { platform: "linkedin", days: [1, 2, 3, 4, 5], time: "09:15" },
    { platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" },
    { platform: "x", days: [1, 2, 3, 4, 5], time: "19:30" },
  ]),
  /** Relative share of each content type. */
  pillars: z
    .object({ own_work: z.number().min(0), news: z.number().min(0), local: z.number().min(0).default(0), learning: z.number().min(0) })
    .default({ own_work: 3, news: 3, local: 0, learning: 1 }),
  /** How many days ahead the calendar is kept filled. */
  horizonDays: z.number().int().min(1).max(14).default(3),
  /** Smallest relevance (0-10) a news item needs to become an X post. */
  minRelevance: z.number().int().min(1).max(10).default(7),
  /** LinkedIn is stricter: a weak story is skipped there rather than posted for the sake of posting. */
  linkedinMinRelevance: z.number().int().min(1).max(10).default(8),
  /** When no strong material exists for a slot, fill it with an evergreen explainer on the owner's topics (true) or leave it empty (false). */
  fillerPosts: z.boolean().default(false),
  /** Domains of your own sites (portfolio, blog). A link to one of these is treated as your own article: written as its author, with the link included. */
  ownDomains: z.array(z.string()).default([]),
  /** Links in posts. Off by default: the post names its source in words. */
  /** Hashtags at the end of a post: 1-2 specific ones on X by default, none on LinkedIn unless switched on (then up to 3). */
  hashtags: z.object({ linkedin: z.boolean().default(false), x: z.boolean().default(true) }).default({ linkedin: false, x: true }),
  includeLinks: z.object({ linkedin: z.boolean().default(false), x: z.boolean().default(false) }).default({ linkedin: false, x: false }),
  /** Extra posts, outside the normal slots, for rare high-scoring breaking stories. The owner still has the lead time to veto. */
  fastLane: z
    .object({
      enabled: z.boolean().default(true),
      minRelevance: z.number().int().min(7).max(10).default(9),
      maxPerDay: z.number().int().min(1).max(3).default(1),
      leadMinutes: z.number().int().min(15).max(240).default(45),
      platforms: z.array(z.enum(["x", "linkedin"])).default(["x", "linkedin"]),
      /** No fast-lane posts between these local times. */
      quietStart: hhmm.default("23:00"),
      quietEnd: hhmm.default("07:00"),
    })
    .default({ enabled: true, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x", "linkedin"], quietStart: "23:00", quietEnd: "07:00" }),
});

export type Settings = z.infer<typeof settingsSchema>;

/** The current user's settings (defaults filled in). */
export async function getSettings(): Promise<Settings> {
  const row = await db().query.settings.findFirst({ where: eq(schema.settings.id, await uid()) });
  return settingsSchema.parse(row?.data ?? {});
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const id = await uid();
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await db()
    .insert(schema.settings)
    .values({ id, data: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.id, set: { data: next, updatedAt: new Date() } });
  return next;
}
