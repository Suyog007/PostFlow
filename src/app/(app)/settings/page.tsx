import { requireUser } from "@/server/auth";
import { getUserPreferences, type PlatformRules } from "@/server/preferences";
import { accounts, recentJobs, sourcesList } from "@/server/queries";
import { isPlatformConfigured, redirectUri } from "@/server/platforms/accounts";
import { llmConfigured, modelFor, usageSince } from "@/server/llm";
import { imageGenProvider } from "@/server/images/generate";
import { env } from "@/server/env";
import { Badge, Notice, PageHeader, PlatformBadge, Section } from "@/components/ui";
import { ActionButton, ActionForm, WindowsEditor } from "@/components/client";
import {
  addSourceAction,
  connectAction,
  deleteSourceAction,
  disconnectAction,
  saveGeneralAction,
  savePlatformRulesAction,
  setPausedAction,
  toggleSourceAction,
} from "@/app/actions";
import { fmtDateTime, fmtRelative } from "@/lib/format";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const tz = prefs.timezone;
  const { notice, error } = await searchParams;
  const [accts, sources, jobs, usage24, usage30] = await Promise.all([
    accounts(userId),
    sourcesList(),
    recentJobs(12),
    usageSince(new Date(Date.now() - 24 * 3_600_000)),
    usageSince(new Date(Date.now() - 30 * 86_400_000)),
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="Accounts, publishing rules, research preferences, sources, and AI usage." />
      {notice && <Notice tone="good">{notice}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}

      <Section title="Connected accounts">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["linkedin", "x"] as const).map((p) => {
            const a = accts.find((x) => x.platform === p);
            const configured = isPlatformConfigured(p);
            const paused = prefs.platforms[p].paused;
            return (
              <div key={p} className="card space-y-3 p-5 text-sm">
                <div className="flex items-center justify-between">
                  <PlatformBadge platform={p} />
                  {a?.status === "connected" ? <Badge tone="good">Connected</Badge> : a?.status === "error" ? <Badge tone="bad">Needs attention</Badge> : <Badge>Not connected</Badge>}
                </div>
                {a?.status && a.status !== "disconnected" && (
                  <div>
                    <div className="font-medium">{a.displayName || a.handle}</div>
                    <div className="text-xs text-muted">
                      {a.handle} · connected {fmtRelative(a.connectedAt, tz)}
                      {a.expiresAt && ` · token expires ${fmtDateTime(a.expiresAt, tz)}`}
                    </div>
                  </div>
                )}
                {a?.lastError && <p className="text-xs text-bad">{a.lastError}</p>}
                {!configured && (
                  <p className="text-xs text-muted">
                    Add {p === "x" ? "X_CLIENT_ID (and X_CLIENT_SECRET for a confidential client)" : "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET"} to <code>.env</code>. Register this
                    callback URL in the developer app: <code className="break-all">{redirectUri(p)}</code>
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {configured && (
                    <form action={connectAction.bind(null, p)}>
                      <button className="btn-secondary">{a?.status === "connected" ? "Reconnect" : "Connect"}</button>
                    </form>
                  )}
                  {a?.status && a.status !== "disconnected" && (
                    <ActionButton action={disconnectAction.bind(null, p)} className="btn-ghost" confirm="Click again to disconnect">
                      Disconnect
                    </ActionButton>
                  )}
                  <ActionButton action={setPausedAction.bind(null, p, !paused)} className={paused ? "btn-primary" : "btn-ghost"}>
                    {paused ? "Resume publishing" : "Pause publishing"}
                  </ActionButton>
                </div>
                {paused && <p className="text-xs text-warn">Paused: scheduled {p === "x" ? "X" : "LinkedIn"} posts wait and are not published.</p>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Drafting and research work without connected accounts. Publishing uses official APIs only. Tokens are encrypted at rest and never sent to the browser.
        </p>
      </Section>

      <Section title="Publishing rules">
        <div className="grid gap-4 md:grid-cols-2">
          <RulesForm platform="linkedin" rules={prefs.platforms.linkedin} />
          <RulesForm platform="x" rules={prefs.platforms.x} />
        </div>
      </Section>

      <Section title="Research & ranking preferences">
        <div className="card p-5">
          <ActionForm action={saveGeneralAction} className="grid gap-4 sm:grid-cols-2" submit="Save preferences">
            <div className="sm:col-span-2">
              <label className="label">Interests (one per line, weight 0–1; these evolve as you save and dismiss)</label>
              <textarea
                name="interests"
                rows={8}
                className="input font-mono text-xs"
                defaultValue={Object.entries(prefs.interests)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">About me (helps the writer find your perspective; it never invents experiences)</label>
              <textarea name="aboutMe" rows={3} className="input" defaultValue={prefs.aboutMe} placeholder="e.g. Software engineer in Kathmandu interested in AI products and market design." />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Voice rules (injected into every draft; calibrates tone, not facts)</label>
              <textarea
                name="voiceRules"
                rows={3}
                className="input"
                defaultValue={prefs.voiceRules}
                placeholder='e.g. Short sentences. First person. No "excited to share", no hashtags. End with a claim someone can disagree with.'
              />
            </div>
            <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="voiceExemplars" defaultChecked={prefs.voiceExemplars} className="mt-0.5" />
                <span>
                  Calibrate drafts with your recently approved posts
                  <span className="block text-xs text-muted">The writer studies up to 5 of your own posts (picked by topic overlap) as voice examples.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="learnFromFeedback" defaultChecked={prefs.learnFromFeedback} className="mt-0.5" />
                <span>
                  Let approvals and rejections nudge topic weights
                  <span className="block text-xs text-muted">Approving adds ~0.04, rejecting removes ~0.03 from that topic&apos;s interest weight above. Never a hard filter.</span>
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Muted terms (comma separated)</label>
              <input name="mutedTerms" className="input" defaultValue={prefs.mutedTerms.join(", ")} />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input name="timezone" className="input" defaultValue={prefs.timezone} />
            </div>
            <div>
              <label className="label">Discovery runs at (local times, comma separated)</label>
              <input name="autoRunTimes" className="input" defaultValue={prefs.discovery.autoRunTimes.join(", ")} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Ranking weights (must add to 100)</label>
              <div className="grid grid-cols-5 gap-2">
                {(["relevance", "recency", "evidence", "insight", "audience"] as const).map((k) => (
                  <div key={k}>
                    <input name={`w_${k}`} type="number" min={0} max={100} className="input" defaultValue={prefs.weights[k]} />
                    <div className="mt-1 text-center text-xs text-muted">{k}</div>
                  </div>
                ))}
              </div>
            </div>
            <Num name="maxItems" label="Briefing size (max)" value={prefs.briefing.maxItems} />
            <Num name="minScore" label="Minimum score for briefing" value={prefs.briefing.minScore} />
            <Num name="staleNewsDays" label="News goes stale after (days)" value={prefs.briefing.staleNewsDays} />
            <div className="sm:col-span-2 mt-2 border-t border-line pt-4">
              <h3 className="mb-3 font-semibold">Suggested posts</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoDraftEnabled" defaultChecked={prefs.autoDraft.enabled} /> Write posts for the best ideas automatically
                  </label>
                  <label className="label">How many per discovery run</label>
                  <input name="autoDraftPerRun" type="number" min={0} max={10} className="input" defaultValue={prefs.autoDraft.perRun} />
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoCardEnabled" defaultChecked={prefs.images.autoCard} /> Attach a card image when a post has a strong number, quote or list
                  </label>
                  <p className="mt-1 text-xs text-muted">Cards render locally (free); change or remove them on the draft screen.</p>
                </div>
                <div>
                  <label className="label">When I press Approve</label>
                  <select name="approvalMode" className="input" defaultValue={prefs.approval.mode}>
                    <option value="next_slot">Post at the platform&apos;s next open slot</option>
                    <option value="now">Post immediately</option>
                  </select>
                  <p className="mt-1 text-xs text-muted">Open slots follow each platform&apos;s posting windows and limits below.</p>
                </div>
              </div>
            </div>
            <div className="sm:col-span-2 mt-2 border-t border-line pt-4">
              <h3 className="mb-3 font-semibold">AI usage controls</h3>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="llmEnabled" defaultChecked={prefs.llm.enabled} /> Enable AI analysis and drafting
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <Num name="dailyTokenLimit" label="Daily token limit" value={prefs.llm.dailyTokenLimit} />
                <Num name="dailyBudgetUsd" label="Daily budget (USD, needs prices in .env)" value={prefs.llm.dailyBudgetUsd} step="0.1" />
                <Num name="maxItemsAnalyzedPerRun" label="Items analyzed per run" value={prefs.llm.maxItemsAnalyzedPerRun} />
              </div>
            </div>
          </ActionForm>
        </div>
      </Section>

      <Section title="AI provider">
        <div className="card space-y-1 p-5 text-sm">
          <div>
            Fireworks: {llmConfigured() ? <Badge tone="good">Configured</Badge> : <Badge tone="warn">Not configured</Badge>}
          </div>
          <div className="text-muted">Routine model: {modelFor("routine") ?? "— (set FIREWORKS_MODEL)"}</div>
          <div className="text-muted">Research & drafting model: {modelFor("research") ?? "—"}</div>
          <div className="text-muted">
            Images: cards, carousels and OG previews are rendered locally (free).{" "}
            {imageGenProvider() ? <Badge tone="good">Paid generation on ({imageGenProvider()})</Badge> : <span>Paid AI image generation is off (set BFL_API_KEY or OPENAI_API_KEY to enable; decorative images only, disclose them).</span>}
          </div>
          <div className="pt-2">
            Last 24h: {usage24.calls} calls ({usage24.cachedCalls} served from cache), {(usage24.inputTokens + usage24.outputTokens).toLocaleString()} tokens
            {env().FIREWORKS_PRICE_INPUT_PER_M ? `, ≈$${usage24.estCostUsd.toFixed(3)}` : ""}.
          </div>
          <div>
            Last 30 days: {usage30.calls} calls, {(usage30.inputTokens + usage30.outputTokens).toLocaleString()} tokens
            {env().FIREWORKS_PRICE_INPUT_PER_M ? `, ≈$${usage30.estCostUsd.toFixed(2)}` : " (set FIREWORKS_PRICE_* in .env for cost estimates)"}.
          </div>
        </div>
      </Section>

      <Section title={`Sources (${sources.filter((s) => s.enabled).length} enabled)`}>
        <div className="card divide-y divide-line">
          {sources.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={s.enabled ? "font-medium" : "text-muted line-through"}>{s.name}</span>
                  <Badge>{s.kind === "rss" ? "RSS" : "GitHub"}</Badge>
                  {s.isPrimary && <Badge tone="good">Primary</Badge>}
                  {s.topicHint && <Badge>{s.topicHint}</Badge>}
                </div>
                <div className="truncate text-xs text-muted">
                  {s.kind === "github_search" ? `query: ${(s.config as { query?: string }).query}` : s.url} · every {Math.round(s.pollIntervalMinutes / 60)}h
                  {s.lastPolledAt && ` · polled ${fmtRelative(s.lastPolledAt, tz)}`}
                </div>
                {s.lastError && <div className="text-xs text-bad">{s.lastError}</div>}
              </div>
              <ActionButton action={toggleSourceAction.bind(null, s.id, !s.enabled)} className="btn-ghost text-xs">
                {s.enabled ? "Disable" : "Enable"}
              </ActionButton>
              <ActionButton action={deleteSourceAction.bind(null, s.id)} className="btn-ghost text-xs" confirm="Delete?">
                Delete
              </ActionButton>
            </div>
          ))}
        </div>
        <div className="card mt-4 p-5">
          <h3 className="mb-3 font-semibold">Add a source</h3>
          <ActionForm action={addSourceAction} className="grid gap-3 sm:grid-cols-2" submit="Add source" resetOnSuccess>
            <div>
              <label className="label">Type</label>
              <select name="kind" className="input">
                <option value="rss">RSS / Atom feed</option>
                <option value="github_search">GitHub repository search</option>
              </select>
            </div>
            <div>
              <label className="label">Name</label>
              <input name="name" className="input" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Feed URL, or GitHub search query (supports {"{{days:N}}"})</label>
              <input name="url" className="input" required placeholder="https://example.com/feed  or  topic:llm created:>{{days:14}} stars:>100" />
            </div>
            <div>
              <label className="label">Topic hint</label>
              <input name="topicHint" className="input" placeholder="e.g. Nepal, AI, grants" />
            </div>
            <div>
              <label className="label">Poll every (minutes)</label>
              <input name="poll" type="number" min={30} defaultValue={180} className="input" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="isPrimary" /> Official / primary publisher (company, lab, government)
            </label>
          </ActionForm>
        </div>
      </Section>

      <Section title="Recent background jobs">
        <ul className="card divide-y divide-line text-sm">
          {jobs.map((j) => {
            const st = j.stats as Record<string, unknown>;
            return (
              <li key={j.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={j.status === "succeeded" ? "good" : j.status === "failed" ? "bad" : "accent"}>{j.status}</Badge>
                  <span className="font-medium">{j.kind}</span>
                  <span className="text-xs text-muted">
                    {j.trigger} · {fmtDateTime(j.queuedAt, tz)}
                  </span>
                </div>
                {j.kind === "discovery" && j.status === "succeeded" && (
                  <div className="mt-1 text-xs text-muted">
                    {String(st.sourcesPolled)} sources · {String(st.collected)} collected · {String(st.newItems)} new · {String(st.mergedReports)} grouped · {String(st.filtered)} filtered ·{" "}
                    {String(st.analyzed)} analyzed · {String(st.briefed)} in briefing · AI: {String(st.llm)}
                    {Array.isArray(st.sourceErrors) && st.sourceErrors.length > 0 && ` · ${st.sourceErrors.length} source errors`}
                  </div>
                )}
                {j.error && <div className="mt-1 text-xs text-bad">{j.error}</div>}
              </li>
            );
          })}
          {jobs.length === 0 && <li className="p-3 text-muted">No jobs yet. Start the worker with npm run worker.</li>}
        </ul>
      </Section>
    </div>
  );
}

function Num({ name, label, value, step }: { name: string; label: string; value: number; step?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input name={name} type="number" step={step ?? "1"} min={0} className="input" defaultValue={value} />
    </div>
  );
}

function RulesForm({ platform, rules }: { platform: "linkedin" | "x"; rules: PlatformRules }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <PlatformBadge platform={platform} />
        <span className="text-sm text-muted">{platform === "x" ? "Can be frequent and fast" : "Selective and substantial"}</span>
      </div>
      <ActionForm action={savePlatformRulesAction} className="space-y-3" submit={`Save ${platform === "x" ? "X" : "LinkedIn"} rules`}>
        <input type="hidden" name="platform" value={platform} />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Max / day</label>
            <input name="maxPerDay" type="number" min={0} max={50} className="input" defaultValue={rules.maxPerDay} />
          </div>
          <div>
            <label className="label">Max / week</label>
            <input name="maxPerWeek" type="number" min={0} max={200} className="input" defaultValue={rules.maxPerWeek} />
          </div>
          <div>
            <label className="label">Min gap (h)</label>
            <input name="minIntervalHours" type="number" min={0} step="0.5" className="input" defaultValue={rules.minIntervalMinutes / 60} />
          </div>
        </div>
        <div>
          <label className="label">Preferred posting windows</label>
          <WindowsEditor initial={rules.windows} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="prioritizeTimely" defaultChecked={rules.prioritizeTimely} /> Prioritize timely developments in suggestions
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="allowEvergreenFill" defaultChecked={rules.allowEvergreenFill} /> Suggest approved evergreen posts for quiet periods
        </label>
        {platform === "x" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="linkInReply" defaultChecked={rules.linkInReply} className="mt-0.5" />
            <span>
              Move links into a reply
              <span className="block text-xs text-muted">X demotes posts containing links. The link goes out as the final reply instead — the main post stays cheap and un-demoted, though the reply itself still bills at the ~$0.20 link rate.</span>
            </span>
          </label>
        )}
        <div>
          <label className="label">Style notes for drafts</label>
          <textarea name="styleNotes" rows={2} className="input" defaultValue={rules.styleNotes} placeholder={platform === "x" ? "e.g. punchy, lowercase is fine, no hashtags" : "e.g. 150-200 words, end with a genuine question"} />
        </div>
      </ActionForm>
    </div>
  );
}
