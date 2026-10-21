import Link from "next/link";
import { DateTime } from "luxon";
import { and, count, desc, gte, ne, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { db, schema } from "@/server/db/client";
import { requireOwnerUser } from "@/server/auth";
import { entitlementOf } from "@/server/billing/plans";
import { systemChecks } from "@/server/health";
import { listWaitlist } from "@/server/waitlist";
import { planById } from "@/lib/pricing";
import { Logo } from "@/components/ui";
import { adminTickAction, telegramWebhookAction } from "../actions";

export const metadata: Metadata = { title: "Admin · PostFlow" };
export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwnerUser();
  const sp = await searchParams;
  const users = await db().select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(500);
  const monthStart = DateTime.utc().startOf("month").toJSDate();
  const postsByUser = new Map(
    (await db().select({ u: schema.posts.userId, n: count() }).from(schema.posts).where(and(gte(schema.posts.createdAt, monthStart), ne(schema.posts.status, "rejected"))).groupBy(schema.posts.userId)).map((r) => [r.u, Number(r.n)]),
  );
  const callsByUser = new Map(
    (await db().select({ u: schema.llmCalls.userId, n: count() }).from(schema.llmCalls).where(gte(schema.llmCalls.createdAt, new Date(Date.now() - 30 * 86_400_000))).groupBy(schema.llmCalls.userId)).map((r) => [r.u, Number(r.n)]),
  );
  const [tokens] = await db()
    .select({ input: sql<number>`coalesce(sum(${schema.llmCalls.inputTokens}),0)`, output: sql<number>`coalesce(sum(${schema.llmCalls.outputTokens}),0)` })
    .from(schema.llmCalls)
    .where(gte(schema.llmCalls.createdAt, new Date(Date.now() - 30 * 86_400_000)));
  const waitlist = await listWaitlist();
  const checks = await systemChecks();

  const by = (st: string) => users.filter((u) => u.subscriptionStatus === st).length;
  const mrr = users
    .filter((u) => u.subscriptionStatus === "active" || u.subscriptionStatus === "past_due")
    .reduce((sum, u) => {
      const p = planById(u.plan);
      return sum + (p ? (u.billingInterval === "year" ? p.yearly : p.monthly) : 0);
    }, 0);
  const stats = [
    { label: "Accounts", value: users.length },
    { label: "In trial", value: by("trialing") },
    { label: "Paying", value: by("active") + by("past_due") },
    { label: "Payment failed", value: by("past_due") },
    { label: "Estimated MRR", value: `$${mrr.toLocaleString("en-US")}` },
    { label: "Waitlist", value: waitlist.length },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-4 px-4">
          <Link href="/calendar" className="flex items-center gap-2"><Logo size={22} /><span className="font-semibold">PostFlow</span></Link>
          <span className="badge">Admin</span>
          <Link href="/calendar" className="btn btn-ghost btn-sm ml-auto">Back to app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] space-y-8 px-4 py-8">
        {sp.ok && <p role="status" className="rounded-md bg-[var(--good-soft)] px-3 py-2 text-[13px] text-[var(--good)]">{sp.ok}</p>}
        {sp.error && <p role="alert" className="rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{sp.error}</p>}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="panel p-4">
              <div className="text-[12px] text-[var(--muted)]">{s.label}</div>
              <div className="mt-1 text-[22px] font-semibold tnum">{s.value}</div>
            </div>
          ))}
        </section>
        <p className="-mt-5 text-[12px] text-[var(--subtle)]">MRR counts active and past-due subscriptions at list price (yearly plans per month), before discounts, tax and fees. Model usage in the last 30 days: {Number(tokens.input).toLocaleString("en-US")} input and {Number(tokens.output).toLocaleString("en-US")} output tokens.</p>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Accounts</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="text-[12px] text-[var(--muted)]">
                <tr className="border-b border-[var(--line)]">
                  <th className="p-3 font-medium">Email</th><th className="p-3 font-medium">Plan</th><th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Posts this month</th><th className="p-3 font-medium">Model calls (30 d)</th><th className="p-3 font-medium">Telegram</th><th className="p-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const e = entitlementOf(u);
                  return (
                    <tr key={u.id} className="border-b border-[var(--line)] last:border-0">
                      <td className="p-3"><div className="font-medium">{u.email}</div><div className="text-[12px] text-[var(--subtle)]">{u.name}{u.emailVerifiedAt ? "" : " · email not confirmed"}</div></td>
                      <td className="p-3">{u.isOwner ? "Owner" : planById(u.plan)?.name ?? "None"}{u.billingInterval && !u.isOwner ? ` · ${u.billingInterval === "year" ? "yearly" : "monthly"}` : ""}</td>
                      <td className="p-3"><span className={`badge ${e.active ? "badge-good" : ""}`}>{u.isOwner ? "owner" : u.subscriptionStatus ?? "no plan"}</span>{u.cancelAtPeriodEnd && <span className="ml-1 text-[12px] text-[var(--warn)]">cancels</span>}</td>
                      <td className="p-3 tnum">{postsByUser.get(u.id) ?? 0}{e.active && e.plan !== "owner" ? ` / ${e.quota.postsPerMonth}` : ""}</td>
                      <td className="p-3 tnum">{callsByUser.get(u.id) ?? 0}</td>
                      <td className="p-3">{u.telegramChatId ? "linked" : ""}</td>
                      <td className="p-3 text-[var(--muted)]">{DateTime.fromJSDate(u.createdAt).toFormat("d LLL yyyy")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">System</h2>
          <ul className="panel divide-y divide-[var(--line)] text-[13px]">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-3 p-3">
                <span className={c.ok ? "text-good" : c.critical ? "text-bad" : "text-warn"}>{c.ok ? "✓" : "●"}</span>
                <div><span className="font-medium">{c.label}</span>{!c.ok && <p className="text-[var(--muted)]">{c.hint}</p>}</div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={telegramWebhookAction}><button className="btn">Register Telegram webhook</button></form>
            <form action={adminTickAction}><button className="btn">Run one scheduler pass (all users)</button></form>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Waitlist <span className="text-sm font-normal text-[var(--muted)]">· {waitlist.length}</span></h2>
          <ul className="panel divide-y divide-[var(--line)] text-[13px]">
            {waitlist.map((w) => (
              <li key={w.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{w.email}</div>
                  <div className="truncate text-[12px] text-[var(--muted)]">{[w.plan && `${w.plan[0].toUpperCase()}${w.plan.slice(1)} plan`, w.role].filter(Boolean).join(" · ") || "No plan picked"}</div>
                </div>
                <span className="text-[12px] text-[var(--muted)]">{DateTime.fromJSDate(w.createdAt).toRelative()}</span>
              </li>
            ))}
            {!waitlist.length && <li className="p-3 text-[var(--muted)]">No sign-ups yet.</li>}
          </ul>
        </section>
      </main>
    </div>
  );
}
