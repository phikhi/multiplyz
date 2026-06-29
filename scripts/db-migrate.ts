// CLI `pnpm db:migrate` : applique les migrations versionnées sur la base locale.
// Hors `src/` (pas de coverage) — la logique testée vit dans `src/lib/db/migrate.ts`.
// Idempotent : rejouable sans erreur (Drizzle journalise les migrations appliquées).
import { resolveDatabasePath } from "../src/lib/db/config";
import { createDatabase } from "../src/lib/db/index";
import { runMigrations } from "../src/lib/db/migrate";

const databasePath = resolveDatabasePath();
const db = createDatabase(databasePath);
runMigrations(db);

console.log(`[db:migrate] migrations appliquées sur ${databasePath}`);
