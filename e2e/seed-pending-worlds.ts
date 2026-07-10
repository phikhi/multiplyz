/**
 * **Amorçage E2E de mondes en attente d'approbation** (story 7.9, issue #231). Le worker daemon
 * n'est jamais lancé en E2E (aucun job réel généré) — sans amorçage direct, aucun monde `buffered`
 * n'existerait jamais pour exercer l'écran `/parent/mondes` (liste + approuver + rejeter + état
 * vide). Même patron que `seed-sibling.ts`/`seed-world-assets.ts` : insertion **directe** en base,
 * **DANS la chaîne `webServer`** (`seed-pending-worlds.cli.ts`, APRÈS `db:migrate` et AVANT
 * `next dev`) → **même contexte** (cwd + `DATABASE_PATH` via `resolveDatabasePath`) que le serveur
 * qui lira la base. Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de
 * paths Next. **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe
 * librement les constantes.
 *
 * `world_index` **hors de la fenêtre de buffer réelle** (9998/9999, très au-delà de tout index que
 * le parcours `auth.spec.ts` atteint en jouant) — zéro collision avec le monde socle[0]/carte du
 * profil `Léa` amorcé par l'onboarding, aucun risque de faire dérailler `ensureBuffer`/`resolveWorld`.
 * `assetRefs` reste le schéma **placeholder** (comme le socle avant gate owner, LEARNINGS) :
 * `background/tiles/teddy` résolvent `null` côté `buildWorldTheme` → repli **accent + nom** exercé
 * (état le plus fréquent en pratique, cf. `world-approval.test.ts` pour le cas assets réels).
 */
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/db/config";

/** Un monde `buffered` amorcé pour l'E2E (id/thème/accent stables, réutilisés par les assertions). */
export interface SeededPendingWorld {
  readonly id: string;
  readonly index: number;
  readonly theme: string;
  readonly accent: string;
}

export const PENDING_WORLD_A: SeededPendingWorld = {
  id: "world:e2e-pending-a",
  index: 9998,
  theme: "Forêt enchantée",
  accent: "#4CAF50",
};
export const PENDING_WORLD_B: SeededPendingWorld = {
  id: "world:e2e-pending-b",
  index: 9999,
  theme: "Océan scintillant",
  accent: "#2196F3",
};

function assetRefsPlaceholder(slug: string): string {
  return JSON.stringify({
    background: `placeholder://socle/${slug}/background`,
    tiles: `placeholder://socle/${slug}/tiles`,
    teddy: `placeholder://socle/${slug}/teddy`,
  });
}

/**
 * Insère les mondes en attente **+ leur job `generate_world` `done`** (idempotent — `INSERT OR
 * IGNORE` par PK, un rejeu de la chaîne `webServer` ne duplique rien). Le job `done` est
 * **requis** : `approveWorld` (WORLDGEN §6, garde `worldPassedQa`) refuse d'approuver un monde
 * sans job `done` pour son index — sans lui, l'écran `/parent/mondes` afficherait les mondes mais
 * TOUTE approbation échouerait en E2E (`WorldModerationError` « non QA-validé »).
 */
export function seedPendingWorlds(): void {
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    const insertWorld = db.prepare(
      `INSERT OR IGNORE INTO worlds
         (id, world_index, theme, palette, asset_refs, prompt, seed, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'buffered', unixepoch())`,
    );
    // Un job `done` = preuve de QA réussie (`worldPassedQa`, worker.ts) — sans lui, `approveWorld`
    // refuse (garde WORLDGEN §6 AC3 « jamais de monde non-QA en active »).
    const insertDoneJob = db.prepare(
      `INSERT INTO jobs (type, payload, status) VALUES ('generate_world', ?, 'done')`,
    );
    const hasDoneJob = db.prepare(
      `SELECT 1 FROM jobs WHERE type = 'generate_world' AND status = 'done'
         AND json_extract(payload, '$.worldIndex') = ? LIMIT 1`,
    );
    for (const world of [PENDING_WORLD_A, PENDING_WORLD_B]) {
      const slug = world.id.replace("world:", "");
      insertWorld.run(
        world.id,
        world.index,
        world.theme,
        JSON.stringify({ slug, accent: world.accent }),
        assetRefsPlaceholder(slug),
        `e2e pending world "${world.theme}"`,
        `seed-${slug}`,
      );
      if (hasDoneJob.get(world.index) === undefined) {
        insertDoneJob.run(JSON.stringify({ worldIndex: world.index }));
      }
    }
  } finally {
    db.close();
  }
}
