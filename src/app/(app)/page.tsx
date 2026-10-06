import Link from "next/link";
import { DateTime } from "luxon";
import { requireUser } from "@/server/auth";
import { getUserPreferences } from "@/server/preferences";
import { llmConfigured } from "@/server/llm";
import { accounts, activeJob, attention, lastDiscoveryRun, latestBriefing, readyQueue, upcoming } from "@/server/queries";
import { platformSlotContext } from "@/server/drafts/service";
import { suggestSlot, type SlotContext } from "@/server/scheduling/rules";
import { db } from "@/server/db/client";
import { BriefingRow } from "@/components/briefing-row";
import { ReadyCard } from "@/components/ready-card";
import { Notice, PlatformBadge, StatusBadge } from "@/components/ui";
import { ActionButton, ActionForm, AutoRefresh } from "@/components/client";
import { runDiscoveryAction, researchTopicAction } from "@/app/actions";
import { firstLine, fmtDateTime, fmtRelative, platformName } from "@/lib/format";

export default async function HomePage() {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const tz = prefs.timezone;
  const ai = llmConfigured() && prefs.llm.enabled;
  const [ready, brief, att, next, job, lastRun, accts] = await Promise.all([
    readyQueue(userId),
    latestBriefing(),
    attention(userId),
    upcoming(userId, 6),
    activeJob(),
    lastDiscoveryRun(),
    accounts(userId),
  ]);

  // Predict when each "Approve" would post, spreading several approvals across open slots.
  const now = new Date();
  const ctxs: Partial<Record<"linkedin" | "x", SlotContext>> = {};
  const when = new Map<string, string>();
  for (const g of ready) {
    for (const d of g.drafts) {
      if (prefs.approval.mode === "now") {
        when.set(d.id, "post now");
        continue;
      }
      ctxs[d.platform] ??= await platformSlotContext(db(), userId, d.platform, now);
      const ctx = ctxs[d.platform]!;
      const s = suggestSlot(ctx, d.timeliness, d.freshUntil);
      if (s) {
        ctx.existing.push(s.at);
        when.set(d.id, fmtDateTime(s.at, tz, "ccc h:mm a"));
      } else when.set(d.id, "no open slot");
    }
  }

  const draftedItemIds = new Set(ready.map((g) => g.itemId).filter(Boolean));
  const moreIdeas = (brief?.items ?? []).filter((i) => i.status !== "dismissed" && !draftedItemIds.has(i.id) && !i.drafts.some((d) => !["rejected", "cancelled"].includes(d.status)));
  const needed = new Set(ready.flatMap((g) => g.drafts.map((d) => d.platform)));
  const notConnected = [...needed].filter((p) => !accts.some((a) => a.platform === p && a.status === "connected"));
  const problems = att.problems.length + att.accountErrors.length;
  const stats = lastRun?.stats as { llm?: string; llmError?: string } | undefined;
  const h = DateTime.now().setZone(tz).hour;

  return (
    <div className="max-w-5xl">
      {job && <AutoRefresh everyMs={5000} />}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}</h1>
          <p className="mt-1 text-sm text-muted">
            {ready.length > 0
              ? `${ready.length} post${ready.length > 1 ? "s" : ""} ready for you. Approve what you like and reject the rest.`
              : "Nothing waiting for approval right now."}
          </p>
        </div>
        {job ? (
          <span className="text-sm text-muted">Finding and writing new posts… (2–4 min)</span>
        ) : (
          <ActionButton action={runDiscoveryAction} className="btn-secondary" pendingText="Starting…">
            Find new ideas
          </ActionButton>
        )}
      </div>

      {!ai && <Notice tone="warn">AI is off (no Fireworks key, or disabled in Settings), so posts can&apos;t be suggested or written.</Notice>}
      {stats?.llm && !["ok", "not_configured"].includes(stats.llm) && <Notice tone="warn">The last run stopped early: {stats.llmError ?? stats.llm}</Notice>}
      {notConnected.length > 0 && (
        <Notice tone="warn">
          {notConnected.map(platformName).join(" and ")} {notConnected.length > 1 ? "aren't" : "isn't"} connected yet. Approved posts will wait and fail at their time until you{" "}
          <Link href="/settings" className="underline">connect {notConnected.length > 1 ? "them" : "it"}</Link>.
        </Notice>
      )}

      {problems > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-bad">Needs fixing</h2>
          <ul className="card divide-y divide-line">
            {att.accountErrors.map((a) => (
              <li key={a.id}>
                <Link href="/settings" className="flex items-center gap-2 p-3 text-sm hover:bg-paper">
                  <PlatformBadge platform={a.platform} /> Connection problem: {a.lastError}
                </Link>
              </li>
            ))}
            {att.problems.map((p) => (
              <li key={p.id}>
                <Link href={`/drafts/${p.draftId}`} className="flex flex-wrap items-center gap-2 p-3 text-sm hover:bg-paper">
                  <PlatformBadge platform={p.platform} />
                  <StatusBadge status={p.state} />
                  <span className="min-w-0 flex-1 truncate">{firstLine(p.parts, 70)}</span>
                  <span className="text-xs text-bad">{p.lastError ?? p.reviewReason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-10">
          <section>
            {ready.length > 0 ? (
              <div className="space-y-5">
                {ready.slice(0, 4).map((g) => (
                  <ReadyCard key={g.key} group={g} whenLabel={(id) => when.get(id) ?? "next slot"} />
                ))}
                {ready.length > 4 && (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-accent hover:underline">
                      Show {ready.length - 4} more ready post{ready.length - 4 > 1 ? "s" : ""}
                    </summary>
                    <div className="mt-5 space-y-5">
                      {ready.slice(4).map((g) => (
                        <ReadyCard key={g.key} group={g} whenLabel={(id) => when.get(id) ?? "next slot"} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="card p-6 text-sm text-muted">
                {job
                  ? "Looking for new developments and writing posts. This page updates by itself."
                  : ai
                    ? "No suggested posts waiting. Press Find new ideas, or pick one of the ideas below to write about."
                    : "Turn on AI to get suggested posts."}
              </div>
            )}
          </section>

          {moreIdeas.length > 0 && (
            <section>
              <h2 className="mb-1 text-base font-semibold">More ideas</h2>
              <p className="mb-3 text-sm text-muted">Not written yet. Press Write post if one is worth sharing.</p>
              <ul className="card divide-y divide-line">
                {moreIdeas.map((it) => (
                  <BriefingRow key={it.id} item={it} tz={tz} aiEnabled={ai} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Going out</h2>
              <Link href="/calendar" className="text-xs text-muted hover:text-ink">
                Calendar →
              </Link>
            </div>
            {next.length ? (
              <ul className="card divide-y divide-line">
                {next.map((s) => (
                  <li key={s.id}>
                    <Link href={`/drafts/${s.draftId}`} className="block p-3 text-sm hover:bg-paper">
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <PlatformBadge platform={s.platform} />
                        <span className="font-medium">{fmtDateTime(s.scheduledAt, tz)}</span>
                      </div>
                      <div className="truncate text-muted">{firstLine(s.parts, 60)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing scheduled. Approved posts appear here.</p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Want a post about something specific?</h2>
            <ActionForm action={researchTopicAction} className="space-y-2" pendingText="Researching… ~45s">
              <input name="topic" className="input" placeholder="e.g. Nepal fintech regulation" required minLength={3} />
              <button className="btn-secondary w-full" type="submit">
                Research it
              </button>
            </ActionForm>
          </section>

          {lastRun?.finishedAt && <p className="text-xs text-muted">Sources last checked {fmtRelative(lastRun.finishedAt, tz)}.</p>}
        </aside>
      </div>
    </div>
  );
}
