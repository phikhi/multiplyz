/** Isolated browser verification household. Never runs against the family's database. */
import { createDatabase } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrate";
import { createHousehold } from "../src/lib/auth/household";
import { generateAllFacts } from "../src/lib/engine/facts";
import { seedDiagnostic } from "../src/lib/engine/service";
import { getEngineConfig } from "../src/config/server-config";
import {
  adventureSessions,
  attempts,
  progress,
  wallet,
  ledger,
  mastery,
  collection,
} from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { seedCanariProfile } from "../e2e/seed-canari";

async function main() {
  if (process.env.DATABASE_PATH !== "data/teddy-companions-check.sqlite")
    throw new Error("Dedicated verification database required");
  const db = createDatabase();
  runMigrations(db);
  await createHousehold(db, { name: "Essai", avatar: "cat", childPin: "1234", parentPin: "9876" });
  const id = await seedCanariProfile();
  for (const table of [adventureSessions, attempts, progress, wallet, ledger, mastery, collection])
    db.delete(table).where(eq(table.profileId, id)).run();
  seedDiagnostic(
    db,
    id,
    generateAllFacts().map((fact, index) => ({
      factKey: fact.key,
      skill: fact.skill,
      correct: index !== 0,
      responseMs: 1500,
    })),
    getEngineConfig(),
    Date.now() - 30 * 86400000,
  );
  db.$client.close();
}
void main();
