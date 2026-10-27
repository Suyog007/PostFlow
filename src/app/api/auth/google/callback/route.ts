import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { env } from "@/server/env";
import { finishGoogleFlow, safeNext, type GoogleFlow } from "@/server/google";
import { startSession } from "@/server/auth";
import { AuthError, userFromGoogle } from "@/server/users";
import { visitSource } from "@/server/attribution";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const base = env().APP_URL.replace(/\/$/, "");
  const fail = (message: string) => NextResponse.redirect(`${base}/login?error=${encodeURIComponent(message)}`);
  const jar = await cookies();
  const raw = jar.get("pf_google")?.value;
  jar.delete({ name: "pf_google", path: "/api/auth/google" });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return fail("Google sign-in was cancelled.");
  let flow: GoogleFlow | null = null;
  try {
    flow = raw ? (JSON.parse(raw) as GoogleFlow) : null;
  } catch {
    flow = null;
  }
  if (!flow || !code || !state || !sameState(state, flow.state)) return fail("That sign-in link expired. Please try again.");

  try {
    const profile = await finishGoogleFlow(code, flow);
    const user = await userFromGoogle({ ...profile, timezone: flow.timezone, source: await visitSource() });
    await startSession(user);
    return NextResponse.redirect(`${base}${safeNext(flow.next)}`);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message);
    log.error("google_signin_failed", { error: (err as Error).message });
    return fail("Google sign-in failed. Please try again.");
  }
}
