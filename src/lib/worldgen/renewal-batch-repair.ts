import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batchHash, batchTasks, type BatchWorld } from "./renewal-batch";
import { createWorldAssetStore } from "./runtime-assets";

type Repair = { key: string; ref?: string; sha256?: string; prompt?: string };
type RepairPlan = {
  version: number;
  batchPlanSha256: string;
  summarySha256: string;
  results: Record<string, string>;
  repairs: Repair[];
};
/** The user's accepted images are immutable; only the recorded failures may receive replacements. */
export function loadBatchRepair(directory: string, worlds: BatchWorld[]) {
  const path = join(directory, "renewal-batch-repair-plan.json");
  const bytes = readFileSync(path),
    plan: RepairPlan = JSON.parse(bytes.toString());
  const sha256 = batchHash(bytes),
    tasks = batchTasks(worlds);
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  function resolve() {
    if (
      batchHash(readFileSync(path)) !== sha256 ||
      plan.version !== 1 ||
      batchHash(readFileSync(join(directory, "renewal-batch-plan.json"))) !==
        plan.batchPlanSha256 ||
      batchHash(readFileSync(join(directory, "renewal-batch/summary.json"))) !==
        plan.summarySha256 ||
      Object.keys(plan.results).length !== tasks.length ||
      new Set(plan.repairs.map((r) => r.key)).size !== plan.repairs.length
    )
      throw new Error("Sources de la reprise sélective modifiées.");
    const output = structuredClone(worlds);
    let replaced = 0;
    for (const task of tasks) {
      const source = readFileSync(join(directory, "renewal-batch", task.key, "result.json"));
      if (batchHash(source) !== plan.results[task.key]) throw new Error("Résultat source modifié.");
      const result = JSON.parse(source.toString());
      const repair = plan.repairs.find((r) => r.key === task.key);
      const creature = output.find((w) => w.worldIndex === task.worldIndex)!.creatures[task.slot];
      let ref: string | undefined, prompt: string | undefined;
      if (result.status === "ready") {
        if (repair) throw new Error("Une image approuvée ne doit pas être reprise.");
        if (!result.ref || batchHash(store.read(result.ref)) !== result.sha256)
          throw new Error("Image approuvée modifiée.");
        ref = result.ref;
      } else {
        if (!repair) throw new Error("Réparation manquante pour un échec du lot.");
        replaced++;
        if (result.status === "cutout-review") {
          if (
            !repair.ref ||
            repair.prompt ||
            !result.raw ||
            batchHash(readFileSync(join(directory, result.raw))) !== result.sha256 ||
            batchHash(store.read(repair.ref)) !== repair.sha256
          )
            throw new Error("Détourage local ou original modifié.");
          ref = repair.ref;
        } else if (result.status === "failed" || result.status === "uncertain") {
          if (
            repair.ref ||
            !repair.prompt ||
            repair.prompt.length < 100 ||
            repair.prompt.length > 7000
          )
            throw new Error("Description de l’image manquante invalide.");
          prompt = repair.prompt;
        } else throw new Error("Statut source inattendu.");
      }
      creature.ages[task.stage - 1] = ref
        ? { stage: task.stage, ref }
        : { stage: task.stage, prompt };
    }
    if (replaced !== plan.repairs.length) throw new Error("Réparation hors des échecs du lot.");
    return output;
  }
  return {
    worlds: resolve(),
    sha256,
    verify: () => {
      resolve();
    },
  };
}
