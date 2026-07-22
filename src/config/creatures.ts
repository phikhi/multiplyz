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
 * **Honnêteté #180 (déclaré ≠ vécu)** : R2.1 ne CÂBLE que la consommation de `art_ref` + amorce
 * **UNE** vraie créature (`DEMO_CREATURE`, le renard des brumes du spike, dé-échantillonné +
 * détouré, `test-fixtures/creature/cloudfox.png`) pour rendre l'écran OBSERVABLE avec du vrai art.
 * Le **SET COMPLET** de créatures réelles (5 légendaires + communes/rares) = **R3.1** (pipeline de
 * génération). Les refs DB des autres créatures restent `placeholder://…` → repli emoji.
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
 * Le pipeline R3.1 posera ces refs en base ; ici on ne l'utilise que pour la créature de démo.
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
 * **Phase 1 (R3.1, câblage — 0 dépense)** : contient **UNIQUEMENT** la créature de démo `cloudfox`
 * (la seule dont un vrai PNG est committé aujourd'hui). Le mécanisme de génération du set complet
 * (`generateSocleCreatures`) est câblé + testé, mais son **défaut committé reste inerte** : aucun
 * autre art réel n'existe encore → les autres créatures restent `placeholder://…` (repli emoji
 * no-fail de `<AssetImage>`), **0 régression CI** (honnêteté #180 : déclaré ≠ vécu).
 *
 * **Phase 2 (run payant owner-supervisé, #377)** : une fois les vrais PNG des 6 mondes socle
 * générés (`scripts/gen-socle-creatures.local.ts`) puis **committés**, on **flip** ce registre en
 * **appendant** leurs `speciesKey` (une modification de **données**, une ligne) → le seed les rend
 * observables sans toucher au mécanisme. Source unique (anti-drift #164) : le seed dérive le nom de
 * fichier de chaque espèce, jamais un chemin dupliqué.
 */
export const COMMITTED_CREATURE_SPECIES: readonly string[] = [DEMO_CREATURE_SPECIES];
