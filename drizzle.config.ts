import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_FOLDER, resolveDatabasePath } from "./src/lib/db/config";

// Config drizzle-kit (génération des migrations versionnées). Le runtime applicatif
// et `pnpm db:migrate` utilisent la connexion de `src/lib/db` (WAL + busy_timeout).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: MIGRATIONS_FOLDER,
  dbCredentials: { url: resolveDatabasePath() },
});
