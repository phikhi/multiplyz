/**
 * **Fixture réaliste partagée dev+E2E** (story R0.1 #323, épic R0 #316 — WORKFLOW §21.b) :
 * remplace l'ancien fixture rayé violet/orange (fond) + carré doré (Teddy) par un VRAI monde socle
 * (illustration kawaii générée + validée gate #181), **dé-échantillonné** et committé sous
 * `test-fixtures/world/socle-sample/` (chemin **non-gitignoré** — distinct de `/public/generated/`
 * qui reste réservé aux assets de PRODUCTION, jamais committés).
 *
 * **Ne touche PAS `resolveWorld`/`buildWorldTheme`** (contrat de résolution PROD inchangé, AC #323) :
 * ce module ne fait qu'écrire, dans une base **dev/E2E locale**, les MÊMES colonnes
 * (`theme`/`palette`/`asset_refs`) que `seedSocleWorlds` amorce déjà au premier lancement — juste
 * avec un contenu **réel** plutôt que placeholder, sur le **slot 0** (le premier monde résolu pour
 * un profil frais, cf. commentaire `resolveWorld`/`seedSocleWorlds`).
 *
 * **Cohérence thème↔art** : le slot 0 amorcé par `seedSocleWorlds` porte un thème/accent dérivés
 * de son PROPRE seed (`socle-world-0`, "Galaxie lointaine") — mais les assets réels committés ici
 * sont ceux du monde **socle slot `BORROWED_SLOT`** ("Forêt enchantée", cf. `_montage.png` local
 * owner). Pour éviter un monde visuellement incohérent (titre « Galaxie » sur un fond de forêt),
 * ce seed réécrit AUSSI `theme`/`palette` du slot 0 avec ceux dérivés du seed **emprunté**
 * (`regenerateSocleContent`, pur/déterministe, même fonction que `buildSocleWorld`) — SEULE la ligne
 * `id`/`slot`/`prompt`/`seed` reste celle du slot 0 (position de résolution inchangée).
 *
 * Idempotent (copie de fichiers + `UPDATE` par `slot`). Import relatif (pas l'alias `@`) : tourne
 * sous `tsx`, hors du résolveur de paths Next — même contrainte que `scripts/db-migrate.ts`.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { regenerateSocleContent, socleSeed } from "../../src/lib/worldgen/socle";

/** Fixture committée (dé-échantillonnée, ~115 Ko au total) — source unique dev+E2E. */
const FIXTURE_SOURCE_DIR = "test-fixtures/world/socle-sample";

/**
 * Slot socle dont on emprunte le thème+palette+art réels (⚙️ constante locale, pas un réglage
 * produit) — "Forêt enchantée" : le plus lisible des 6 mondes locaux owner (tuiles au contraste
 * net, cf. rétro build R0.1). Changer cette valeur change le monde de démo dev/E2E, pas la logique
 * de résolution prod (`resolveWorld` reste intouché).
 */
const BORROWED_SLOT = 4;

export interface SeedRealWorldFixtureOptions {
  /** Chemin du fichier SQLite cible (dev ou E2E — jamais la prod, cf. commentaire de tête). */
  readonly databasePath: string;
  /** Dossier public où copier les 3 fichiers (`public/generated/world/<namespace>`). */
  readonly publicDir: string;
  /** Namespace de ref rendable (`world/e2e`, `world/dev`) — cf. `isRenderableAssetRef`. */
  readonly assetNamespace: string;
  /** Préfixe des logs console (identifie l'appelant : E2E vs dev). */
  readonly logPrefix: string;
}

/**
 * Copie la fixture réaliste committée sous un chemin rendable Next/Nginx puis pointe le slot 0 du
 * socle dessus (thème + palette + assetRefs) — DANS le contexte (cwd + DB) de l'appelant, jamais
 * depuis un process séparé (aucune divergence de chemin possible, même patron que #189/#190).
 */
export function seedRealWorldFixture(options: SeedRealWorldFixtureOptions): void {
  const { databasePath, publicDir, assetNamespace, logPrefix } = options;

  mkdirSync(publicDir, { recursive: true });
  // Les trois assets du monde (fond #189 + tuiles/Teddy #190) — chacun sous une ref RENDABLE
  // (`<namespace>/<name>.jpg`) que `isRenderableAssetRef` accepte (relatif, namespace `world`).
  copyFileSync(`${FIXTURE_SOURCE_DIR}/background.jpg`, `${publicDir}/background.jpg`);
  copyFileSync(`${FIXTURE_SOURCE_DIR}/tiles.jpg`, `${publicDir}/tiles.jpg`);
  copyFileSync(`${FIXTURE_SOURCE_DIR}/teddy.jpg`, `${publicDir}/teddy.jpg`);

  // Thème + palette RÉELS empruntés (déterministe, pure — même fonction que `buildSocleWorld`) :
  // cohérence titre/accent/tint avec l'art copié ci-dessus (cf. commentaire de tête).
  const { theme, palette } = regenerateSocleContent(socleSeed(BORROWED_SLOT));
  const assetRefs = JSON.stringify({
    background: `${assetNamespace}/background.jpg`,
    tiles: `${assetNamespace}/tiles.jpg`,
    teddy: `${assetNamespace}/teddy.jpg`,
  });

  const db = new Database(databasePath);
  try {
    db.pragma("busy_timeout = 5000");
    // `slot = 0` ↔ monde résolu pour un profil frais : `resolveWorld(0)` sert `pool[0 % length]`
    // avec `pool` trié `orderBy(asc(socle_worlds.slot))` (cf. `src/lib/worldgen/socle.ts`) →
    // `pool[0]` = le slot MINIMAL. Couplage implicite à garder en sync : si l'indexation des slots
    // socle changeait (slot min ≠ 0), ce `WHERE slot = 0` ne pointerait plus le monde de départ →
    // cibler le slot min. `id`/`prompt`/`seed` de la ligne restent ceux du slot 0 (reproductibilité
    // WORLDGEN §7 non touchée) — seuls `theme`/`palette`/`asset_refs` sont réécrits.
    const info = db
      .prepare("UPDATE socle_worlds SET theme = ?, palette = ?, asset_refs = ? WHERE slot = 0")
      .run(theme.label, palette, assetRefs);
    console.log(
      `[${logPrefix}] ${databasePath} slot 0 → "${theme.label}" fixture réelle (changes=${info.changes})`,
    );
  } finally {
    db.close();
  }
}
