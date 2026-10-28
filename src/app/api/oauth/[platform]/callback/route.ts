import { after, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { getSessionUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { requestFillNow } from "@/server/tick";
import { log } from "@/server/log";
import { completeOAuth } from "@/server/platforms/accounts";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const base = env().APP_URL.replace(/\/$/, "");
  if (platform !== "x" && platform !== "linkedin") return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied || !code || !state) return NextResponse.redirect(`${base}/settings?error=${encodeURIComponent(denied ?? "Missing authorization code")}`);
  try {
    await completeOAuth(platform, state, code);
  } catch (err) {
    return NextResponse.redirect(`${base}/settings?error=${encodeURIComponent((err as Error).message)}`);
  }
  // The first account connected: start writing straight away and show the calendar's "first posts" loader,
  // instead of leaving the person on Settings until the next scheduler run.
  const [{ n }] = await db().select({ n: count() }).from(schema.posts).where(eq(schema.posts.userId, user.id));
  if (Number(n) === 0) {
    await requestFillNow(user.id, (job) => after(job)).catch((err: Error) => log.info("first_fill_not_started", { reason: err.message }));
    return NextResponse.redirect(`${base}/calendar?first=1`);
  }
  return NextResponse.redirect(`${base}/settings?connected=${platform}`);
}
