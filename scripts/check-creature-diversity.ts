/** Local catalogue audit and reviewable concept proposal. No network, seed or database writes. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../src/lib/db/schema";
import {
  catalogueSheets,
  creatureHistory,
  readCatalogueArt,
} from "../src/lib/worldgen/creature-design-runtime";
import { nameKey, validateCreatureDesign } from "../src/lib/worldgen/creature-design";
import { deriveCreatureSplit } from "../src/lib/worldgen/creature-catalog";
import { readPilotReservedUnits } from "../src/lib/worldgen/pilot-status";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pilot = join(app, "data/teddy-world-pilot");
const directory = join(app, "docs/playthroughs/teddy-creature-diversity");

async function main() {
  if (process.argv.length > 2)
    throw new Error("Ce contrôle local n’accepte pas d’option de génération.");
  const source = new Database(join(app, "data/multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const copy = new Database(join(pilot, "multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const sourceRows = drizzle(source, { schema }).select().from(schema.characters).all();
    const history = creatureHistory(
      drizzle(copy, { schema }),
      join(pilot, "storage/generated"),
      -1,
    );
    // Include any later family catalogue entries too; never roll the active family back to its snapshot.
    const combined = new Map(history.map((c) => [c.id, c]));
    for (const c of creatureHistory(
      drizzle(source, { schema }),
      join(app, "storage/generated"),
      -1,
    ))
      combined.set(c.id, c);
    const complete = [...combined.values()];
    const plan = validateCreatureDesign(
      JSON.parse(readFileSync(join(directory, "proposition-magic.json"), "utf8")),
      6,
      "magic",
      complete.map((c) => c.name),
    );
    const run = join(directory, randomUUID());
    mkdirSync(run, { recursive: true });
    const sheets = await catalogueSheets(complete, (ref) =>
      readCatalogueArt(
        ref,
        ref.startsWith("world/6/")
          ? join(pilot, "storage/generated")
          : join(app, "storage/generated"),
        join(app, "public/generated"),
      ),
    );
    for (const [i, bytes] of sheets.entries())
      writeFileSync(join(run, `catalogue-${i + 1}.png`), bytes, { flag: "wx" });
    const names = new Map<string, { name: string; worlds: number[] }>();
    for (const c of sourceRows) {
      const entry = names.get(nameKey(c.nameDefault)) ?? { name: c.nameDefault, worlds: [] };
      entry.worlds.push(c.worldIndex);
      names.set(nameKey(c.nameDefault), entry);
    }
    const split = deriveCreatureSplit(plan.worldIndex);
    const review = `# Proposition de faune · jardins suspendus\n\nConception rédigée localement, sans nouvelle génération d’image. Les noms ont été vérifiés contre le catalogue et le pilote conservé. La distinction visuelle et la croissance restent à vérifier sur les futurs pixels. Aucun remplacement du pilote ni publication.\n\n${plan.creatures.map((c, slot) => `## ${c.name} · ${slot < split.commons ? "commune" : slot < split.commons + split.rares ? "rare" : "légendaire"}\n\n${c.story}\n\n- Corps : ${c.anatomy}\n- Signature : ${c.signature}\n- Adaptation : ${c.adaptation}\n- Fonction : ${c.role}\n- Adolescent : ${c.adolescent}\n- Adulte : ${c.adult}\n`).join("\n")}`;
    writeFileSync(join(run, "proposition.md"), review, { flag: "wx" });
    const result = {
      at: new Date().toISOString(),
      familyCreatures: sourceRows.length,
      distinctFamilyNames: names.size,
      repeatedNames: [...names.values()].filter((n) => n.worlds.length > 1),
      comparisonCreatures: complete.length,
      comparisonAges: complete.reduce((n, c) => n + c.artRefs.length, 0),
      comparisonSheets: sheets.length,
      proposedNames: plan.creatures.map((c) => c.name),
      namesAvailable: true,
      newImagesGenerated: 0,
      apiCalls: 0,
      databaseWritten: false,
      pilotReservedEur: readPilotReservedUnits(pilot) / 1_000_000,
      review: join(run, "proposition.md"),
      visualNoveltyValidated: false,
    };
    writeFileSync(join(run, "audit.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    source.close();
    copy.close();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Audit interrompu.");
  process.exitCode = 1;
});
