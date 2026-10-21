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
  const result = await tick();
  console.log("tick", JSON.stringify(result));
};
