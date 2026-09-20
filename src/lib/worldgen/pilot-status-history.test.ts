import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { describePilotStatus, readPilotReservedUnits, readPilotTrace } from "./pilot-status";

let directory: string;
let db: ReturnType<typeof createDatabase>;
function put(path: string, value: unknown = {}) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return file;
}
function start() {
  put("started.json", { at: "2026-09-14", target: 6 });
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teddy-status-history-"));
  db = createDatabase(":memory:");
  runMigrations(db);
  db.$client.pragma("query_only=ON");
});
afterEach(() => {
  db.$client.close();
  rmSync(directory, { recursive: true, force: true });
});
it("reports an unstarted pilot and missing trace without creating any data", () => {
  expect(describePilotStatus(db, directory)).toBe("Pilote préparé ; aucun essai démarré.");
  expect(readPilotTrace(directory)).toEqual([]);
  expect(readPilotReservedUnits(directory)).toBe(0);
  start();
  const status = describePilotStatus(db, directory);
  expect(status).toContain("Job : absent");
  expect(status).toContain("0 emplacement(s)");
  expect(status).not.toContain("Dernière activité enregistrée");
});
it.each([-1, 1.5, "6", null])("rejects invalid pilot target %s", (target) => {
  put("started.json", { target });
  expect(() => describePilotStatus(db, directory)).toThrow("Marqueur de pilote invalide");
});
it.each([0, -1, 0.5, "100", null])("refuses unreadable budget units %s", (units) => {
  put("storage/worldgen/budget/2026-09/call.json", { units });
  expect(() => readPilotReservedUnits(directory)).toThrow("Journal de budget illisible");
});
it("refuses an overflowing sum even when individual reservations are valid", () => {
  put("storage/worldgen/budget/2026-08/a.json", { units: Number.MAX_SAFE_INTEGER });
  put("storage/worldgen/budget/2026-09/b.json", { units: 1 });
  expect(() => readPilotReservedUnits(directory)).toThrow("Journal de budget hors bornes");
});
it("distinguishes provider refusals from successful HTTP replies and ignores unrelated assets", () => {
  start();
  writeFileSync(
    join(directory, "requests.jsonl"),
    [
      { call: 1, type: "image" },
      { call: 1, status: 200, finishReason: "IMAGE_SAFETY" },
      { call: 2, type: "image" },
      { call: 2, status: 200, finishReason: "STOP" },
      { call: 3, status: 500, finishReason: "ERROR" },
    ]
      .map((v) => JSON.stringify(v))
      .join("\n"),
  );
  put("storage/generated/world/6/notes.json");
  put("storage/generated/world/6/runtime-old-teddy.png");
  put("storage/generated/world/6/runtime-new-teddy.png");
  put("result.json");
  put("preview.html");
  put("refinement-started.json");
  const status = describePilotStatus(db, directory);
  expect(status).toContain("1 emplacement(s)");
  expect(status).toContain("Appel 1 arrêté par le fournisseur : IMAGE_SAFETY");
  expect(status).not.toContain("Appel 2 arrêté");
  expect(status).not.toContain("sans réponse enregistrée");
  expect(status).toContain("Bilan de génération conservé");
  expect(status).toContain("Passe de correction déjà engagée");
});
const histories = [
  ["cast-previews", "Aperçu des bébés"],
  ["cast-growths", "Évolutions"],
  ["cast-redesigns", "Refonte"],
  ["growth-proofs", "Essai d’adulte"],
  ["growth-adolescents", "Trois âges de Vrillou"],
  ["growth-adolescent-clarifications", "Demande clarifiée de l’ado"],
  ["cast-completions", "Groupe complet"],
  ["cast-completion-inspections", "Inspection du groupe récupéré"],
  ["arbelune-repairs", "Correction d’Arbélune"],
  ["arbelune-adolescents", "Nouvel ado d’Arbélune"],
  ["arbelune-studies", "Étude conjointe d’Arbélune"],
  ["arbelune-study-anatomies", "Correction anatomique de l’étude"],
  ["arbelune-study-inspections", "Inspection des stades extraits"],
];
it.each([false, true])(
  "chooses newest results across every historical phase, optional galleries=%s",
  (gallery) => {
    start();
    for (const [folder] of [...histories, ["inspections"], ["refinements"]]) {
      put(`${folder}/ignore.json`, { outcome: "ignored" });
      const old = put(`${folder}/z-old-result.json`, { outcome: "obsolete", reason: "obsolete" });
      utimesSync(old, 10, 10);
      const latest = put(`${folder}/a-latest-result.json`, {
        outcome: "rejected",
        ...(gallery ? { preview: `${folder}/gallery.html`, reason: "stop-reason" } : {}),
      });
      utimesSync(latest, 20, 20);
    }
    const status = describePilotStatus(db, directory);
    for (const [folder, label] of histories) {
      expect(status).toContain(`${label} : rejected`);
      expect(status).toContain(`${folder}/a-latest-result.json`);
      if (gallery) expect(status).toContain(`${folder}/gallery.html`);
    }
    expect(status).toContain("Nombre inconnu d’ images contrôlées");
    expect(status).not.toContain("obsolete");
    expect(status).not.toContain("z-old-result");
    if (gallery) expect(status).toContain("stop-reason");
  },
);
it("empty history folders do not masquerade as completed phases", () => {
  start();
  for (const [folder] of [...histories, ["inspections"], ["refinements"]])
    put(`${folder}/notes.json`);
  expect(describePilotStatus(db, directory)).not.toContain("Dernier bilan");
});
it.each([
  ["cast-growth", "Passe d’évolution engagée"],
  ["cast-redesign", "Refonte engagée"],
  ["growth-proof", "Essai d’adulte engagé"],
  ["growth-adolescent", "Passe de l’ado engagée"],
  ["growth-adolescent-clarification", "Demande clarifiée engagée"],
  ["cast-completion", "Passe des cinq autres lignées engagée"],
])("keeps the unfinished %s marker authoritative", (phase, message) => {
  start();
  put(`${phase}-started.json`);
  expect(describePilotStatus(db, directory)).toContain(message);
});
it.each([
  ["cast-growth-approval", "Bébés validés"],
  ["cast-growth-redesign-plan", "L’utilisateur refuse les douze évolutions"],
  ["growth-proof-plan", "Refonte du groupe refusée"],
  ["growth-adolescent-approval", "Adulte de Vrillou validé"],
  ["growth-adolescent-clarification", "Première demande d’ado refusée"],
  ["cast-completion-plan", "Les trois âges de Vrillou sont validés"],
])("describes the recorded next step %s without performing it", (phase, message) => {
  start();
  put(`${phase}.json`);
  expect(describePilotStatus(db, directory)).toContain(message);
});
it("ignores artistic approval of a different scope", () => {
  start();
  put("validated-cast-approval.json", { visualApproved: true, scope: "different" });
  expect(describePilotStatus(db, directory)).not.toContain("Accord artistique enregistré");
});
