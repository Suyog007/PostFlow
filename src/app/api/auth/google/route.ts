import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/server/env";
import { googleConfigured, startGoogleFlow } from "@/server/google";

export const dynamic = "force-dynamic";

/** Starts "Continue with Google". ?next= is where to go afterwards; ?tz= is the browser timezone (for new accounts). */
export async function GET(req: Request) {
  const base = env().APP_URL.replace(/\/$/, "");
  if (!googleConfigured()) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("Google sign-in is not set up yet.")}`);
  const url = new URL(req.url);
  const { url: target, flow } = startGoogleFlow(url.searchParams.get("next") ?? "/calendar", url.searchParams.get("tz") ?? undefined);
  (await cookies()).set("pf_google", JSON.stringify(flow), {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level redirect back from Google
    secure: env().APP_URL.startsWith("https://"),
    path: "/api/auth/google",
    maxAge: 10 * 60,
  });
  return NextResponse.redirect(target);
}
