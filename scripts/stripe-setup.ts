// Creates the PostFlow products and prices in Stripe from src/lib/pricing.ts.
// Safe to run again: prices that already exist (by lookup key) are left alone.
// Usage: STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup
import { loadDotEnv } from "./load-env";

loadDotEnv();
const { stripe } = await import("../src/server/billing/stripe");
const { PLANS, priceLookupKey, isPaidPlan } = await import("../src/lib/pricing");

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Set STRIPE_SECRET_KEY first (use a test key while you try things out).");
  process.exit(1);
}

for (const plan of PLANS.filter((p) => isPaidPlan(p.id))) {
  const id = plan.id as "starter" | "pro";
  const keys = { month: priceLookupKey(id, "month"), year: priceLookupKey(id, "year") };
  const existing = (await stripe("GET", "/prices", { lookup_keys: [keys.month, keys.year], limit: 10 })) as { data: { lookup_key: string; product: string; unit_amount: number }[] };
  const have = new Map(existing.data.map((p) => [p.lookup_key, p]));
  let productId = existing.data[0]?.product;
  if (!productId) {
    const product = (await stripe("POST", "/products", { name: `PostFlow ${plan.name}`, description: plan.tagline, metadata: { plan: id } })) as { id: string };
    productId = product.id;
    console.log(`Created product PostFlow ${plan.name} (${productId})`);
  }
  for (const interval of ["month", "year"] as const) {
    const key = keys[interval];
    const amount = Math.round((interval === "year" ? plan.yearly * 12 : plan.monthly) * 100);
    const current = have.get(key);
    if (current && current.unit_amount === amount) {
      console.log(`  ${key}: already set ($${amount / 100}/${interval})`);
      continue;
    }
    // A changed price gets a new Price object; transfer_lookup_key moves the key to it (existing subscribers keep their old price).
    await stripe("POST", "/prices", {
      product: productId,
      currency: "usd",
      unit_amount: amount,
      recurring: { interval },
      lookup_key: key,
      transfer_lookup_key: true,
      nickname: `${plan.name} ${interval === "year" ? "yearly" : "monthly"}`,
      tax_behavior: "exclusive",
    });
    console.log(`  ${key}: ${current ? "updated" : "created"} ($${amount / 100}/${interval})`);
  }
}
console.log("\nDone. Next: in the Stripe dashboard, open Settings > Billing > Customer portal, allow plan switching between the two products, and save.");
