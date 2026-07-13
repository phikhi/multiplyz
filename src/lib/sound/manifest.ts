/**
 * Registre des assets audio (story 8.4, #257) — clés stables consommées par `engine.ts` /
 * `SoundProvider.tsx`, mappées vers les fichiers servis statiquement depuis `public/sounds/**`
 * (générés par `scripts/generate-sound-placeholders.mjs`, cf. son JSDoc pour le statut
 * placeholder honnête #155).
 *
 * **SFX câblés (AC #1, PRODUCT.md:60 « Bonne réponse → juice… petit son. Combo si série »,
 * PLAN.md:66 « combo d'étincelles sur série de bonnes réponses », WIREFRAMES.md:120 « Résultats
 * de niveau »)** :
 * - `correct`  : bonne réponse (1ʳᵉ tentative OU re-essai résolu — reflète `QuestionPhase`
 *   `"correct"` tel quel, jamais une notion de justesse que le moteur d'état ne trace pas).
 * - `combo`    : série de bonnes réponses consécutives ≥ `SOUND_COMBO_THRESHOLD` (`config.ts`).
 * - `results`  : apparition de l'écran de résultats de fin de niveau (`ResultsScreen`).
 * - `legendary`: révélation de la créature légendaire du boss (`LegendaryReveal`, MAP §6). C'est
 *   l'analogue « ouverture d'œuf » le plus proche RÉELLEMENT construit — **aucun écran boutique
 *   / ouverture d'œuf commun-rare n'existe encore en code** (Phase 2 économie non triée, cf.
 *   LEARNINGS.md rétro 8.2b : « écran boutique inexistant », discovered #269). La clé `legendary`
 *   est câblée honnêtement au SEUL moment de révélation de récompense qui existe aujourd'hui ;
 *   réutilisable telle quelle (ou à côté d'une clé `eggOpen` dédiée) quand l'écran boutique/œufs
 *   sera construit.
 *
 * **Musique** : une seule piste de fond `play`, en boucle pendant une partie active
 * (`PlayingGame`), gatée `musicEnabled`.
 */

/** Clés de bruitages (SFX) — un fichier court par clé. */
export type SfxKey = "correct" | "combo" | "results" | "legendary";

/** Clés de musique (boucle de fond). */
export type MusicKey = "play";

/** Chemin public (servi par Next depuis `public/`) de chaque SFX. */
export const SFX_MANIFEST: Readonly<Record<SfxKey, string>> = {
  correct: "/sounds/sfx/correct.wav",
  combo: "/sounds/sfx/combo.wav",
  results: "/sounds/sfx/results.wav",
  legendary: "/sounds/sfx/legendary.wav",
};

/** Chemin public de chaque piste de musique. */
export const MUSIC_MANIFEST: Readonly<Record<MusicKey, string>> = {
  play: "/sounds/music/play-loop.wav",
};
