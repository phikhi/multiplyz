/**
 * Config ⚙️ CLIENT-SAFE du moteur son (story 8.4, #257). Distincte de `config/server-config.ts`
 * (`SoundConfig`/`getSoundConfig`) : ce dernier est marqué **SERVER-ONLY** (secrets, lecture
 * `process.env`) et ne doit jamais être importé depuis un composant client — ce module ne
 * contient que des constantes pures, sûres à bundler côté navigateur.
 */

/**
 * Bornes FIXES (non-⚙️) du volume, pourcentage entier `[0, 100]` — MIROIR intentionnel de
 * `SOUND_VOLUME_MIN`/`SOUND_VOLUME_MAX` (`config/server-config.ts`, story 8.3, DETAILS §3).
 * Dupliquées ici (jamais importées) car `server-config.ts` est SERVER-ONLY. En pratique la
 * valeur reçue par le moteur est déjà validée serveur (`writeHouseholdSettings`) ; ce clamp est
 * un filet défensif côté client (jamais un `.volume` DOM hors `[0,1]`, qui lèverait).
 */
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 100;

/**
 * ⚙️ Atténuation (facteur `[0,1]`) du gain SFX sous `prefers-reduced-motion: reduce`
 * (DESIGN_TOKENS.md:32 « Mouvement : `prefers-reduced-motion` neutralise les durées »,
 * tokens.css:617 `@media (prefers-reduced-motion: reduce)`). Le « juice » sonore est
 * **atténué**, pas coupé : le feedback essentiel (bonne réponse) reste audible mais l'intensité
 * « célébration » (combo/légendaire) redescend. Ne s'applique QU'aux SFX — la musique de fond
 * n'est pas un « juice » ponctuel, elle n'est pas atténuée par ce réglage. À calibrer au
 * playtest (DETAILS.md:54 « Plan de playtest — le vrai juge »).
 */
export const REDUCED_MOTION_SFX_GAIN = 0.4;

/**
 * ⚙️ Nombre de bonnes réponses consécutives (1ʳᵉ tentative, jamais un re-essai — cf.
 * `juice.ts`) avant de faire basculer le SFX `"correct"` en `"combo"` (PRODUCT.md:60 « Bonne
 * réponse → juice… Combo si série », PLAN.md:66 « combo d'étincelles sur série de bonnes
 * réponses »). À calibrer au playtest.
 */
export const SOUND_COMBO_THRESHOLD = 3;
