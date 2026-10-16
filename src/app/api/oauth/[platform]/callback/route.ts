import { NextResponse } from "next/server";
import { isLoggedIn } from "@/server/auth";
import { completeOAuth } from "@/server/platforms/accounts";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const base = env().APP_URL.replace(/\/$/, "");
  if (platform !== "x" && platform !== "linkedin") return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  if (!(await isLoggedIn())) return NextResponse.redirect(`${base}/login`);
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
  return NextResponse.redirect(`${base}/settings?connected=${platform}`);
}
