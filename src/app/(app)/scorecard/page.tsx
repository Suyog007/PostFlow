import { requireUser } from "@/server/auth";
import { scorecard } from "@/server/metrics";
import { getUserPreferences } from "@/server/preferences";
import { Badge, Empty, Notice, PageHeader, PlatformBadge, Section } from "@/components/ui";

const FORMAT_LABEL: Record<string, string> = {
  post: "Post",
  thread: "Thread",
  carousel: "Carousel",
  whatif: "What if…",
  contrarian: "Contrarian",
  takeaways: "3 takeaways",
  quote_take: "Quote + take",
  question: "Question close",
};

export default async function ScorecardPage() {
  const userId = await requireUser();
  const [rows, prefs] = await Promise.all([scorecard(userId), getUserPreferences(userId)]);
  const withMetrics = rows.filter((r) => r.withMetrics > 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const best = [...withMetrics].sort((a, b) => (b.avgReposts ?? 0) + (b.avgReplies ?? 0) - ((a.avgReposts ?? 0) + (a.avgReplies ?? 0)))[0];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Scorecard"
        subtitle="What actually got read, by engagement format. X numbers refresh automatically; LinkedIn numbers come from what you enter on each published post."
      />

      {rows.length === 0 ? (
        <Empty>
          Nothing published yet. Once posts go out, this page answers &ldquo;which formats earn replies?&rdquo; — and only formats with real numbers should change your habits.
        </Empty>
      ) : (
        <>
          {best && withMetrics.length >= 2 && (
            <Notice tone="accent">
              Strongest so far: <strong>{FORMAT_LABEL[best.format] ?? best.format}</strong> on {best.platform === "x" ? "X" : "LinkedIn"} — averaging{" "}
              {(best.avgReposts ?? 0).toFixed(1)} reposts and {(best.avgReplies ?? 0).toFixed(1)} replies per post. Small samples lie; treat patterns after ~10 posts.
            </Notice>
          )}

          <Section title="By format">
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="p-3">Platform</th>
                    <th className="p-3">Format</th>
                    <th className="p-3 text-right">Posts</th>
                    <th className="p-3 text-right">With data</th>
                    <th className="p-3 text-right">Avg likes</th>
                    <th className="p-3 text-right">Avg reposts</th>
                    <th className="p-3 text-right">Avg replies</th>
                    <th className="p-3 text-right">Avg impressions</th>
                    <th className="p-3 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.platform}:${r.format}`} className="border-b border-line last:border-0">
                      <td className="p-3">
                        <PlatformBadge platform={r.platform} />
                      </td>
                      <td className="p-3">
                        <Badge tone={r.format === "post" ? "neutral" : "accent"}>{FORMAT_LABEL[r.format] ?? r.format}</Badge>
                      </td>
                      <td className="p-3 text-right tabular-nums">{r.posts}</td>
                      <td className="p-3 text-right tabular-nums">{r.withMetrics}</td>
                      <td className="p-3 text-right tabular-nums">{r.avgLikes ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.avgReposts ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.avgReplies ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.avgImpressions?.toLocaleString() ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">{r.totalCostUsd > 0 ? `$${r.totalCostUsd.toFixed(3)}` : "free"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Window: last 90 days. X costs are estimates from the API price list ($0.015/text, ~$0.20/link, $0.005/media). LinkedIn posting is free. Total estimated platform spend:{" "}
              <strong>${totalCost.toFixed(3)}</strong>.
            </p>
          </Section>

          <Section title="Reading this honestly">
            <ul className="card space-y-2 p-4 text-sm text-muted">
              <li>• Engagement measures reach, not value. The bar is &ldquo;content that would exist without the metric.&rdquo;</li>
              <li>• Reposts and replies weigh more than likes on X (the ranker weights replies ~10× a like).</li>
              <li>• LinkedIn carousels and X threads are the formats worth repeating when they earn replies.</li>
              <li>• Format tags come from how a post was written (the &ldquo;Make it…&rdquo; presets in Drafts).</li>
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
