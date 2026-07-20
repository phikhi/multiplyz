import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Garde de CÂBLAGE du verrou de session dans le playbook (#298).
 *
 * ── Ce que cette garde prouve, et ce qu'elle NE prouve PAS (#164, honnêteté) ────────────────────
 * Le câblage `acquire`/`heartbeat`/`release` vit en **prose de playbook** (`SKILL.md`), lue par un
 * agent — ce n'est PAS du code exécutable. Aucun test ne peut donc prouver que l'orchestrateur
 * OBÉIT à ces instructions au runtime : c'est un **résidu de testabilité assumé**.
 *
 * Ce que cette garde prouve, en revanche, est réel et non-vacuous : que **chaque terminaison propre
 * énumérée porte effectivement son `release`** dans le document livré. C'est précisément la classe
 * de défaut qui a échappé à DEUX rounds de review successifs (heartbeat non ancré au round 1,
 * `release` manquant sur la sortie la plus fréquente au round 2) — un ancrage supprimé ou une
 * terminaison ajoutée sans `release` fait ROUGIR ce fichier.
 *
 * Validée ADVERSARIALEMENT (#296) : retirer le `release` de n'importe quel ancrage, ou ajouter une
 * ligne de `release` non enregistrée, rend ce test rouge. Une garde de balayage dont la sortie
 * vide « prouverait » l'exhaustivité sans avoir été vue rougir est un reçu #164.
 */

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "SKILL.md");
const RELEASE_CMD = "concurrency-guard.mjs release";

/**
 * ÉNUMÉRATION FERMÉE des sorties propres (miroir du tableau §1.0 de `SKILL.md`).
 * Chaque entrée = une terminaison du run où le lock est POSÉ → elle DOIT rendre le verrou.
 * Les cas 7/8 (lock jamais acquis) et 9 (crash) n'ont pas de `release` par construction.
 */
const CLEAN_EXITS = [
  { cas: 1, nom: "fin de scope (épic clos)", identifie: /Plus d'épic ni de story ouverte/ },
  { cas: 2, nom: "stop-drift → needs-owner", identifie: /ouvrir\/étiqueter une issue GitHub/ },
  { cas: 3, nom: "needs-owner déjà ouvert au démarrage", identifie: /tout le scope en dépend/ },
  { cas: 4, nom: "quota-wall (limite d'usage reçue)", identifie: /\*\*Rendre le verrou\*\*/ },
  { cas: 5, nom: "pause propre / mur de contexte (auto-chaîne)", identifie: /Note d'ancrage/ },
  { cas: 6, nom: "startGuard HOLD", identifie: /\*\*Ne pas démarrer\*\* une story quand/ },
];

/** Lignes où `release` apparaît en RÉFÉRENCE (synopsis d'usage), pas comme ancrage de sortie. */
const REFERENCE_LINES = [/^node \.claude\/skills\/orchestrate\/concurrency-guard\.mjs release/];

const lines = readFileSync(SKILL_PATH, "utf8").split("\n");

describe("SKILL.md — câblage du verrou de session (#298)", () => {
  it.each(CLEAN_EXITS)("sortie propre $cas ($nom) rend le verrou", ({ identifie, nom }) => {
    const matching = lines.filter((line) => identifie.test(line));

    expect(matching, `aucune ligne n'identifie la sortie « ${nom} »`).not.toHaveLength(0);
    // La ligne qui DÉCRIT la sortie doit porter l'appel : sinon la sortie est documentée
    // mais ne rend pas le verrou — exactement le défaut trouvé en review round 2.
    expect(
      matching.some((line) => line.includes(RELEASE_CMD)),
      `la sortie propre « ${nom} » ne rend pas le verrou (aucun \`${RELEASE_CMD}\` sur sa ligne)`,
    ).toBe(true);
  });

  it("aucun appel `release` orphelin : toute ligne de release est un ancrage ÉNUMÉRÉ ou une référence", () => {
    const orphelines = lines
      .filter((line) => line.includes(RELEASE_CMD))
      .filter((line) => !CLEAN_EXITS.some(({ identifie }) => identifie.test(line)))
      .filter((line) => !REFERENCE_LINES.some((ref) => ref.test(line.trim())));

    // Sens INVERSE du balayage : ajouter un ancrage sans l'enregistrer dans CLEAN_EXITS
    // (donc sans l'ajouter au tableau §1.0) casse l'exhaustivité revendiquée.
    expect(orphelines, "ancrage `release` non enregistré dans CLEAN_EXITS / tableau §1.0").toEqual(
      [],
    );
  });

  it("le tableau §1.0 énumère les 9 terminaisons (6 propres + 2 sans lock + 1 crash)", () => {
    const rows = lines.filter((line) => /^\| \d \|/.test(line));
    expect(rows).toHaveLength(9);

    const releaseRows = rows.filter((line) => line.includes("`release`"));
    expect(releaseRows).toHaveLength(CLEAN_EXITS.length);
  });

  it("les frontières de story battent le heartbeat (§5 étapes 1, 2 et 4)", () => {
    const heartbeats = lines.filter((line) => line.includes("concurrency-guard.mjs heartbeat"));
    // 3 ancrages §5 + la ligne de synopsis §1.0.
    expect(heartbeats.length).toBeGreaterThanOrEqual(4);
  });
});
