/** Reviewable one-to-one renewal inventory. Read-only family/pilot access, no API, seed or publication. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../src/lib/db/schema";
import { findCuratedTheme } from "../src/config/worldgen-themes";
import { resolveWorld } from "../src/lib/worldgen/socle";
import { stageArtRefs } from "../src/lib/game/creature-stage-art";
import { assertNewNames } from "../src/lib/worldgen/creature-design";
import { creatureHistory, readCatalogueArt } from "../src/lib/worldgen/creature-design-runtime";
import { loadApprovedCast } from "../src/lib/worldgen/pilot-approved-cast";
import { loadValidatedPilotCast } from "../src/lib/worldgen/pilot-validated-cast";
import { pilotCeilingEur } from "../src/lib/worldgen/pilot-budget";
import { readPilotReservedUnits } from "../src/lib/worldgen/pilot-status";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pilot = join(app, "data/teddy-world-pilot");
const root = join(app, "docs/playthroughs/teddy-creature-diversity");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
interface Proposal {
  worldIndex: number;
  theme: string;
  setting: string;
  creatures: { name: string; anatomy: string; role: string }[];
}

function main() {
  if (process.argv.length > 2)
    throw new Error("Inventaire local uniquement ; aucune option de génération.");
  const source = new Database(join(app, "data/multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const copy = new Database(join(pilot, "multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const db = drizzle(source, { schema }),
      copyDb = drizzle(copy, { schema });
    const proposals: Proposal[] = JSON.parse(
      readFileSync(join(root, "proposition-socle.json"), "utf8"),
    ).worlds;
    if (proposals.length !== 6 || proposals.some((p, i) => p.worldIndex !== i))
      throw new Error("La proposition doit couvrir exactement les mondes 0 à 5.");
    const approved = loadApprovedCast(pilot, join(root, "approved-magic-growth.json"));
    const priorNames = [
      ...creatureHistory(db, join(app, "storage/generated"), -1),
      ...creatureHistory(copyDb, join(pilot, "storage/generated"), -1),
    ]
      .map((c) => c.name)
      .concat(approved.plan.creatures.map((c) => c.name));
    assertNewNames(
      proposals.flatMap((p) => p.creatures.map((c) => c.name)),
      priorNames,
    );
    // A coherent read transaction; only catalogue/world metadata is recorded, never profile data.
    const worlds = source.transaction(() => {
      const catalogue = db.select().from(schema.characters).all();
      return proposals.map((proposal) => {
        const world = resolveWorld(db, proposal.worldIndex);
        const theme = findCuratedTheme(world.theme);
        if (theme?.slug !== proposal.theme)
          throw new Error("Le thème familial diffère de la proposition.");
        const rows = catalogue
          .filter((c) => c.worldIndex === proposal.worldIndex)
          .sort(
            (a, b) =>
              Number(a.rarity === "legendary") - Number(b.rarity === "legendary") ||
              a.id.localeCompare(b.id),
          );
        if (rows.length !== proposal.creatures.length)
          throw new Error("Nombre de compagnons différent du catalogue.");
        return {
          worldIndex: proposal.worldIndex,
          theme: proposal.theme,
          label: world.theme,
          setting: proposal.setting,
          creatures: rows.map((row, i) => ({
            id: row.id,
            speciesKey: row.speciesKey,
            rarity: row.rarity,
            inEggPool: row.inEggPool,
            before: row,
            proposed: proposal.creatures[i],
            preservedArts: stageArtRefs(row).map((ref) => ({
              ref,
              sha256: hash(
                readCatalogueArt(
                  ref,
                  join(app, "storage/generated"),
                  join(app, "public/generated"),
                ),
              ),
            })),
          })),
        };
      });
    })();
    const count = worlds.reduce((n, w) => n + w.creatures.length, 0);
    const current = readPilotReservedUnits(pilot);
    const validated = loadValidatedPilotCast(pilot, join(root, "approved-magic-growth.json"));
    const pilotGrowth = 0;
    const renewedImages = count * 3,
      babyInspections = count,
      finalInspections = count * 3;
    const renewalUnits = renewedImages * 100_000 + (babyInspections + finalInspections) * 50_000;
    const result = {
      at: new Date().toISOString(),
      mode: "editorial-renewal-plan-no-api",
      published: false,
      databaseWritten: false,
      generatedImages: 0,
      currentReservedEur: current / 1_000_000,
      ceilingEur: pilotCeilingEur(pilot),
      pilotGrowthPlannedEur: pilotGrowth / 1_000_000,
      validatedPilotRun: validated.inspectionRun,
      renewal: {
        creatures: count,
        images: renewedImages,
        babyInspections,
        finalInspections,
        plannedEur: renewalUnits / 1_000_000,
        includesRetries: false,
        includesPaidPlanning: false,
      },
      plannedCumulativeEur: (current + pilotGrowth + renewalUnits) / 1_000_000,
      fitsCurrentCeiling:
        current + pilotGrowth + renewalUnits <= pilotCeilingEur(pilot) * 1_000_000,
      worlds,
    };
    const directory = join(root, `renewal-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const save = (name: string, data: string) =>
      writeFileSync(join(directory, name), data, { flag: "wx" });
    save("plan.json", JSON.stringify(result, null, 2) + "\n");
    save(
      "proposition.md",
      `# Nouvelle faune des mondes 0 à 5\n\nProposition éditoriale, sans images générées. Chaque ligne remplace un seul compagnon de catalogue ; son identifiant, sa rareté et ses possessions restent conservés. Les nouveaux noms sont libres face au catalogue complet, au pilote et aux six bébés validés. La différence visuelle sera vérifiée sur les images.\n\n${worlds.map((w) => `## Monde ${w.worldIndex} · ${w.setting}\n\n| Avant | Proposition | Corps et fonction |\n| --- | --- | --- |\n${w.creatures.map((c) => `| ${c.before.nameDefault} | ${c.proposed.name} | ${c.proposed.anatomy}. ${c.proposed.role}. |`).join("\n")}\n`).join("\n")}\n## Budget de réservation\n\n${count} compagnons, ${renewedImages} images, ${babyInspections} inspections de bébés puis ${finalInspections} inspections finales : ${(renewalUnits / 1_000_000).toFixed(2)} € supplémentaires, hors corrections et conception payante. Cumul avec le pilote et ses évolutions : ${result.plannedCumulativeEur.toFixed(2)} €, plafond autorisé ${result.ceilingEur} €. Aucune hausse ni génération engagée par cet inventaire.\n`,
    );
    console.log(
      JSON.stringify(
        {
          creatures: count,
          worlds: worlds.map((w) => ({
            index: w.worldIndex,
            theme: w.theme,
            creatures: w.creatures.length,
          })),
          renewal: result.renewal,
          plannedCumulativeEur: result.plannedCumulativeEur,
          ceilingEur: result.ceilingEur,
          fitsCurrentCeiling: result.fitsCurrentCeiling,
          proposal: join(directory, "proposition.md"),
          plan: join(directory, "plan.json"),
          databaseWritten: false,
        },
        null,
        2,
      ),
    );
  } finally {
    source.close();
    copy.close();
  }
}
main();
