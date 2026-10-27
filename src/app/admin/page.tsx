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
  // Where people come from: sign-ups (not the owner) and waitlist entries, by the source remembered at their first visit.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const sources = new Map<string, { signups: number; confirmed: number; waitlist: number; week: number }>();
  const tally = (src: string | null, at: Date, field: "signups" | "waitlist", confirmed = false) => {
    const key = src || "unknown";
    const row = sources.get(key) ?? { signups: 0, confirmed: 0, waitlist: 0, week: 0 };
    row[field]++;
    if (confirmed) row.confirmed++;
    if (at.getTime() >= weekAgo) row.week++;
    sources.set(key, row);
  };
  for (const u of users) if (!u.isOwner) tally(u.signupSource, u.createdAt, "signups", !!u.emailVerifiedAt);
  for (const w of waitlist) tally(w.source, w.createdAt, "waitlist");
  const sourceRows = [...sources.entries()].sort((a, b) => b[1].signups + b[1].waitlist - (a[1].signups + a[1].waitlist));
  const newThisWeek = users.filter((u) => !u.isOwner && u.createdAt.getTime() >= weekAgo).length;

  const stats = [
    { label: "Accounts", value: users.length },
    { label: "New this week", value: newThisWeek },
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
          <Link href="/calendar" className="flex items-center gap-2"><Logo size={22} /><span className="display text-[20px]">PostFlow</span></Link>
          <span className="badge">Admin</span>
          <Link href="/calendar" className="btn btn-ghost btn-sm ml-auto">Back to app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] space-y-8 px-4 py-8">
        <h1 className="display text-[34px]">Admin</h1>
        {sp.ok && <p role="status" className="rounded-md bg-[var(--good-soft)] px-3 py-2 text-[13px] text-[var(--good)]">{sp.ok}</p>}
        {sp.error && <p role="alert" className="rounded-md bg-[var(--bad-soft)] px-3 py-2 text-[13px] text-[var(--bad)]">{sp.error}</p>}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((s) => (
            <div key={s.label} className="panel p-4">
              <div className="text-[12px] text-[var(--muted)]">{s.label}</div>
              <div className="mt-1 text-[22px] font-semibold tnum">{s.value}</div>
            </div>
          ))}
        </section>
        <p className="-mt-5 text-[12px] text-[var(--subtle)]">MRR counts active and past-due subscriptions at list price (yearly plans per month), before discounts, tax and fees. Model usage in the last 30 days: {Number(tokens.input).toLocaleString("en-US")} input and {Number(tokens.output).toLocaleString("en-US")} output tokens.</p>

        <section>
          <h2 className="display mb-3 text-[24px]">Accounts</h2>
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
                      <td className="p-3"><div className="font-medium">{u.email}</div><div className="text-[12px] text-[var(--subtle)]">{[u.name, u.signupSource && `from ${u.signupSource}`, !u.emailVerifiedAt && "email not confirmed"].filter(Boolean).join(" · ")}</div></td>
                      <td className="p-3">{u.isOwner ? "Owner" : e.plan === "beta" ? "Free beta" : planById(u.plan)?.name ?? "None"}{u.billingInterval && !u.isOwner ? ` · ${u.billingInterval === "year" ? "yearly" : "monthly"}` : ""}</td>
                      <td className="p-3"><span className={`badge ${e.active ? "badge-good" : ""}`}>{u.isOwner ? "owner" : e.plan === "beta" ? "beta" : u.subscriptionStatus ?? "no plan"}</span>{u.cancelAtPeriodEnd && <span className="ml-1 text-[12px] text-[var(--warn)]">cancels</span>}</td>
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
          <h2 className="display mb-1 text-[24px]">Where people come from</h2>
          <p className="mb-3 text-[13px] text-[var(--muted)]">
            From the first visit before signing up: a <code>?ref=</code> tag on the link if it had one, otherwise the site they clicked through from. Share links like <code>/?ref=reddit</code> to tell communities apart. Visitor numbers are in Cloudflare Web Analytics.
          </p>
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Sign-ups</th><th className="p-3 font-medium">Confirmed email</th><th className="p-3 font-medium">Waitlist</th><th className="p-3 font-medium">Last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map(([src, r]) => (
                  <tr key={src} className="border-b border-[var(--line)] last:border-0">
                    <td className="p-3 font-medium">{src}</td>
                    <td className="p-3 tnum">{r.signups}</td>
                    <td className="p-3 tnum">{r.confirmed}</td>
                    <td className="p-3 tnum">{r.waitlist}</td>
                    <td className="p-3 tnum">{r.week}</td>
                  </tr>
                ))}
                {!sourceRows.length && (
                  <tr><td colSpan={5} className="p-3 text-[var(--muted)]">Nobody has signed up yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="display mb-3 text-[24px]">System</h2>
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
          <h2 className="display mb-3 text-[24px]">Waitlist <span className="text-sm font-normal text-[var(--muted)]">· {waitlist.length}</span></h2>
          <ul className="panel divide-y divide-[var(--line)] text-[13px]">
            {waitlist.map((w) => (
              <li key={w.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{w.email}</div>
                  <div className="truncate text-[12px] text-[var(--muted)]">{[w.plan && `${w.plan[0].toUpperCase()}${w.plan.slice(1)} plan`, w.role, w.source && `from ${w.source}`].filter(Boolean).join(" · ") || "No plan picked"}</div>
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
