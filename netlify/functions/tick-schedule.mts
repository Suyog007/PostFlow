// Netlify scheduled function: every 5 minutes, start the background scheduler pass.
// Scheduled functions only run on the published production deploy.
export default async () => {
  // APP_URL first: Netlify's own URL can be the http:// address, and the redirect to https
  // drops the Authorization header, so the background function would never run.
  const base = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "").replace(/^http:\/\//, "https://");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.warn("tick-schedule: APP_URL or CRON_SECRET missing");
    return;
  }
  const res = await fetch(`${base}/.netlify/functions/tick-background`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    redirect: "manual",
  });
  // Background functions answer 202 when accepted.
  if (res.status !== 202) console.warn("tick-schedule: background pass not accepted", res.status, res.headers.get("location") ?? "");
  else console.warn("tick-schedule: background pass started");
};

export const config = { schedule: "*/5 * * * *" };
