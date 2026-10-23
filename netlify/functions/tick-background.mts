// Netlify background function: runs one scheduler pass (publish, collect, write, review).
// Background functions may run for up to 15 minutes, which a normal request (~30 s) cannot.
import { fillNowForUser, tick } from "../../src/server/tick";

export default async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || got !== secret) {
    console.warn("tick-background: unauthorized call ignored");
    return;
  }
  // "Fill now" from the calendar sends the account to fill; the scheduler sends an empty body.
  const body = (await req.json().catch(() => ({}))) as { fillUserId?: string };
  if (typeof body.fillUserId === "string" && /^[0-9a-f-]{36}$/i.test(body.fillUserId)) {
    try {
      const r = await fillNowForUser(body.fillUserId, { budgetMs: 12 * 60_000 });
      console.warn("fill", JSON.stringify(r));
    } catch (err) {
      console.error("fill failed", (err as Error).message);
    }
    return;
  }
  try {
    const result = await tick({ budgetMs: 12 * 60_000 }); // background functions may run for 15 minutes
    console.warn("tick", JSON.stringify(result));
  } catch (err) {
    console.error("tick failed", (err as Error).message);
  }
};
