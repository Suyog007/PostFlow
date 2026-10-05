/** Rough X API cost of publishing a revision. Conservative on links ($0.20 any post with a URL). */
export function xCostEstimate(parts: string[], mediaCount: number, linkInReply: boolean) {
  const hasUrl = (t: string) => /https?:\/\//.test(t);
  const links = parts.some(hasUrl);
  let cost = 0;
  if (linkInReply && links) {
    // URLs are stripped from the text posts; the final reply carries them.
    cost += parts.length * 0.015;
    cost += 0.2;
  } else {
    for (const p of parts) cost += hasUrl(p) ? 0.2 : 0.015;
  }
  cost += Math.min(mediaCount, 4) * 0.005;
  return Math.round(cost * 1000) / 1000;
}
