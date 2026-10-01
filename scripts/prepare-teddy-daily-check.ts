/** Fresh isolated household: schema + shared catalogue only, no child/rewards/progression seed. */
import { existsSync } from "node:fs";
import { createDatabase } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrate";
const path = process.argv.includes("--fresh-household")
  ? "data/teddy-daily-fresh-check.sqlite"
  : "data/teddy-daily-check.sqlite";
if (existsSync(path))
  throw new Error("The daily check database already exists; preserve the played journey.");
const db = createDatabase(path);
try {
  runMigrations(db);
  console.log("Prepared isolated empty household", path);
} finally {
  db.$client.close();
}
