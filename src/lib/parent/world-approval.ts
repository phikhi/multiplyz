import { asc, count, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { worlds } from "@/lib/db/schema";
import { buildWorldTheme, type WorldTheme } from "@/lib/game/world-theme";
import { PaletteError } from "@/lib/worldgen/palette";

/**
 * **Projection de lecture parent** des mondes en attente d'approbation (story 7.9, WORLDGEN §6).
 * Consommateur de l'écran `app/parent/(espace)/mondes` — ferme l'impasse laissée par le toggle
 * « Votre approbation » (7.3) : quand la validation parent est activée, les mondes QA-validés
 * restent `buffered` sans jamais s'afficher nulle part ailleurs. Les mutations (`approveWorld`/
 * `rejectWorld`) vivent dans `lib/worldgen/worker.ts` (épic #6, mécanisme de modération) — ce
 * module ne fait QUE la lecture de projection, même séparation que `lib/parent/profiles.ts`
 * (gestion) vs les tables du jeu.
 */

/** Un monde `buffered` prêt à être approuvé/rejeté, avec son thème per-monde pour l'aperçu. */
export interface PendingWorld {
  /** Clé stable (`world:<index>`) — cible des actions `approveWorld`/`rejectWorld`. */
  readonly id: string;
  /** Position sur la carte infinie (affichage « Monde {n} », MAP §1). */
  readonly index: number;
  /** Thème per-monde déjà validé (accent + refs d'assets, `lib/game/world-theme.ts`) — même
   * garde de sécurité que la carte (`isRenderableAssetRef`) pour un éventuel aperçu image. */
  readonly theme: WorldTheme;
}

/**
 * Liste les mondes **en attente d'approbation** (`status = buffered`), triés par `world_index`
 * croissant (ordre de carte, déterministe). Un monde dont la palette/les refs d'assets seraient
 * **corrompues** (`PaletteError`, ne devrait jamais arriver — écrites uniquement par le
 * générateur, WORLDGEN §7 write-then-gate) est **silencieusement exclu** plutôt que de faire
 * planter tout l'écran : un seul monde malformé ne doit jamais bloquer l'approbation des autres
 * (même doctrine de tolérance que `readAssetRef`, `world-theme.ts` — un défaut de forme ne casse
 * jamais tout le rendu).
 */
export function listPendingWorlds(db: AppDatabase): PendingWorld[] {
  const rows = db
    .select({
      id: worlds.id,
      index: worlds.index,
      theme: worlds.theme,
      palette: worlds.palette,
      assetRefs: worlds.assetRefs,
    })
    .from(worlds)
    .where(eq(worlds.status, "buffered"))
    .orderBy(asc(worlds.index))
    .all();

  const pending: PendingWorld[] = [];
  for (const row of rows) {
    try {
      pending.push({
        id: row.id,
        index: row.index,
        theme: buildWorldTheme({
          theme: row.theme,
          palette: row.palette,
          assetRefs: row.assetRefs,
        }),
      });
    } catch (error) {
      if (!(error instanceof PaletteError)) throw error;
      // Palette corrompue (défense en profondeur) : exclu de la file plutôt que de planter tout
      // l'écran d'approbation — les AUTRES mondes en attente restent approuvables/rejetables.
    }
  }
  return pending;
}

/**
 * Compte les mondes **en attente d'approbation** (`status = buffered`) — consommé par le tableau
 * de bord parent (lien « Mondes à valider » avec repère de compte, discoverabilité de l'impasse
 * #231). Requête d'agrégat dédiée (pas `listPendingWorlds(db).length`) : évite de désérialiser
 * palette/assetRefs de chaque ligne juste pour un compte, sur l'écran consulté le plus souvent.
 */
export function countPendingWorlds(db: AppDatabase): number {
  // `count()` sur un agrégat renvoie TOUJOURS une ligne (jamais NULL, jamais zéro-ligne) → pas de
  // repli `?? 0` défensif (branche inatteignable = non testable, rétro #143 — même patron que
  // `currentMonthSpendEur`, worker.ts).
  return db.select({ n: count() }).from(worlds).where(eq(worlds.status, "buffered")).get()!.n;
}
