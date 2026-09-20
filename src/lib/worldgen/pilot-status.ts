import "server-only";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { pilotCeilingEur } from "./pilot-budget";

export interface PilotTraceEntry {
  call: number;
  type?: string;
  status?: number;
  prompts?: string[];
  referenceSha256?: string[];
  model?: string;
  verdict?: string[];
  finishReason?: string;
  blockReason?: string;
}

export function readPilotTrace(directory: string): PilotTraceEntry[] {
  const path = join(directory, "requests.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function readPilotReservedUnits(directory: string): number {
  const ledger = join(directory, "storage/worldgen/budget");
  let units = 0;
  if (existsSync(ledger))
    for (const month of readdirSync(ledger)) {
      for (const file of readdirSync(join(ledger, month))) {
        const value = JSON.parse(readFileSync(join(ledger, month, file), "utf8"));
        if (!Number.isSafeInteger(value.units) || value.units <= 0)
          throw new Error("Journal de budget illisible.");
        units += value.units;
      }
    }
  if (!Number.isSafeInteger(units)) throw new Error("Journal de budget hors bornes.");
  return units;
}

/** Read-only account of recorded activity. A running DB row does not prove a process is alive. */
export function describePilotStatus(db: Pick<AppDatabase, "select">, directory: string): string {
  if (existsSync(join(directory, "renewal-publication.json"))) {
    return "Catalogue intégré : 47 créatures, trois âges, monde 6 actif. Aucune génération à relancer. Preuves : data/teddy-world-pilot/renewal-publication.json.";
  }
  if (existsSync(join(directory, "renewal-batch-plan.json"))) {
    const batchName = existsSync(join(directory, "renewal-batch-repair-plan.json"))
      ? "renewal-batch-repair"
      : "renewal-batch";
    const folder = join(directory, batchName);
    const completed = existsSync(join(folder, "summary.json"));
    const budget = (readPilotReservedUnits(directory) / 1_000_000).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
    });
    return [
      completed
        ? "Lot terminé ; revue utilisateur monde par monde avant toute correction."
        : `Génération ${batchName === "renewal-batch-repair" ? "sélective" : "groupée"} prête ou à reprendre : node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --${batchName}`,
      `Budget réservé : ${budget} € / ${pilotCeilingEur(directory)} €.`,
      "Images existantes conservées. Aucune inspection payante ni correction automatique dans ce lot. Aucun monde publié.",
      `Galerie : ${join(folder, "index.html")}`,
    ].join("\n");
  }
  if (!existsSync(join(directory, "started.json"))) return "Pilote préparé ; aucun essai démarré.";
  const started = JSON.parse(readFileSync(join(directory, "started.json"), "utf8"));
  const target = started.target;
  if (!Number.isSafeInteger(target) || target < 0) throw new Error("Marqueur de pilote invalide.");
  const entries = readPilotTrace(directory);
  const requests = entries.filter((e) => e.type);
  const unresolved = requests.filter(
    (e) => !entries.some((r) => r.call === e.call && r.status !== undefined),
  );
  const providerStops = entries.filter(
    (entry) => entry.status === 200 && entry.finishReason && entry.finishReason !== "STOP",
  );
  const generated = join(directory, "storage/generated/world", String(target));
  const count = existsSync(generated)
    ? new Set(
        readdirSync(generated).flatMap((f) => {
          const match = f.match(
            /(background|tiles|teddy|(?:creature-\d+|legendary)(?:-(?:ado|adulte))?)\.png$/,
          );
          return match ? [match[1]] : [];
        }),
      ).size
    : 0;
  const units = readPilotReservedUnits(directory);
  const status =
    db
      .select({ status: jobs.status, type: jobs.type })
      .from(jobs)
      .all()
      .filter((j) => j.type === "generate_world")
      .map((j) => j.status)
      .join(", ") || "absent";
  const trace = join(directory, "requests.jsonl");
  const inspections = join(directory, "inspections");
  const latest = existsSync(inspections)
    ? readdirSync(inspections)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(inspections, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const refinements = join(directory, "refinements");
  const latestRefinement = existsSync(refinements)
    ? readdirSync(refinements)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(refinements, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const refinement = latestRefinement
    ? JSON.parse(readFileSync(latestRefinement, "utf8"))
    : undefined;
  const casts = join(directory, "cast-previews");
  const latestCast = existsSync(casts)
    ? readdirSync(casts)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(casts, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const cast = latestCast ? JSON.parse(readFileSync(latestCast, "utf8")) : undefined;
  const growths = join(directory, "cast-growths");
  const latestGrowth = existsSync(growths)
    ? readdirSync(growths)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(growths, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const growth = latestGrowth ? JSON.parse(readFileSync(latestGrowth, "utf8")) : undefined;
  const redesigns = join(directory, "cast-redesigns");
  const latestRedesign = existsSync(redesigns)
    ? readdirSync(redesigns)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(redesigns, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const redesign = latestRedesign ? JSON.parse(readFileSync(latestRedesign, "utf8")) : undefined;
  const proofs = join(directory, "growth-proofs");
  const latestProof = existsSync(proofs)
    ? readdirSync(proofs)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(proofs, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const proof = latestProof ? JSON.parse(readFileSync(latestProof, "utf8")) : undefined;
  const adolescents = join(directory, "growth-adolescents");
  const latestAdolescent = existsSync(adolescents)
    ? readdirSync(adolescents)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(adolescents, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const adolescent = latestAdolescent
    ? JSON.parse(readFileSync(latestAdolescent, "utf8"))
    : undefined;
  const clarifications = join(directory, "growth-adolescent-clarifications");
  const latestClarification = existsSync(clarifications)
    ? readdirSync(clarifications)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(clarifications, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const clarification = latestClarification
    ? JSON.parse(readFileSync(latestClarification, "utf8"))
    : undefined;
  const completions = join(directory, "cast-completions");
  const latestCompletion = existsSync(completions)
    ? readdirSync(completions)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(completions, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const completion = latestCompletion
    ? JSON.parse(readFileSync(latestCompletion, "utf8"))
    : undefined;
  const recoveredInspections = join(directory, "cast-completion-inspections");
  const latestRecoveredInspection = existsSync(recoveredInspections)
    ? readdirSync(recoveredInspections)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(recoveredInspections, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const recoveredInspection = latestRecoveredInspection
    ? JSON.parse(readFileSync(latestRecoveredInspection, "utf8"))
    : undefined;
  const arbeluneRepairs = join(directory, "arbelune-repairs");
  const latestArbeluneRepair = existsSync(arbeluneRepairs)
    ? readdirSync(arbeluneRepairs)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(arbeluneRepairs, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const arbeluneRepair = latestArbeluneRepair
    ? JSON.parse(readFileSync(latestArbeluneRepair, "utf8"))
    : undefined;
  const arbeluneAdolescents = join(directory, "arbelune-adolescents");
  const latestArbeluneAdolescent = existsSync(arbeluneAdolescents)
    ? readdirSync(arbeluneAdolescents)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(arbeluneAdolescents, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const arbeluneAdolescent = latestArbeluneAdolescent
    ? JSON.parse(readFileSync(latestArbeluneAdolescent, "utf8"))
    : undefined;
  const arbeluneStudies = join(directory, "arbelune-studies");
  const latestArbeluneStudy = existsSync(arbeluneStudies)
    ? readdirSync(arbeluneStudies)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(arbeluneStudies, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const arbeluneStudy = latestArbeluneStudy
    ? JSON.parse(readFileSync(latestArbeluneStudy, "utf8"))
    : undefined;
  const anatomyDirectory = join(directory, "arbelune-study-anatomies");
  const anatomyResult = existsSync(anatomyDirectory)
    ? readdirSync(anatomyDirectory)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(anatomyDirectory, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const anatomy = anatomyResult ? JSON.parse(readFileSync(anatomyResult, "utf8")) : undefined;
  const studyInspectionDirectory = join(directory, "arbelune-study-inspections");
  const studyInspectionPath = existsSync(studyInspectionDirectory)
    ? readdirSync(studyInspectionDirectory)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(studyInspectionDirectory, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  const studyInspection = studyInspectionPath
    ? JSON.parse(readFileSync(studyInspectionPath, "utf8"))
    : undefined;
  const approvalPath = join(directory, "validated-cast-approval.json");
  const approval = existsSync(approvalPath)
    ? JSON.parse(readFileSync(approvalPath, "utf8"))
    : undefined;
  const renewalStatus: string[] = [];
  if (approval?.visualApproved === true && approval?.scope === "six-creature-three-ages") {
    renewalStatus.push(
      `Accord artistique enregistré sur les six lignées et leurs dix-huit arts : ${approval.inspectionRun}. Aucune publication familiale. Les essais suivants sont historiques.`,
    );
    for (let index = 0; index < 6; index++) {
      const folder = join(directory, "renewal", String(index));
      if (!existsSync(join(folder, "babies-started.json"))) continue;
      const latest = readdirSync(folder)
        .filter((f) => f.endsWith("-result.json"))
        .map((f) => join(folder, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      renewalStatus.push(
        latest
          ? `Refonte du monde ${index} : ${JSON.parse(readFileSync(latest, "utf8")).outcome}. Bilan : ${latest}. Conserver images, diagnostics et budget ; aucune relance automatique.`
          : `Refonte du monde ${index} engagée : consulter ${folder}. Cet état ne prouve pas qu’un processus tourne ; conserver tous les fichiers.`,
      );
      const correctionMarker = join(folder, "baby-repair-started.json");
      if (existsSync(correctionMarker)) {
        const correction = JSON.parse(readFileSync(correctionMarker, "utf8"));
        if (!existsSync(join(folder, `${correction.runId}-result.json`)))
          renewalStatus.push(
            `Correction d’un bébé du monde ${index} engagée ; conserver le marqueur et tous les fichiers. Aucune relance automatique.`,
          );
      } else if (existsSync(join(folder, "baby-repair-plan.json"))) {
        renewalStatus.push(
          `Correction d’un seul bébé préparée ; les autres arts sont conservés. Plan sans API : --renewal-${index}-baby-repair-plan.`,
        );
      }
      const growthMarker = join(folder, "growth-started.json");
      const resumeMarker = join(folder, "growth-resume-started.json");
      if (existsSync(resumeMarker)) {
        const resume = JSON.parse(readFileSync(resumeMarker, "utf8"));
        if (!existsSync(join(folder, `${resume.runId}-result.json`)))
          renewalStatus.push(
            `Reprise des évolutions du monde ${index} engagée ; conserver les deux marqueurs, les dessins et le budget. Aucune relance automatique.`,
          );
      } else if (existsSync(join(folder, "growth-recovery.json"))) {
        renewalStatus.push(
          `Détourage récupéré localement, âges déjà obtenus conservés. Plan des seules évolutions restantes : --renewal-${index}-growth-resume-plan. Ne pas relancer --renewal-${index}-growth.`,
        );
      } else if (existsSync(growthMarker)) {
        const growth = JSON.parse(readFileSync(growthMarker, "utf8"));
        if (!existsSync(join(folder, `${growth.runId}-result.json`)))
          renewalStatus.push(
            `Évolutions du monde ${index} engagées ; conserver chaque dessin, le marqueur et le budget. Aucun redémarrage automatique.`,
          );
      } else if (existsSync(join(folder, "growth-plan.json"))) {
        renewalStatus.push(
          `Bébés du monde ${index} approuvés, évolutions préparées. Plan sans API : --renewal-${index}-growth-plan.`,
        );
      }
      for (const facePhase of ["face-repair", "face-repair-2"]) {
        const faceMarker = join(folder, `${facePhase}-started.json`);
        if (existsSync(faceMarker)) {
          const face = JSON.parse(readFileSync(faceMarker, "utf8"));
          if (!existsSync(join(folder, `${face.runId}-result.json`)))
            renewalStatus.push(
              `Correction d’un visage adulte du monde ${index} engagée (${facePhase}) ; conserver images, diagnostics et budget. Aucune relance automatique.`,
            );
        } else if (existsSync(join(folder, `${facePhase}-plan.json`))) {
          renewalStatus.push(
            `Un visage adulte à corriger ; tous les autres arts sont conservés. Plan sans API : --renewal-${index}-${facePhase}-plan. La lignée corrigée est inspectée avant les autres.`,
          );
        }
      }
    }
    if (!existsSync(join(directory, "renewal/0/babies-started.json")))
      renewalStatus.push(
        "Prochaine passe préparée : sept bébés du monde 0. Plan sans API : --renewal-0-babies-plan.",
      );
  }
  return [
    `Essai du ${started.at} · monde ${target + 1}.`,
    `${count} emplacement(s) d’image du pilote, ${requests.length} appel(s) envoyé(s), ${(units / 1_000_000).toFixed(2).replace(".", ",")} € réservés (plafond ${pilotCeilingEur(directory)} €).`,
    ...renewalStatus,
    ...unresolved.map((e) => `appel ${e.call} sans réponse enregistrée.`),
    ...providerStops.map(
      (entry) =>
        `Appel ${entry.call} arrêté par le fournisseur : ${entry.finishReason} (HTTP 200). Ce statut n’est pas une image réussie.`,
    ),
    `Job : ${status}. Cet état ne prouve pas que le processus tourne encore.`,
    ...(existsSync(trace)
      ? [`Dernière activité enregistrée : ${statSync(trace).mtime.toISOString()}.`]
      : []),
    existsSync(join(directory, "result.json"))
      ? `Bilan de génération conservé : ${join(directory, "result.json")}`
      : "Aucun bilan final enregistré.",
    ...(latest ? [`Dernier bilan d’inspection : ${latest}`] : []),
    ...(latestRefinement
      ? [
          `Dernier bilan de correction : ${latestRefinement}`,
          ...(typeof refinement?.reason === "string" ? [refinement.reason] : []),
        ]
      : []),
    ...(latestCast
      ? [
          `Dernier bilan de nouvelle faune : ${latestCast}`,
          `Aperçu des bébés : ${cast.outcome}. Aucun monde publié par cette passe.`,
          ...(typeof cast.preview === "string"
            ? [`Galerie des nouveaux bébés : ${cast.preview}`]
            : []),
        ]
      : []),
    ...(latestGrowth
      ? [
          `Dernier bilan des évolutions : ${latestGrowth}`,
          `Évolutions : ${growth.outcome}. Aucun monde publié par cette passe.`,
          ...(typeof growth.preview === "string"
            ? [`Galerie des trois âges : ${growth.preview}`]
            : []),
        ]
      : existsSync(join(directory, "cast-growth-started.json"))
        ? [
            `Passe d’évolution engagée : consulter ${growths}. Conserver tous les fichiers ; aucune relance automatique.`,
          ]
        : []),
    ...(latestRedesign
      ? [
          `Dernier bilan de refonte des douze évolutions : ${latestRedesign}`,
          `Refonte : ${redesign.outcome}. Aucun monde publié par cette passe.`,
          ...(typeof redesign.preview === "string"
            ? [`Galerie révisée : ${redesign.preview}`]
            : []),
        ]
      : existsSync(join(directory, "cast-redesign-started.json"))
        ? [
            `Refonte engagée : consulter ${redesigns}. Conserver tous les fichiers ; aucune relance automatique.`,
          ]
        : []),
    existsSync(join(directory, "preview.html"))
      ? `Galerie : ${join(directory, "preview.html")}`
      : "Galerie complète pas encore disponible.",
    "Suivi sans appel API : worldgen-pilot.ts --status",
    ...(latestProof
      ? [
          `Essai d’adulte : ${proof.outcome}. Bilan : ${latestProof}. Aucun groupe validé/publié.`,
          ...(typeof proof.preview === "string" ? [`Galerie de l’essai : ${proof.preview}`] : []),
        ]
      : existsSync(join(directory, "growth-proof-started.json"))
        ? [`Essai d’adulte engagé : consulter ${proofs}. Conserver le marqueur ; aucune relance.`]
        : []),
    ...(latestAdolescent
      ? [
          `Trois âges de Vrillou : ${adolescent.outcome}. Bilan : ${latestAdolescent}. Aucune publication.`,
          ...(typeof adolescent.preview === "string"
            ? [`Galerie des trois âges : ${adolescent.preview}`]
            : []),
        ]
      : existsSync(join(directory, "growth-adolescent-started.json"))
        ? [
            `Passe de l’ado engagée : consulter ${adolescents}. Conserver le marqueur ; aucune relance.`,
          ]
        : []),
    ...(latestClarification
      ? [
          `Demande clarifiée de l’ado : ${clarification.outcome}. Bilan : ${latestClarification}. Aucun autre lancement automatique.`,
          ...(typeof clarification.preview === "string"
            ? [`Galerie : ${clarification.preview}`]
            : []),
        ]
      : existsSync(join(directory, "growth-adolescent-clarification-started.json"))
        ? [
            `Demande clarifiée engagée : consulter ${clarifications}. Ne pas effacer le marqueur pour relancer.`,
          ]
        : []),
    ...(latestCompletion
      ? [
          `Groupe complet : ${completion.outcome}. Bilan : ${latestCompletion}. Aucun personnage publié.`,
          ...(typeof completion.preview === "string"
            ? [`Galerie des six lignées : ${completion.preview}`]
            : []),
        ]
      : existsSync(join(directory, "cast-completion-started.json"))
        ? [
            `Passe des cinq autres lignées engagée : consulter ${completions}. Conserver le marqueur ; aucune relance.`,
          ]
        : []),
    ...(latestRecoveredInspection
      ? [
          `Inspection du groupe récupéré : ${recoveredInspection.outcome}. Bilan : ${latestRecoveredInspection}.`,
          ...(typeof recoveredInspection.preview === "string"
            ? [`Galerie : ${recoveredInspection.preview}`]
            : []),
          "Passe terminée, aucune relance automatique. Conserver les dix-huit images, les résultats et le budget.",
        ]
      : existsSync(join(directory, "cast-completion-inspect-started.json"))
        ? [
            `Inspection du groupe récupéré engagée : consulter ${recoveredInspections}. Conserver le marqueur ; aucune relance.`,
          ]
        : existsSync(join(directory, "cast-completion-recovery.json"))
          ? [
              "Dix images conservées après l’arrêt de détourage ; ado d’Arbélune recadré localement. Plan des dix-huit inspections sans génération : --cast-completion-inspect-plan. Ne pas relancer --cast-completion.",
            ]
          : []),
    ...(!existsSync(join(directory, "cast-completion-recovery.json")) &&
    existsSync(join(directory, "cast-completion-plan.json"))
      ? [
          "Les trois âges de Vrillou sont validés. Passe distincte des cinq autres lignées : --cast-completion-plan (sans API). Dix nouvelles images, six bébés et Vrillou conservés, dix-huit QA fraîches ; ne relancer aucune ancienne passe.",
        ]
      : existsSync(join(directory, "cast-completion-recovery.json"))
        ? []
        : existsSync(join(directory, "growth-adolescent-clarification.json"))
          ? [
              "Première demande d’ado refusée par Gemini. Ancien marqueur/résultat/budget conservés. Description de l’animal clarifiée, mêmes filtres ; plan distinct sans API : --growth-adolescent-clarification-plan. Ne pas relancer --growth-adolescent ni --growth-proof.",
            ]
          : existsSync(join(directory, "growth-adolescent-approval.json"))
            ? [
                "Adulte de Vrillou validé par l’utilisateur. Bébé/adulte conservés ; un ado et trois QA prévus. Plan sans API : --growth-adolescent-plan. Ne pas relancer --growth-proof ni les anciennes passes du groupe.",
              ]
            : existsSync(join(directory, "growth-proof-plan.json"))
              ? [
                  "Refonte du groupe refusée : ne relancer ni --cast-growth ni --cast-redesign. Essai distinct sur un adulte seulement ; plan sans API : --growth-proof-plan. Aucun élargissement automatique.",
                ]
              : existsSync(join(directory, "cast-growth-redesign-plan.json"))
                ? [
                    "L’utilisateur refuse les douze évolutions, y compris les QA positives. Plan de refonte sans API : --cast-redesign-plan. Ne pas relancer --cast-growth.",
                  ]
                : existsSync(join(directory, "cast-growth-approval.json"))
                  ? [
                      "Bébés validés : plan des évolutions sans API via --cast-growth-plan. Conserver les anciennes passes terminées.",
                    ]
                  : [
                      "Après interruption confirmée, reprise de génération : worldgen-pilot.ts --resume",
                      "Après erreur technique d’inspection, vérifier les images existantes : worldgen-pilot.ts --inspect",
                      "Après refus de croissance/style d’un stade, plan sans API : worldgen-pilot.ts --refine-plan",
                    ]),
    ...(latestArbeluneRepair
      ? [
          `Correction d’Arbélune : ${arbeluneRepair.outcome}. Bilan : ${latestArbeluneRepair}.`,
          ...(typeof arbeluneRepair.preview === "string"
            ? [`Galerie : ${arbeluneRepair.preview}`]
            : []),
          "Correction terminée, conserver les images et verdicts ; aucune relance automatique.",
        ]
      : existsSync(join(directory, "arbelune-repair-started.json"))
        ? [
            `Correction d’Arbélune engagée : consulter ${arbeluneRepairs}. Conserver tous les fichiers.`,
          ]
        : existsSync(join(directory, "arbelune-repair-plan.json"))
          ? [
              "Le retour utilisateur refuse le visage illisible de l’adulte, malgré son ancienne QA positive ; l’ado est aussi refusé par la QA. Correction ciblée des deux âges : --arbelune-repair-plan (sans API), seize arts conservés, contrôle du visage à 128 px et dix-huit inspections fraîches. Ne relancer aucune passe terminée.",
            ]
          : []),
    ...(latestArbeluneAdolescent
      ? [
          `Nouvel ado d’Arbélune : ${arbeluneAdolescent.outcome}. Bilan : ${latestArbeluneAdolescent}.`,
          ...(typeof arbeluneAdolescent.preview === "string"
            ? [`Galerie : ${arbeluneAdolescent.preview}`]
            : []),
          "Passe terminée ; aucune relance automatique, conserver les images et le budget.",
        ]
      : existsSync(join(directory, "arbelune-adolescent-started.json"))
        ? [
            `Nouvel ado d’Arbélune engagé : consulter ${arbeluneAdolescents}. Conserver le marqueur et les fichiers.`,
          ]
        : existsSync(join(directory, "arbelune-adolescent-plan.json"))
          ? [
              "Visage corrigé, adulte positif en QA, ado refusé : sa silhouette fermée ne correspond plus à l’arche ouverte. Plan ciblé --arbelune-adolescent-plan (sans API) : un ado avec les images bébé/adulte, dix-sept arts conservés et dix-huit QA. Ne pas relancer --arbelune-repair.",
            ]
          : []),
    ...(latestArbeluneStudy
      ? [
          `Étude conjointe d’Arbélune : ${arbeluneStudy.outcome}. Bilan : ${latestArbeluneStudy}.`,
          ...(typeof arbeluneStudy.preview === "string"
            ? [`Planche : ${arbeluneStudy.preview}`]
            : []),
          "Étude seulement, aucun stade validé ou publié. Conserver la planche et le budget, aucune relance automatique.",
        ]
      : existsSync(join(directory, "arbelune-study-started.json"))
        ? [
            `Étude conjointe engagée : consulter ${arbeluneStudies}. Conserver le marqueur et tous les fichiers.`,
          ]
        : existsSync(join(directory, "arbelune-study-plan.json"))
          ? [
              "La paire ado/adulte est refusée par l’utilisateur et la QA. Prochaine étape : --arbelune-study-plan (sans API), une planche des deux formes conçues ensemble, bébé conservé, aucune QA globale avant examen visuel. Ne relancer aucune ancienne commande de génération ou d’inspection.",
            ]
          : []),
    ...(anatomyResult
      ? [
          `Correction anatomique de l’étude : ${anatomy.outcome}. Bilan : ${anatomyResult}.`,
          ...(typeof anatomy.preview === "string" ? [`Planche : ${anatomy.preview}`] : []),
          "Direction retenue, anatomie encore à examiner ; zéro QA, aucun stade livré ou publié. Conserver le résultat et le budget, aucune relance automatique.",
        ]
      : existsSync(join(directory, "arbelune-study-anatomy-started.json"))
        ? [
            `Correction anatomique engagée : consulter ${anatomyDirectory}. Conserver le marqueur et les fichiers.`,
          ]
        : existsSync(join(directory, "arbelune-study-anatomy-plan.json"))
          ? [
              "Direction de l’étude validée par l’utilisateur. Plan --arbelune-study-anatomy-plan (sans API) : une planche corrigée, quatre ouvertures et six racines distinctes, étude et bébé comme références ; zéro inspection et aucun remplacement d’art.",
            ]
          : []),
    ...(studyInspectionPath
      ? [
          `Inspection des stades extraits : ${studyInspection.outcome}. Bilan : ${studyInspectionPath}.`,
          `${studyInspection.inspectedImages ?? "Nombre inconnu d’"} images contrôlées ; validation complète : ${studyInspection.fullValidation === true ? "oui" : "non"}. Aucune publication.`,
          ...(typeof studyInspection.preview === "string"
            ? [`Galerie : ${studyInspection.preview}`]
            : []),
          "Conserver le résultat et le budget, aucune relance automatique.",
        ]
      : existsSync(join(directory, "arbelune-study-inspect-started.json"))
        ? [
            `Inspection des stades extraits engagée : consulter ${studyInspectionDirectory}. Conserver tous les fichiers.`,
          ]
        : existsSync(join(directory, "arbelune-study-stages.json"))
          ? [
              "Étude acceptée visuellement, deux stades extraits localement. Plan --arbelune-study-inspect-plan (sans API) : zéro génération, trois QA d’Arbélune puis quinze autres seulement si la lignée passe. Seize autres arts conservés, aucun monde publié.",
            ]
          : []),
    ...(existsSync(join(directory, "refinement-started.json"))
      ? [
          `Passe de correction déjà engagée : consulter ${join(directory, "refinements")}. Aucun nouveau lancement.`,
        ]
      : []),
    "Le marqueur, les images et le budget sont conservés. Aucun nouveau lancement par --generate.",
  ].join("\n");
}
