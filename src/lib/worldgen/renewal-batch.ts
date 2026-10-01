import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cutoutNewCreature } from "./creature-growth";
import { createWorldAssetStore } from "./runtime-assets";

export interface BatchWorld {
  worldIndex: number;
  label: string;
  creatures: { name: string; ages: { stage: number; prompt?: string; ref?: string }[] }[];
}
export interface BatchTask {
  key: string;
  worldIndex: number;
  slot: number;
  name: string;
  stage: number;
  prompt: string;
}
interface BatchResult {
  status: "ready" | "cutout-review" | "failed" | "uncertain";
  ref?: string;
  raw?: string;
  sha256?: string;
  reason?: string;
}
export const batchHash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
export class BatchTransportError extends Error {}
export function batchTasks(worlds: BatchWorld[]): BatchTask[] {
  return worlds.flatMap((w) =>
    [1, 3, 2].flatMap((stage) =>
      w.creatures.flatMap((c, slot) => {
        const age = c.ages.find((a) => a.stage === stage);
        return age?.prompt
          ? [
              {
                key: `${w.worldIndex}-${slot}-${stage}`,
                worldIndex: w.worldIndex,
                slot,
                name: c.name,
                stage,
                prompt: age.prompt,
              },
            ]
          : [];
      }),
    ),
  );
}
export function pendingBatchTasks(
  directory: string,
  tasks: BatchTask[],
  batchName = "renewal-batch",
) {
  return tasks.filter(
    (t) =>
      !existsSync(join(directory, batchName, t.key, "attempt.json")) &&
      !existsSync(join(directory, batchName, t.key, "result.json")),
  );
}

/** Candidates only: a matte failure never blocks the remaining worlds. No inspection or publisher. */
export async function generateRenewalBatch(options: {
  directory: string;
  worlds: BatchWorld[];
  planSha256: string;
  batchName?: "renewal-batch" | "renewal-batch-repair";
  guard: () => void;
  remainingUnits: () => number;
  generate: (task: BatchTask, checkpoint: string) => Promise<Buffer>;
}) {
  const {
    directory,
    worlds,
    planSha256,
    guard,
    remainingUnits,
    generate,
    batchName = "renewal-batch",
  } = options;
  const folder = join(directory, batchName),
    marker = join(folder, "started.json"),
    tasks = batchTasks(worlds);
  guard();
  if (remainingUnits() < pendingBatchTasks(directory, tasks, batchName).length * 100_000)
    throw new Error("Budget insuffisant pour tout le lot restant.");
  mkdirSync(folder, { recursive: true });
  if (existsSync(marker)) {
    if (JSON.parse(readFileSync(marker, "utf8")).planSha256 !== planSha256)
      throw new Error("Plan du lot modifié ; conserver les résultats.");
  } else save(marker, { version: 1, planSha256, at: new Date().toISOString(), published: false });
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const results = new Map<string, BatchResult>();
  for (const task of tasks) {
    const path = join(folder, task.key, "result.json");
    if (existsSync(path)) {
      const result: BatchResult = JSON.parse(readFileSync(path, "utf8"));
      const bytes = result.ref
        ? store.read(result.ref)
        : result.raw
          ? readFileSync(join(directory, result.raw))
          : undefined;
      if (bytes && batchHash(bytes) !== result.sha256) throw new Error("Image du lot modifiée.");
      results.set(task.key, result);
    }
  }
  const render = () => renderBatchGallery(directory, worlds, results, batchName);
  render();
  for (const task of tasks) {
    if (results.has(task.key)) continue;
    guard();
    const checkpoint = join(folder, task.key),
      attempt = join(checkpoint, "attempt.json"),
      raw = join(checkpoint, "raw.png");
    mkdirSync(checkpoint, { recursive: true });
    let result: BatchResult, fatal: unknown;
    if (existsSync(attempt) && !existsSync(raw)) {
      result = {
        status: "uncertain",
        reason: "Appel déjà engagé sans image récupérable ; aucune relance payante.",
      };
    } else {
      try {
        if (!existsSync(raw)) {
          if (remainingUnits() < 100_000) throw new BatchTransportError("Plafond cumulé atteint.");
          save(attempt, { planSha256, task, at: new Date().toISOString() });
          const bytes = await generate(task, checkpoint);
          if (!existsSync(raw)) writeFileSync(raw, bytes, { flag: "wx" });
        }
        const bytes = readFileSync(raw);
        try {
          const cutout = await cutoutNewCreature(bytes);
          const name =
            task.slot === worlds.find((w) => w.worldIndex === task.worldIndex)!.creatures.length - 1
              ? "legendary"
              : `creature-${task.slot}`;
          const ref = await store.write(
            task.worldIndex,
            `${name}${task.stage === 1 ? "" : task.stage === 2 ? "-ado" : "-adulte"}.png`,
            cutout,
          );
          result = { status: "ready", ref, sha256: batchHash(store.read(ref)) };
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Détourage à examiner.";
          result = reason.startsWith("Détourage non fiable")
            ? {
                status: "cutout-review",
                raw: relative(directory, raw),
                sha256: batchHash(bytes),
                reason,
              }
            : { status: "failed", reason };
        }
      } catch (error) {
        result = {
          status: "failed",
          reason: error instanceof Error ? error.message : "Génération interrompue.",
        };
        if (error instanceof BatchTransportError) fatal = error;
      }
    }
    save(join(checkpoint, "result.json"), result);
    results.set(task.key, result);
    render();
    if (fatal) throw fatal;
  }
  const summary = {
    outcome: "ready-for-human-review",
    generated: [...results.values()].filter((r) => r.ref || r.raw).length,
    issues: [...results]
      .filter(([, r]) => r.status !== "ready")
      .map(([key, result]) => ({ key, ...result })),
    inspections: 0,
    qaPassed: false,
    published: false,
    databaseWritten: false,
    preview: join(folder, "index.html"),
  };
  writeFileSync(join(folder, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function renderBatchGallery(
  directory: string,
  worlds: BatchWorld[],
  results: Map<string, BatchResult>,
  batchName = "renewal-batch",
) {
  const folder = join(directory, batchName);
  mkdirSync(folder, { recursive: true });
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{max-width:1150px;margin:2rem auto;padding:1rem;font:18px system-ui;background:#f4f0e5;color:#263e37}article{background:white;padding:1rem;border-radius:16px;margin:1rem 0}.ages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}figure{margin:0;text-align:center}img,.pending{width:100%;height:270px;object-fit:contain;background:#e8eee6;border-radius:12px}.pending{display:grid;place-content:center}small{display:block}a{color:#315848}nav{display:flex;gap:1rem;flex-wrap:wrap}figcaption{padding:.5rem}@media(max-width:600px){img,.pending{height:150px}.ages{gap:.4rem}}</style><h1>${escape(title)}</h1>${body}</html>`;
  const nav = worlds
    .map((w) => `<a href="world-${w.worldIndex}.html">Monde ${w.worldIndex}</a>`)
    .join(" ");
  writeFileSync(
    join(folder, "index.html"),
    page(
      "TEDDy · Revue des mondes",
      `<p>Les trois âges, monde par monde. Note les noms et les âges à corriger. Rien n’est encore remplacé dans le jeu.</p><nav>${nav}</nav>${worlds.map((w) => `<article><h2><a href="world-${w.worldIndex}.html">Monde ${w.worldIndex} · ${escape(w.label)}</a></h2><p>${w.creatures.length} créatures · ${w.creatures.length * 3} images</p></article>`).join("")}`,
    ),
  );
  for (const world of worlds) {
    const cards = world.creatures
      .map(
        (c, slot) =>
          `<article><h2>${escape(c.name)}</h2><div class="ages">${c.ages
            .map((age) => {
              const result = results.get(`${world.worldIndex}-${slot}-${age.stage}`),
                ref = age.ref ?? result?.ref;
              const src = ref
                ? `../storage/generated/${ref}`
                : result?.raw
                  ? `../${result.raw}`
                  : undefined;
              return `<figure>${src ? `<img src="${escape(src)}" alt="${escape(c.name)}">` : `<div class="pending">${result ? "À reprendre" : "À produire"}</div>`}<figcaption>${["", "Bébé", "Ado", "Adulte"][age.stage]}${result?.status === "cutout-review" ? "<small>Fond à reprendre</small>" : result?.reason ? `<small>${escape(result.reason)}</small>` : ""}</figcaption></figure>`;
            })
            .join("")}</div></article>`,
      )
      .join("");
    writeFileSync(
      join(folder, `world-${world.worldIndex}.html`),
      page(
        `Monde ${world.worldIndex} · ${world.label}`,
        `<nav><a href="index.html">Tous les mondes</a>${nav}</nav>${cards}`,
      ),
    );
  }
}
