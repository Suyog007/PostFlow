// Netlify background function: runs one scheduler pass (publish, collect, write, review).
// Background functions may run for up to 15 minutes, which a normal request (~30 s) cannot.
import { tick } from "../../src/server/tick";

export default async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || got !== secret) {
    console.warn("tick-background: unauthorized call ignored");
    return;
  }
  try {
    const result = await tick({ budgetMs: 12 * 60_000 }); // background functions may run for 15 minutes
    console.warn("tick", JSON.stringify(result));
  } catch (err) {
    console.error("tick failed", (err as Error).message);
  }
};
