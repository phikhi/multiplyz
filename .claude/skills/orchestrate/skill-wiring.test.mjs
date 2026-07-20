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
 * OBÉIT à ces instructions au runtime : **résidu de testabilité assumé** (#124).
 *
 * Ce que cette garde prouve, littéralement, sur le document livré :
 *   1. chaque terminaison propre énumérée porte son `release` sur la ligne qui la décrit ;
 *   2. chaque frontière de story énumérée porte son `heartbeat` ;
 *   3. **tout** appel `release`/`heartbeat` qui n'est ni un ancrage ENREGISTRÉ ni la ligne de
 *      synopsis EXACTE est signalé comme orphelin → une terminaison ajoutée sans être enregistrée
 *      dans l'énumération §1.0 **rougit**.
 *
 * ── FAIL-CLOSED (à l'inverse du verrou lui-même) ───────────────────────────────────────────────
 * Le verrou de session faillit en **OUVERT** (incertitude → CLEAR → le run démarre). Cette garde
 * d'exhaustivité doit faillir en **FERMÉ** : tout ce qui n'est pas RECONNU explicitement est
 * traité comme un défaut. Les deux choix sont corrects — ne pas les confondre.
 * C'est pourquoi l'exemption de synopsis est une **égalité de ligne ENTIÈRE** (normalisée sur les
 * espaces) et non un préfixe : un match de préfixe exempterait toute ligne commençant par la
 * commande — y compris un ancrage non enregistré posé en bare-command dans un bloc de code, le
 * style qu'un futur éditeur copierait naturellement depuis la ligne voisine (survivant QA, round 3).
 *
 * ── Validée ADVERSARIALEMENT (#296) ────────────────────────────────────────────────────────────
 * Une garde de balayage dont la sortie verte n'a jamais été vue rougir est un reçu #164. Chaque
 * assertion ci-dessous a été plantée d'un survivant et vue ROUGIR : ancrage retiré, ancrage
 * orphelin en prose ET en bare-command/bloc-code, identifiant dupliqué, identifiant reformulé,
 * ligne de synopsis dupliquée, tableau §1.0 amputé.
 */

const SKILL_PATH = join(dirname(fileURLToPath(import.meta.url)), "SKILL.md");
const RELEASE_CMD = "concurrency-guard.mjs release";
const HEARTBEAT_CMD = "concurrency-guard.mjs heartbeat";

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

/** ÉNUMÉRATION FERMÉE des frontières de story qui battent le heartbeat (§5). */
const HEARTBEAT_ANCHORS = [
  // Ancrés sur la STRUCTURE de la ligne (`   → **…**`), pas sur la seule tournure : §1.0 reprend
  // ces mêmes phrases en prose pour dire OÙ bat le cœur, et un identifiant textuel nu désignait
  // donc 2 lignes — désarmant l'assertion (défaut trouvé par l'invariant d'unicité lui-même).
  { etape: "5.1", nom: "retour du reçu de build", identifie: /^\s*→ \*\*au retour du reçu\*\*/ },
  {
    etape: "5.2",
    nom: "retour du fan-out de review",
    identifie: /^\s*→ \*\*au retour du fan-out\*\*/,
  },
  { etape: "5.4", nom: "après merge + rétro + checkpoint", identifie: /^4\. \*\*Merge\*\*/ },
];

/**
 * Lignes de SYNOPSIS d'usage (§1.0) — les seules exemptions du balayage d'orphelins.
 * Comparaison sur la ligne ENTIÈRE normalisée : tout écart (autre commentaire, autre indentation
 * sémantique, duplication ailleurs) retombe du côté « orphelin » → fail-closed.
 */
const normalize = (line) => line.replace(/\s+/g, " ").trim();
const SYNOPSIS_LINES = [
  "node .claude/skills/orchestrate/concurrency-guard.mjs heartbeat # §5 étapes 1, 2 et 4 (cf. ancrages)",
  "node .claude/skills/orchestrate/concurrency-guard.mjs release # les 6 sorties propres — énumération FERMÉE ci-dessous",
];
const isSynopsis = (line) => SYNOPSIS_LINES.includes(normalize(line));

const lines = readFileSync(SKILL_PATH, "utf8").split("\n");

/** Les lignes désignées par un identifiant d'ancrage — doit en désigner EXACTEMENT une. */
const linesFor = (identifie) => lines.filter((line) => identifie.test(line));

describe("SKILL.md — câblage du verrou de session (#298)", () => {
  it.each(CLEAN_EXITS)("sortie propre $cas ($nom) rend le verrou", ({ identifie, nom }) => {
    const matching = linesFor(identifie);

    // EXACTEMENT une ligne : un identifiant qui en désigne 0 est désarmé (reformulation), un qui
    // en désigne 2 permet à l'ancrage d'une AUTRE sortie de créditer celle-ci (piège #206 — c'est
    // très exactement le bug trouvé au round 3 entre les cas 2 et 3, qui vivaient sur une ligne
    // commune). L'unicité rend le crédit croisé impossible par construction.
    expect(matching, `l'identifiant de « ${nom} » doit désigner EXACTEMENT une ligne`).toHaveLength(
      1,
    );
    expect(
      matching[0].includes(RELEASE_CMD),
      `la sortie propre « ${nom} » ne rend pas le verrou (aucun \`${RELEASE_CMD}\` sur sa ligne)`,
    ).toBe(true);
  });

  it.each(HEARTBEAT_ANCHORS)("frontière §$etape ($nom) bat le heartbeat", ({ identifie, nom }) => {
    const matching = linesFor(identifie);

    expect(matching, `l'identifiant de « ${nom} » doit désigner EXACTEMENT une ligne`).toHaveLength(
      1,
    );
    expect(
      matching[0].includes(HEARTBEAT_CMD),
      `la frontière « ${nom} » ne bat pas le heartbeat`,
    ).toBe(true);
  });

  it("aucun appel orphelin : tout `release`/`heartbeat` est un ancrage ENREGISTRÉ ou le synopsis EXACT", () => {
    const ancres = [...CLEAN_EXITS, ...HEARTBEAT_ANCHORS];
    const orphelines = lines
      .filter((line) => line.includes(RELEASE_CMD) || line.includes(HEARTBEAT_CMD))
      .filter((line) => !ancres.some(({ identifie }) => identifie.test(line)))
      .filter((line) => !isSynopsis(line));

    // Sens INVERSE du balayage (fail-closed) : ajouter un ancrage sans l'enregistrer ici — donc
    // sans l'ajouter au tableau §1.0 — casse l'exhaustivité revendiquée, quelle que soit sa FORME
    // (prose, inline-code, ou bare-command dans un bloc de code).
    expect(
      orphelines,
      "appel `release`/`heartbeat` non enregistré (énumération §1.0 incomplète)",
    ).toEqual([]);
  });

  it("chaque ligne de synopsis §1.0 apparaît EXACTEMENT une fois", () => {
    // Sinon un ancrage pourrait être smugglé en dupliquant à l'identique une ligne exemptée.
    for (const synopsis of SYNOPSIS_LINES) {
      expect(
        lines.filter((line) => normalize(line) === synopsis),
        `ligne de synopsis dupliquée ou absente : ${synopsis}`,
      ).toHaveLength(1);
    }
  });

  it("le tableau §1.0 énumère les 9 terminaisons (6 propres + 2 sans lock + 1 crash)", () => {
    const rows = lines.filter((line) => /^\| \d \|/.test(line));
    expect(rows).toHaveLength(9);

    const releaseRows = rows.filter((line) => line.includes("`release`"));
    expect(releaseRows).toHaveLength(CLEAN_EXITS.length);
  });
});
