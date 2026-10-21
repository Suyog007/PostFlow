import { NextResponse } from "next/server";
import { handleStripeEvent, verifyWebhook } from "@/server/billing/stripe";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/** Stripe calls this on subscription changes. Set the endpoint in Stripe to {APP_URL}/api/stripe/webhook. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    await handleStripeEvent(JSON.parse(raw));
  } catch (err) {
    log.error("stripe_webhook_failed", { error: (err as Error).message });
    // 500 makes Stripe retry later.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
