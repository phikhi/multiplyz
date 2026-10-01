import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { jobs } from "@/lib/db/schema";
import { describePilotStatus } from "./pilot-status";

const directory = mkdtempSync(join(tmpdir(), "teddy-pilot-status-"));
const db = createDatabase(":memory:");
runMigrations(db);
afterEach(() => {
  db.$client.close();
  rmSync(directory, { recursive: true, force: true });
});

it("explains an interrupted trace without declaring a running job alive or sending a retry", () => {
  writeFileSync(
    join(directory, "started.json"),
    JSON.stringify({ at: "2026-09-11T07:01:12.044Z", target: 6 }),
  );
  writeFileSync(
    join(directory, "requests.jsonl"),
    [
      { call: 1, type: "image" },
      { call: 1, status: 200 },
      { call: 2, type: "image" },
      { call: 2, status: 200 },
      { call: 3, type: "image" },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  const ledger = join(directory, "storage/worldgen/budget/2026-09");
  mkdirSync(ledger, { recursive: true });
  for (let i = 0; i < 3; i++)
    writeFileSync(join(ledger, `${i}.json`), JSON.stringify({ units: 100000 }));
  const generated = join(directory, "storage/generated/world/6");
  mkdirSync(generated, { recursive: true });
  for (const name of ["background", "tiles"])
    writeFileSync(join(generated, `runtime-unit-${name}.png`), "delivered-file");
  db.insert(jobs)
    .values({ type: "generate_world", payload: '{"worldIndex":6}', status: "running" })
    .run();
  const before = db.select().from(jobs).all();
  db.$client.pragma("query_only=ON");
  const message = describePilotStatus(db, directory);
  expect(message).toContain("2 emplacement(s) d’image du pilote");
  expect(message).toContain("0,30 €");
  expect(message).toContain("appel 3 sans réponse enregistrée");
  expect(message).toContain("ne prouve pas que le processus tourne encore");
  expect(message).toContain("--status");
  expect(db.select().from(jobs).all()).toEqual(before);
  writeFileSync(join(directory, "cast-completion-plan.json"), "{}");
  writeFileSync(join(directory, "cast-completion-recovery.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--cast-completion-inspect-plan");
  expect(describePilotStatus(db, directory)).not.toContain("Dix nouvelles images");
  writeFileSync(join(directory, "cast-completion-inspect-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Inspection du groupe récupéré engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--cast-completion-inspect-plan");
  writeFileSync(join(directory, "arbelune-repair-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--arbelune-repair-plan");
  expect(describePilotStatus(db, directory)).toContain("malgré son ancienne QA positive");
  writeFileSync(join(directory, "arbelune-repair-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Correction d’Arbélune engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--arbelune-repair-plan");
  writeFileSync(join(directory, "arbelune-adolescent-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--arbelune-adolescent-plan");
  writeFileSync(join(directory, "arbelune-adolescent-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Nouvel ado d’Arbélune engagé");
  expect(describePilotStatus(db, directory)).not.toContain("--arbelune-adolescent-plan");
  writeFileSync(join(directory, "arbelune-study-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--arbelune-study-plan");
  writeFileSync(join(directory, "arbelune-study-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Étude conjointe engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--arbelune-study-plan");
  writeFileSync(join(directory, "arbelune-study-anatomy-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--arbelune-study-anatomy-plan");
  writeFileSync(join(directory, "arbelune-study-anatomy-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Correction anatomique engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--arbelune-study-anatomy-plan");
  mkdirSync(join(directory, "arbelune-study-anatomies"));
  writeFileSync(
    join(directory, "arbelune-study-anatomies", "example-result.json"),
    JSON.stringify({ outcome: "study-ready-for-visual-review", preview: "/preview.html" }),
  );
  expect(describePilotStatus(db, directory)).toContain(
    "Correction anatomique de l’étude : study-ready-for-visual-review",
  );
  expect(describePilotStatus(db, directory)).toContain("zéro QA, aucun stade livré ou publié");
  expect(describePilotStatus(db, directory)).not.toContain("Correction anatomique engagée");
  writeFileSync(join(directory, "arbelune-study-stages.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--arbelune-study-inspect-plan");
  writeFileSync(join(directory, "arbelune-study-inspect-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Inspection des stades extraits engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--arbelune-study-inspect-plan");
  mkdirSync(join(directory, "arbelune-study-inspections"));
  const resultPath = join(directory, "arbelune-study-inspections", "example-result.json");
  writeFileSync(
    resultPath,
    JSON.stringify({ outcome: "rejected", inspectedImages: 3, fullValidation: false }),
  );
  expect(describePilotStatus(db, directory)).toContain(
    "3 images contrôlées ; validation complète : non",
  );
  writeFileSync(
    resultPath,
    JSON.stringify({
      outcome: "passed-for-visual-review",
      inspectedImages: 18,
      fullValidation: true,
    }),
  );
  expect(describePilotStatus(db, directory)).toContain(
    "18 images contrôlées ; validation complète : oui",
  );
  writeFileSync(
    join(directory, "validated-cast-approval.json"),
    JSON.stringify({
      visualApproved: true,
      scope: "six-creature-three-ages",
      inspectionRun: "validated-run",
    }),
  );
  expect(describePilotStatus(db, directory)).toContain(
    "Accord artistique enregistré sur les six lignées",
  );
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-babies-plan");
  mkdirSync(join(directory, "renewal/0"), { recursive: true });
  writeFileSync(join(directory, "renewal/0/babies-started.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Refonte du monde 0 engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-babies-plan");
  writeFileSync(
    join(directory, "renewal/0/run-result.json"),
    JSON.stringify({ outcome: "stopped" }),
  );
  expect(describePilotStatus(db, directory)).toContain("Refonte du monde 0 : stopped");
  writeFileSync(join(directory, "renewal/0/baby-repair-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-baby-repair-plan");
  writeFileSync(
    join(directory, "renewal/0/baby-repair-started.json"),
    JSON.stringify({ runId: "repair" }),
  );
  expect(describePilotStatus(db, directory)).toContain("Correction d’un bébé du monde 0 engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-baby-repair-plan");
  writeFileSync(
    join(directory, "renewal/0/repair-result.json"),
    JSON.stringify({ outcome: "rejected" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain(
    "Correction d’un bébé du monde 0 engagée",
  );
  writeFileSync(join(directory, "renewal/0/growth-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-growth-plan");
  writeFileSync(
    join(directory, "renewal/0/growth-started.json"),
    JSON.stringify({ runId: "growth" }),
  );
  expect(describePilotStatus(db, directory)).toContain("Évolutions du monde 0 engagées");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-growth-plan");
  writeFileSync(
    join(directory, "renewal/0/growth-result.json"),
    JSON.stringify({ outcome: "stopped" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain("Évolutions du monde 0 engagées");
  writeFileSync(join(directory, "renewal/0/growth-recovery.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-growth-resume-plan");
  writeFileSync(
    join(directory, "renewal/0/growth-resume-started.json"),
    JSON.stringify({ runId: "resumed" }),
  );
  expect(describePilotStatus(db, directory)).toContain("Reprise des évolutions du monde 0 engagée");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-growth-resume-plan");
  writeFileSync(
    join(directory, "renewal/0/resumed-result.json"),
    JSON.stringify({ outcome: "stopped" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain(
    "Reprise des évolutions du monde 0 engagée",
  );
  writeFileSync(join(directory, "renewal/0/face-repair-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-face-repair-plan");
  writeFileSync(
    join(directory, "renewal/0/face-repair-started.json"),
    JSON.stringify({ runId: "face" }),
  );
  expect(describePilotStatus(db, directory)).toContain(
    "Correction d’un visage adulte du monde 0 engagée",
  );
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-face-repair-plan");
  writeFileSync(
    join(directory, "renewal/0/face-result.json"),
    JSON.stringify({ outcome: "rejected" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain(
    "Correction d’un visage adulte du monde 0 engagée",
  );
  writeFileSync(join(directory, "renewal/0/face-repair-2-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-0-face-repair-2-plan");
  writeFileSync(
    join(directory, "renewal/0/face-repair-2-started.json"),
    JSON.stringify({ runId: "face2" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-0-face-repair-2-plan");
  expect(describePilotStatus(db, directory)).toContain("engagée (face-repair-2)");
  writeFileSync(
    join(directory, "renewal/0/face2-result.json"),
    JSON.stringify({ outcome: "rejected" }),
  );
  expect(describePilotStatus(db, directory)).not.toContain("engagée (face-repair-2)");
  writeFileSync(join(directory, "renewal-batch-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-batch");
  expect(describePilotStatus(db, directory)).not.toContain("face-repair");
  mkdirSync(join(directory, "renewal-batch"));
  writeFileSync(join(directory, "renewal-batch/summary.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("revue utilisateur monde par monde");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-batch");
  writeFileSync(join(directory, "renewal-batch-repair-plan.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("--renewal-batch-repair");
  expect(describePilotStatus(db, directory)).not.toContain("Lot terminé");
  writeFileSync(join(directory, "renewal-publication.json"), "{}");
  expect(describePilotStatus(db, directory)).toContain("Catalogue intégré : 47 créatures");
  expect(describePilotStatus(db, directory)).not.toContain("--renewal-batch");
});
