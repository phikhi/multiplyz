import { deriveCreatureSplit } from "./creature-catalog";
import { validateCreatureDesign } from "./creature-design";

/** Synthetic concepts for HTTP/SQLite-memory tests only, never seeded into a saved family. */
export function testCreatureDesign(index = 6, theme = "magic") {
  const names = [
    "Orivelle",
    "Nacréon",
    "Brumelis",
    "Ondaline",
    "Veloutis",
    "Claironce",
    "Séladon",
    "Frondelle",
    "Aubéron",
    "Mirlune",
    "Rosépine",
    "Tissandre",
    "Calmélia",
    "Virelot",
    "Dorivage",
    "Plumance",
  ];
  const split = deriveCreatureSplit(index);
  const bodies = [
    "lenticular floating seed",
    "branching root walker",
    "spiral pod climber",
    "radial pollen collector",
    "ribbon stem glider",
    "bell-shaped dew catcher",
    "jointed vine grazer",
    "bivalve bud keeper",
  ];
  return validateCreatureDesign(
    {
      creatures: Array.from({ length: split.commons + split.rares + 1 }, (_, slot) => ({
        name: names[((index - 6) * 8 + slot + names.length * 20) % names.length],
        story: "Ce compagnon recueille la rosée pour les jeunes pousses.",
        anatomy: `A baby ${bodies[slot]} with short central body and folded sails`,
        signature: `Structural keel number ${slot} with a split leaf sail`,
        adaptation: "A buoyant seed hull catches garden updrafts",
        role: "Carries pollen between suspended roots",
        adolescent:
          "A longer central stem, smaller relative head and partially developed leaf sail",
        adult: "A long arching central stem with broad mature sails and the original split tips",
      })),
    },
    index,
    theme,
    [],
  );
}
