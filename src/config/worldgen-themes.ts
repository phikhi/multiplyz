/**
 * ⚙️ **Pool de thèmes kid-safe curaté** du générateur de mondes (WORLDGEN §4.1 : « choisir un
 * thème depuis un pool kid-safe — liste curatée + variations ; liste de thèmes bannis ; éviter
 * doublon récent »).
 *
 * **Config versionnée centralisée** (jamais de thème en dur dans le générateur — CLAUDE.md
 * « paramètres ⚙️ centralisés ») : c'est LA source unique des thèmes proposables + des mots
 * bannis. Calibrable au playtest (ajouter/retirer un thème, ajuster un mot banni) sans toucher
 * au moteur de génération (`generate-world.ts`).
 *
 * Chaque thème porte les **variables d'ancrage** injectées dans les gabarits ART §5 :
 * - `slug` : clé technique stable (`[data-world="…"]` DESIGN_TOKENS, id de monde, seed).
 * - `label` : nom FR affichable (voix douce, kid-safe).
 * - `accent` : couleur d'accent hex → pose `--world-accent` (DESIGN_TOKENS §per-monde ; le tint
 *   `--world-bg-tint` se dérive automatiquement, theme-safe → on ne pose QUE l'accent).
 * - `accessory` : accessoire de Teddy pour CE monde (`{world_accessory}`, gabarit teddy ART §5 —
 *   masque de plongée → océan, casque spatial → galaxie… ART §2 « seuls ses accessoires changent »).
 * - `creatureConcepts` : banque de concepts de créatures du monde (`{creature_concept}` + `{features}`,
 *   gabarit créature ART §5). Sélection déterministe par seed (jamais de RNG cru — WORLDGEN §7).
 *
 * **PAS de couleur en dur dans un composant** : `accent` est une donnée de génération (elle est
 * POSÉE dans `worlds.palette` puis lue par le front pour poser `--world-accent`), pas un style de
 * composant — la règle « var(--…) dans les composants » s'applique au rendu, pas à la source de
 * palette dérivée. Les hex ici alimentent la variable per-monde exactement comme DESIGN_TOKENS
 * §per-monde le prescrit (`[data-world="ocean"] { --world-accent: #2BB7E6 }`).
 */

/** Un thème kid-safe curaté (WORLDGEN §4.1) avec ses variables d'ancrage ART §5. */
export interface CuratedTheme {
  /** Clé technique stable (slug ASCII) — `[data-world]`, id de monde, seed. */
  readonly slug: string;
  /** Nom FR affichable du thème (kid-safe, voix douce). */
  readonly label: string;
  /** Couleur d'accent hex → `--world-accent` (DESIGN_TOKENS §per-monde). */
  readonly accent: string;
  /** Accessoire de Teddy pour ce monde (`{world_accessory}`, gabarit teddy ART §5). */
  readonly accessory: string;
  /** Banque de concepts de créatures (`{creature_concept}: {features}`, gabarit créature ART §5). */
  readonly creatureConcepts: readonly CreatureConcept[];
}

/** Un concept de créature du monde : description + traits distinctifs (ADN commun ART §1). */
export interface CreatureConcept {
  /** Concept (`{creature_concept}`) — anglais (ancrage modèle, ART §5). Rond, mignon, kawaii. */
  readonly concept: string;
  /** 1-2 traits distinctifs (`{features}`, ART §1 « 1-2 traits distinctifs chacun »). */
  readonly features: string;
}

/**
 * **Pool curaté** de thèmes proposables (WORLDGEN §4.1). Océan / forêt / magie / galaxie sont les
 * exemples verrouillés d'ART §2/§3 ; les autres sont des variations kid-safe. Chaque thème a ≥ 8
 * concepts de créatures (assez pour peupler 6-8 créatures/monde, ECONOMY §5, sans réutiliser un
 * concept dans le même monde).
 */
export const CURATED_THEMES: readonly CuratedTheme[] = [
  {
    slug: "ocean",
    label: "Océan scintillant",
    accent: "#2BB7E6",
    accessory: "a cute diving mask and snorkel",
    creatureConcepts: [
      { concept: "a chubby smiling pufferfish", features: "tiny round spikes, coral-pink cheeks" },
      {
        concept: "a round baby jellyfish",
        features: "glowing translucent dome, wavy short tentacles",
      },
      { concept: "a cheerful little seahorse", features: "curly tail, pastel striped body" },
      { concept: "a plump friendly clam", features: "a shiny pearl, soft frilly lips" },
      { concept: "a bubbly baby octopus", features: "big curious eyes, swirly little arms" },
      { concept: "a soft round starfish", features: "five stubby arms, sparkly tips" },
      { concept: "a tiny happy crab", features: "round claws, bubble trail" },
      { concept: "a gentle whale calf", features: "a heart-shaped water spout, chubby fins" },
    ],
  },
  {
    slug: "forest",
    label: "Forêt enchantée",
    accent: "#5BBF73",
    accessory: "a cozy knitted scarf",
    creatureConcepts: [
      { concept: "a round fluffy hedgehog", features: "leaf-tipped spines, tiny acorn hat" },
      { concept: "a chubby baby deer", features: "flower antlers, soft dappled coat" },
      { concept: "a cheerful little mushroom sprite", features: "polka-dot cap, leafy arms" },
      { concept: "a plump friendly owl", features: "big round glasses eyes, feather tufts" },
      { concept: "a soft round fox kit", features: "bushy tail, tiny flower on the ear" },
      { concept: "a bouncy baby frog", features: "lily-pad hat, glossy round cheeks" },
      { concept: "a gentle little bunny", features: "clover in the paws, floppy ears" },
      { concept: "a tiny glowing firefly", features: "warm lantern belly, dotty wings" },
    ],
  },
  {
    slug: "magic",
    label: "Royaume magique",
    accent: "#B57BEF",
    accessory: "a tiny sparkly cape",
    creatureConcepts: [
      { concept: "a round baby dragon", features: "tiny star wings, glowing belly" },
      { concept: "a fluffy cloud puff spirit", features: "rosy cheeks, trailing sparkles" },
      { concept: "a cheerful little unicorn foal", features: "pastel rainbow mane, glowing horn" },
      { concept: "a plump friendly wisp", features: "floating lantern glow, swirly tail" },
      { concept: "a soft round moth fairy", features: "glittery wings, curly antennae" },
      { concept: "a bouncy gem slime", features: "crystal droplet shape, twinkling core" },
      {
        concept: "a gentle little phoenix chick",
        features: "warm ember feathers, tiny flame crest",
      },
      { concept: "a tiny star sprite", features: "five-point body, soft glowing trail" },
    ],
  },
  {
    slug: "galaxy",
    label: "Galaxie lointaine",
    accent: "#7C6BF0",
    accessory: "a rounded space helmet",
    creatureConcepts: [
      { concept: "a round little astro-blob", features: "twinkling star eyes, antenna bobble" },
      { concept: "a fluffy comet puff", features: "sparkly tail, glowing cheeks" },
      { concept: "a cheerful baby moon creature", features: "crater dimples, soft silver glow" },
      { concept: "a plump friendly planet buddy", features: "tiny orbiting ring, pastel bands" },
      { concept: "a soft round nebula sprite", features: "swirly cloud body, glittery specks" },
      { concept: "a bouncy little rocket cub", features: "round porthole tummy, fin ears" },
      { concept: "a gentle star jelly", features: "constellation dots, glowing dome" },
      { concept: "a tiny satellite pup", features: "dish-shaped ears, blinking light nose" },
    ],
  },
  {
    slug: "candy",
    label: "Pays des bonbons",
    accent: "#F58BB4",
    accessory: "a candy-cane striped bow",
    creatureConcepts: [
      { concept: "a round gumdrop critter", features: "sugar-sparkle skin, tiny wrapper ears" },
      { concept: "a fluffy marshmallow puff", features: "pillowy body, rosy toasted cheeks" },
      { concept: "a cheerful little lollipop sprite", features: "swirl-pattern face, stick tail" },
      { concept: "a plump friendly jellybean", features: "glossy pastel shell, dotty smile" },
      { concept: "a soft round cupcake cub", features: "frosting swirl hat, cherry nose" },
      { concept: "a bouncy chocolate drop", features: "melty round shape, sprinkle freckles" },
      { concept: "a gentle cotton-candy lamb", features: "fluffy pink wool, sugar-cloud tail" },
      { concept: "a tiny caramel bear cub", features: "shiny glaze coat, swirl belly" },
    ],
  },
  {
    slug: "snow",
    label: "Vallée enneigée",
    accent: "#6FB7DB",
    accessory: "a woolly winter hat with a pom-pom",
    creatureConcepts: [
      { concept: "a round baby snow bunny", features: "frost-tipped ears, mitten paws" },
      { concept: "a fluffy little penguin chick", features: "round belly, tiny earmuffs" },
      { concept: "a cheerful snowflake sprite", features: "crystal six-point body, soft glow" },
      { concept: "a plump friendly seal pup", features: "big shiny eyes, scarf around neck" },
      { concept: "a soft round polar cub", features: "chubby cheeks, snow-dusted fur" },
      { concept: "a bouncy little icicle imp", features: "glassy blue shine, frosty tuft" },
      { concept: "a gentle baby reindeer", features: "tiny snow antlers, red round nose" },
      { concept: "a tiny frost fox", features: "sparkly white tail, ice-blue eyes" },
    ],
  },
] as const;

/**
 * **Liste de thèmes bannis** (WORLDGEN §4.1) : mots/racines interdits dans un thème (kid-safe).
 * Normalisés minuscules sans accent → comparés par **inclusion de sous-chaîne** (attrape les
 * variations : « guerrier », « effrayant »…). Source unique de la modération amont côté thème
 * (la modération image kid-safe reste au client/QA, WORLDGEN §6).
 */
export const BANNED_THEME_TERMS: readonly string[] = [
  "guerre",
  "guerrier",
  "arme",
  "sang",
  "mort",
  "effrayant",
  "horreur",
  "monstre",
  "peur",
  "cauchemar",
  "sombre",
  "demon",
  "diable",
  "violence",
] as const;

/** Normalise un libellé de thème pour la comparaison : minuscules + sans diacritiques + trim. */
export function normalizeThemeText(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Le thème curaté correspondant à `theme` (par slug OU label normalisé), ou `undefined`. */
export function findCuratedTheme(theme: string): CuratedTheme | undefined {
  const norm = normalizeThemeText(theme);
  return CURATED_THEMES.find((t) => t.slug === norm || normalizeThemeText(t.label) === norm);
}

/**
 * `true` si `theme` contient un **terme banni** (WORLDGEN §4.1). Comparaison par inclusion de
 * sous-chaîne sur le texte normalisé → attrape les variations morphologiques d'un mot banni.
 */
export function hasBannedTerm(theme: string): boolean {
  const norm = normalizeThemeText(theme);
  return BANNED_THEME_TERMS.some((term) => norm.includes(normalizeThemeText(term)));
}
