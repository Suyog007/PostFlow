import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, closeDb } from "../src/server/db/client";
import { loadDotEnv } from "./load-env";

loadDotEnv();
await migrate(db(), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
await closeDb();
