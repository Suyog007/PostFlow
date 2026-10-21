import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { consumeToken, markVerified } from "@/server/users";
import { getSessionUser, startSession } from "@/server/auth";

export const dynamic = "force-dynamic";

/** The link in the "confirm your email" message. */
export async function GET(req: Request) {
  const base = env().APP_URL.replace(/\/$/, "");
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const user = await consumeToken(token, "verify");
  if (!user) {
    // Already confirmed (for example the link was opened twice): carry on.
    const current = await getSessionUser();
    if (current?.emailVerifiedAt) return NextResponse.redirect(`${base}/calendar`);
    return NextResponse.redirect(`${base}/verify-email?error=${encodeURIComponent("That link has expired or was already used. Send a new one below.")}`);
  }
  const verified = await markVerified(user.id);
  // Confirming from the inbox signs you in on this device.
  await startSession(verified);
  return NextResponse.redirect(`${base}/calendar?welcome=1`);
}
