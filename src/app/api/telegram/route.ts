import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { env } from "@/server/env";
import { handleTelegramUpdate } from "@/server/telegram-inbound";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await handleTelegramUpdate(await req.json());
  } catch (err) {
    console.error("telegram handler failed", (err as Error).message);
  }
  return NextResponse.json({ ok: true }); // always 200 so Telegram does not retry-storm
}
