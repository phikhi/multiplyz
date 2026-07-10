import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { worlds } from "@/lib/db/schema";
import { buildWorldTheme, type WorldTheme } from "@/lib/game/world-theme";
import { PaletteError } from "@/lib/worldgen/palette";
import { worldPassedQa } from "@/lib/worldgen/worker";

/**
 * **Projection de lecture parent** des mondes en attente d'approbation (story 7.9, WORLDGEN §6).
 * Consommateur de l'écran `app/parent/(espace)/mondes` — ferme l'impasse laissée par le toggle
 * « Votre approbation » (7.3) : quand la validation parent est activée, les mondes QA-validés
 * restent `buffered` sans jamais s'afficher nulle part ailleurs. Les mutations (`approveWorld`/
 * `rejectWorld`) vivent dans `lib/worldgen/worker.ts` (épic #6, mécanisme de modération) — ce
 * module ne fait QUE la lecture de projection, même séparation que `lib/parent/profiles.ts`
 * (gestion) vs les tables du jeu.
 *
 * **CORRIGÉ (rétro Backend PR #247)** : `status = buffered` **SEUL** ne suffit PAS à identifier un
 * monde « en attente d'approbation » — `generateWorld` (6.3) écrit `status = buffered` **à la
 * génération**, AVANT que `processNextJob` (worker.ts) n'évalue la QA (fenêtre pré-QA/mi-QA, cf.
 * JSDoc `processNextJob`). Sans filtre supplémentaire, un parent pourrait voir (et rejeter/approuver)
 * un monde encore en cours de vérification. Le filtre correct est `status = buffered` **ET**
 * `worldPassedQa` (job `generate_world` `done` pour cet index) — même garde que celle qu'`approveWorld`
 * pose déjà côté écriture, appliquée ICI côté lecture pour ne **jamais exposer** un monde mi-QA au
 * parent (défense en profondeur, en plus de la garde directe posée dans `rejectWorld`).
 */

/** Un monde `buffered` ET QA-validé, prêt à être approuvé/rejeté, avec son thème per-monde. */
export interface PendingWorld {
  /** Clé stable (`world:<index>`) — cible des actions `approveWorld`/`rejectWorld`. */
  readonly id: string;
  /** Position sur la carte infinie (affichage « Monde {n} », MAP §1). */
  readonly index: number;
  /** Thème per-monde déjà validé (accent + refs d'assets, `lib/game/world-theme.ts`) — même
   * garde de sécurité que la carte (`isRenderableAssetRef`) pour un éventuel aperçu image. */
  readonly theme: WorldTheme;
}

/** Colonnes brutes d'un candidat `buffered`, avant filtre QA + construction du thème. */
interface PendingRow {
  readonly id: string;
  readonly index: number;
  readonly theme: string;
  readonly palette: string;
  readonly assetRefs: string;
}

/**
 * Lignes `buffered` **QA-validées** (job `done`, `worldPassedQa`), triées par `world_index`
 * croissant (ordre de carte, déterministe) — source de vérité **unique** partagée par
 * `listPendingWorlds`/`countPendingWorlds` (un seul filtre à maintenir, jamais deux définitions de
 * « en attente » qui pourraient diverger).
 */
function qaPassedBufferedRows(db: AppDatabase): PendingRow[] {
  return db
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
    .all()
    .filter((row) => worldPassedQa(db, row.index));
}

/**
 * Liste les mondes **en attente d'approbation** (`status = buffered` ET QA-validé, cf. JSDoc
 * module). Un monde dont la palette/les refs d'assets seraient **corrompues** (`PaletteError`, ne
 * devrait jamais arriver — écrites uniquement par le générateur, WORLDGEN §7 write-then-gate) est
 * **silencieusement exclu** plutôt que de faire planter tout l'écran : un seul monde malformé ne
 * doit jamais bloquer l'approbation des autres (même doctrine de tolérance que `readAssetRef`,
 * `world-theme.ts` — un défaut de forme ne casse jamais tout le rendu).
 */
export function listPendingWorlds(db: AppDatabase): PendingWorld[] {
  const pending: PendingWorld[] = [];
  for (const row of qaPassedBufferedRows(db)) {
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
 * Compte les mondes **en attente d'approbation** (même filtre QA-passé que `listPendingWorlds`,
 * **même source** `qaPassedBufferedRows` — jamais deux définitions divergentes de « en attente »).
 * Consommé par le tableau de bord parent (lien « Mondes à valider » avec repère de compte,
 * découvrabilité de l'impasse #231).
 */
export function countPendingWorlds(db: AppDatabase): number {
  return qaPassedBufferedRows(db).length;
}
