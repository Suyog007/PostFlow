// Netlify scheduled function: every 5 minutes, start the background scheduler pass.
// Scheduled functions only run on the published production deploy.
export default async () => {
  const base = process.env.URL; // set by Netlify to the site's main URL
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.warn("tick-schedule: URL or CRON_SECRET missing");
    return;
  }
  const res = await fetch(`${base}/.netlify/functions/tick-background`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  console.log("tick-schedule: background pass requested", res.status);
};

export const config = { schedule: "*/5 * * * *" };
