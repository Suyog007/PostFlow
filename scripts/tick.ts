import { loadDotEnv } from "./load-env";

loadDotEnv();
const { tick } = await import("../src/server/tick");
const { closeDb } = await import("../src/server/db/client");

const loop = process.argv.includes("--loop");
do {
  const r = await tick();
  console.log(new Date().toISOString(), JSON.stringify(r));
  if (loop) await new Promise((res) => setTimeout(res, 5 * 60_000));
} while (loop);
await closeDb();
