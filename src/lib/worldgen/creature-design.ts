import { deriveCreatureSplit } from "./creature-catalog";
import { BANNED_THEME_TERMS, normalizeThemeText } from "@/config/worldgen-themes";

/** New worlds only. The historical socle and its identities remain unchanged. */
export interface CreatureDesign {
  name: string;
  story: string;
  anatomy: string;
  signature: string;
  adaptation: string;
  role: string;
  adolescent: string;
  adult: string;
}

export interface WorldCreatureDesign {
  version: 1;
  worldIndex: number;
  theme: string;
  habitat: string;
  creatures: CreatureDesign[];
}

export const WORLD_HABITATS: Readonly<Record<string, string>> = {
  ocean:
    "Fully underwater coral gardens, seagrass meadows and sheltered sea caves. Native aquatic anatomy: swimming, anchoring or crawling underwater, fins, gills or marine invertebrate structures. No land mammal wearing diving equipment. Distinguish reef grazers, current riders, filter feeders and shelter builders.",
  forest:
    "A humid ancient forest with mossy roots, hollow trunks, fern undergrowth and freshwater pools. Inhabitants climb, burrow, pollinate or disperse seeds. Their anatomy must explain their niche; a leaf hat on a generic pet is insufficient.",
  magic:
    "Suspended botanical gardens connected by vines, rain basins, floating seeds and warm luminous pollen. Invent living inhabitants adapted to catching updrafts, tending roots, carrying pollen or collecting dew. Magic follows a specific ecological function; avoid generic dragons, unicorns, stars or cloud blobs repeated from earlier worlds.",
  galaxy:
    "Quiet low-gravity mineral islands, orbital dust gardens and sheltered luminous craters. Invent non-human life adapted to anchoring, gliding between rocks or harvesting starlight. An existing animal with a space helmet or star pattern is insufficient.",
  candy:
    "An edible landscape of wafer terraces, sugar reeds, caramel streams and soft fruit-gel groves. Body structure and movement follow a specific material and local niche. Do not merely recolour a familiar pet or place a sweet on its head.",
  snow: "A snowy valley with powder slopes, sheltered burrows, frosted branches and thaw pools. Native anatomy explains insulation, travel over snow, digging or storing warmth. A scarf or white recolouring of a forest creature is insufficient.",
};

/** Preserve the illustration language without forcing Teddy's fur or baby body onto every species. */
export function nativeCreatureStyle(style: string): string {
  return (
    style
      .replace("cute chibi proportions", "gentle age-appropriate anatomical proportions")
      .replace(
        "lightly fluffy fur with a few soft clean fur tufts along the silhouette edge, tidy smooth even fur, not blotchy,",
        "species-specific natural materials and clean soft silhouette edges,",
      ) +
    ". Materials follow the species: skin, shell, bark, leaf, membrane or fur only when anatomically appropriate."
  );
}

export const nameKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z]/g, "");

/** Also exclude trivial spelling changes used to disguise a repeated name. */
export function namesClash(a: string, b: string): boolean {
  const left = nameKey(a),
    right = nameKey(b);
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[right.length] <= (Math.min(left.length, right.length) >= 7 ? 2 : 1);
}

export function assertNewNames(names: readonly string[], previous: readonly string[]): void {
  const used = [...previous];
  for (const name of names) {
    if (
      !/^[\p{L}][\p{L}'’ -]{2,25}$/u.test(name) ||
      nameKey(name).length < 3 ||
      used.some((old) => namesClash(name, old))
    )
      throw new Error(`Nom de créature déjà utilisé ou trop proche : ${name}.`);
    used.push(name);
  }
}

export function validateCreatureDesign(
  value: unknown,
  index: number,
  theme: string,
  previousNames: readonly string[],
): WorldCreatureDesign {
  if (
    !value ||
    typeof value !== "object" ||
    !("creatures" in value) ||
    !Array.isArray(value.creatures)
  )
    throw new Error("Conception de créatures absente.");
  const habitat = WORLD_HABITATS[theme];
  if (!habitat) throw new Error("Milieu de créatures non défini pour ce thème.");
  const split = deriveCreatureSplit(index);
  if (value.creatures.length !== split.commons + split.rares + 1)
    throw new Error("Le plan doit conserver le nombre de communes, rares et légendaire.");
  const fields = [
    "name",
    "story",
    "anatomy",
    "signature",
    "adaptation",
    "role",
    "adolescent",
    "adult",
  ] as const;
  const creatures = value.creatures.map((raw): CreatureDesign => {
    if (!raw || typeof raw !== "object") throw new Error("Concept de créature invalide.");
    const concept = {} as CreatureDesign;
    for (const field of fields) {
      if (typeof raw[field] !== "string" || raw[field].trim().length < 3 || raw[field].length > 700)
        throw new Error(`Description de créature absente ou trop longue : ${field}.`);
      concept[field] = raw[field].trim();
      if (
        BANNED_THEME_TERMS.some((word) =>
          new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(normalizeThemeText(concept[field])),
        )
      )
        throw new Error("Description de créature refusée par les règles de contenu.");
    }
    if (new Set([concept.anatomy, concept.adolescent, concept.adult]).size !== 3)
      throw new Error("Chaque âge doit avoir une anatomie explicitement différente.");
    return concept;
  });
  assertNewNames(
    creatures.map((c) => c.name),
    previousNames,
  );
  const signatures = creatures.map((c) => nameKey(c.anatomy + c.signature));
  if (new Set(signatures).size !== signatures.length)
    throw new Error("Deux créatures du plan ont la même anatomie et les mêmes motifs.");
  return { version: 1, worldIndex: index, theme, habitat, creatures };
}

export function designedCreaturePrompt(design: CreatureDesign, habitat: string): string {
  return `Native inhabitant of this environment: ${habitat}
BABY anatomy: ${design.anatomy}. Defining structural signature: ${design.signature}.
Environmental adaptation: ${design.adaptation}. Ecological role: ${design.role}.
The habitat must be legible from the creature's anatomy even on a plain white background.
Show ONE full-body creature, no habitat scenery, no props explaining an otherwise unrelated animal.
Keep the world art direction but use the creature's own natural material and colour balance; do not tint every body with the world's accent.
Later adolescent anatomy: ${design.adolescent}. Later adult anatomy: ${design.adult}.
Draw only the BABY now, leaving room for those genuine anatomical changes at the later ages.`;
}
