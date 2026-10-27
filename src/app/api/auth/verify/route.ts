import { NextResponse } from "next/server";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Links sent before confirm-email existed. Forwards without using the token; confirming takes a click there. */
export async function GET(req: Request) {
  const base = env().APP_URL.replace(/\/$/, "");
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return NextResponse.redirect(`${base}/confirm-email?token=${encodeURIComponent(token)}`);
}
