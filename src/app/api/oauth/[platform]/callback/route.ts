import { NextResponse, type NextRequest } from "next/server";
import { currentUserId } from "@/server/auth";
import { completeOAuth } from "@/server/platforms/accounts";
import { log } from "@/server/log";
import { env } from "@/server/env";

export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const base = env().APP_URL.replace(/\/$/, "");
  const back = (q: string) => NextResponse.redirect(`${base}/settings?${q}`);
  if (platform !== "x" && platform !== "linkedin") return back("error=Unknown%20platform");

  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(`${base}/login`);

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(`error=${encodeURIComponent(sp.get("error_description") ?? sp.get("error")!)}`);
  const state = sp.get("state");
  const code = sp.get("code");
  if (!state || !code) return back("error=Missing%20authorization%20response");
  try {
    await completeOAuth(userId, platform, state, code);
    return back(`notice=${encodeURIComponent(`${platform === "x" ? "X" : "LinkedIn"} connected.`)}`);
  } catch (err) {
    log.warn("oauth_failed", { platform, error: (err as Error).message });
    return back(`error=${encodeURIComponent((err as Error).message)}`);
  }
}
