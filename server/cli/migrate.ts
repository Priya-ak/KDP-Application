import { existsSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { createDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const db = await createDb(loadConfig());
const result = await migrate(db);
console.log(`Applied: ${result.applied.join(", ") || "none"}; already applied: ${result.alreadyApplied.length}`);
await db.close();
