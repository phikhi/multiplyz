/**
 * **Réf d'asset des illustrations de créatures de la collection** (story R2.1, #361, ECONOMY
 * §3.2/§3.3, ART, WORLDGEN).
 *
 * Les créatures possédées (Pokédex) portent une `art_ref` en base (`characters.art_ref`) que
 * l'écran Collection + la révélation de la légendaire consomment via `<AssetImage>` : un ref
 * **rendable** (`socle/creature/<species>.png`) → vrai art ; un `placeholder://…` (état
 * aujourd'hui, avant le pipeline de génération) → repli emoji (`<AssetImage>` no-fail). Ce module
 * centralise le **namespace + la forme du ref** (⚙️, jamais un chemin en dur éparpillé) — même
 * garde de sécurité partagée `isRenderableAssetRef` (`world-theme.ts`) que Teddy et les assets
 * per-monde (namespace `socle/`, aucune modification de la garde).
 *
 * **#180 (déclaré = vécu, story R3.1 #378)** : R2.1 a amorcé **UNE** vraie créature (`DEMO_CREATURE`,
 * le renard des brumes du spike) ; **R3.1** a livré le **SET COMPLET** — les **41 créatures réelles**
 * des 6 mondes socle (communes+rares + **6 légendaires**, run payant #377 signé game-design ADR 0009)
 * committées en `test-fixtures/creature/<species>.png`, listées dans `COMMITTED_CREATURE_SPECIES`. La
 * légendaire de chaque monde porte désormais son art réel (`legendaryForWorld`, `collection.ts`) →
 * atteignable au boss. Le **tirage d'œuf** des communes/rares reste R4 (art committé, non tiré).
 */

/**
 * Base du namespace socle des illustrations de créatures (⚙️ centralisée) — `socle/creature/` :
 * sous le namespace `socle` déjà accepté par `isRenderableAssetRef` (aucune modification de la
 * garde de sécurité) et **distinct** des slots numériques `socle/0..5/` (jamais de collision — la
 * sous-clé `creature` n'est pas un slot) comme `socle/teddy/`. Deux segments (`socle` / `creature`
 * / `<species>.png`) → matche la forme rendable exacte (`^(?:world|socle)/…$`).
 */
export const CREATURE_ASSET_DIR = "socle/creature";

/**
 * Ref rendable (`isRenderableAssetRef` ✓) de l'illustration d'une espèce de créature. Pure. Ne
 * construit JAMAIS une URL : renvoie le **ref relatif** que `<AssetImage>` re-valide puis résout
 * via `assetPublicUrl` — la sécurité du rendu reste portée par la garde partagée, jamais contournée.
 * Consommé par `deriveSocleCreatures`/`legendaryForWorld` (art réel des créatures socle) + le seed.
 */
export function creatureArtRef(species: string): string {
  return `${CREATURE_ASSET_DIR}/${species}.png`;
}

/**
 * **Espèce de la créature de démonstration** amorcée observable en dev/E2E (story R2.1, #361) —
 * le renard des brumes kawaii du spike `docs/spike/nano-banana/03-creature-cloudfox.png` (vrai art
 * généré, dé-échantillonné + détouré en `test-fixtures/creature/cloudfox.png`). UNE créature réelle
 * suffit à rendre l'écran Collection observable avec du vrai art ; le set complet = R3.1.
 */
export const DEMO_CREATURE_SPECIES = "cloudfox";

/**
 * Ref rendable de la créature de démonstration (`socle/creature/cloudfox.png`) — consommé par le
 * seed d'asset (copie de la fixture vers `public/generated/`, dev+E2E) ET le seed de collection
 * E2E (une possession dont l'`art_ref` pointe ici) : **source unique** (anti-drift #164), la même
 * ref des deux côtés.
 */
export const DEMO_CREATURE_ART_REF = creatureArtRef(DEMO_CREATURE_SPECIES);

/**
 * **Registre des espèces de créatures dont une illustration RÉELLE est committée** (non-gitignorée,
 * `test-fixtures/creature/<species>.png`) → le seed d'asset (`seedCreatureSprites`) copie **chacune**
 * vers son chemin rendable `public/generated/socle/creature/<species>.png` (dev + E2E).
 *
 * **Phase 2 (run payant owner-supervisé, #377 — FAIT, game-design signé ADR 0009)** : les **41
 * créatures réelles** des 6 mondes socle (communes+rares+légendaire, `deriveCreatureSplit`) ont été
 * générées puis **committées** dé-échantillonnées (`test-fixtures/creature/<species>.png`, 256² RGBA,
 * même traitement que `cloudfox`). Leurs `speciesKey` sont **appendés** ci-dessous (données) → le
 * seed (`seedCreatureSprites`) les recopie vers `public/generated/socle/creature/` au démarrage
 * dev/E2E. Source unique (anti-drift #164) : le nom de fichier se DÉRIVE de l'espèce.
 *
 * **Cohérence dérivation↔art (garde #180/#189)** : cette liste doit correspondre **exactement** aux
 * créatures que `deriveSocleCreatures` (`creature-catalog.ts`) dérive des 6 slots socle — un test
 * (`socle == registre`) rougit si l'une diverge (une espèce sans PNG committé, ou un PNG orphelin).
 */
export const COMMITTED_CREATURE_SPECIES: readonly string[] = [
  // Créature de démo R2.1 (#361) — le renard des brumes du spike (non dérivée d'un slot socle).
  DEMO_CREATURE_SPECIES,
  // Monde socle 0 : 6 œufs (communes+rares) + 1 légendaire
  "creature_world_0_0",
  "creature_world_0_1",
  "creature_world_0_2",
  "creature_world_0_3",
  "creature_world_0_4",
  "creature_world_0_5",
  "legendary_world_0",
  // Monde socle 1 : 5 œufs (communes+rares) + 1 légendaire
  "creature_world_1_0",
  "creature_world_1_1",
  "creature_world_1_2",
  "creature_world_1_3",
  "creature_world_1_4",
  "legendary_world_1",
  // Monde socle 2 : 6 œufs (communes+rares) + 1 légendaire
  "creature_world_2_0",
  "creature_world_2_1",
  "creature_world_2_2",
  "creature_world_2_3",
  "creature_world_2_4",
  "creature_world_2_5",
  "legendary_world_2",
  // Monde socle 3 : 6 œufs (communes+rares) + 1 légendaire
  "creature_world_3_0",
  "creature_world_3_1",
  "creature_world_3_2",
  "creature_world_3_3",
  "creature_world_3_4",
  "creature_world_3_5",
  "legendary_world_3",
  // Monde socle 4 : 5 œufs (communes+rares) + 1 légendaire
  "creature_world_4_0",
  "creature_world_4_1",
  "creature_world_4_2",
  "creature_world_4_3",
  "creature_world_4_4",
  "legendary_world_4",
  // Monde socle 5 : 7 œufs (communes+rares) + 1 légendaire
  "creature_world_5_0",
  "creature_world_5_1",
  "creature_world_5_2",
  "creature_world_5_3",
  "creature_world_5_4",
  "creature_world_5_5",
  "creature_world_5_6",
  "legendary_world_5",
];
