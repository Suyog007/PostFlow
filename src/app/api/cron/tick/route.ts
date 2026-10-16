import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/server/env";
import { tick } from "@/server/tick";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await tick());
}

export const GET = run;
export const POST = run;
