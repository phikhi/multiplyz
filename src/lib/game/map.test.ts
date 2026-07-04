import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type MapConfig } from "@/config/server-config";
import {
  baseNodeTypeAt,
  buildMap,
  type BuildMapInput,
  type MapBuildConfig,
  type MapStars,
} from "./map";

/**
 * Config carte réelle (⚙️ défauts de 3.2) → on teste contre le contrat effectif, pas
 * des constantes ad hoc. `revisionDebtThreshold` vit dans EngineConfig (seuil
 * pédagogique) ; `MapConfig` porte la structure. `MapBuildConfig` compose les deux —
 * exactement ce que l'appelant serveur assemble.
 */
const MAP: MapConfig = { ...CONFIG_DEFAULTS.map };
/** Seuil de dette (MAP §5) — vit dans EngineConfig, référencé par valeur ici. */
const REVISION_THRESHOLD = CONFIG_DEFAULTS.engine.revisionDebtThreshold; // 12

/** `MapBuildConfig` avec `revisionDebtThreshold` injecté (composition serveur). */
function mapConfig(overrides: Partial<MapBuildConfig> = {}): MapBuildConfig {
  return {
    ...MAP,
    revisionDebtThreshold: REVISION_THRESHOLD,
    ...overrides,
  };
}

/** Progrès de monde : étoiles par level_index (Map). */
function progress(entries: Array<[number, MapStars]> = []): BuildMapInput["progress"] {
  return { starsByLevel: new Map(entries) };
}

/** Entrée `buildMap` (progrès + dette). Dette 0 par défaut (pas de révision). */
function input(overrides: Partial<BuildMapInput> = {}): BuildMapInput {
  return { progress: progress(), debt: 0, ...overrides };
}

// ── Géométrie déterministe (MAP §3) ──────────────────────────────────────────
describe("buildMap — géométrie déterministe (MAP §3)", () => {
  it("même world_index ⇒ carte structurellement identique (positions comprises)", () => {
    const a = buildMap(7, input(), mapConfig());
    const b = buildMap(7, input(), mapConfig());
    // Égalité structurelle profonde : positions, types, index, états — tout reproductible.
    expect(a).toEqual(b);
  });

  it("world_index différent ⇒ positions différentes (seed effective)", () => {
    // Effet observable de la seed : deux mondes ne partagent pas le même tracé.
    const a = buildMap(1, input(), mapConfig());
    const b = buildMap(2, input(), mapConfig());
    const xsA = a.nodes.map((n) => n.position.x);
    const xsB = b.nodes.map((n) => n.position.x);
    expect(xsA).not.toEqual(xsB);
  });

  it("positions bornées dans [0,1]² et `y` croissant régulier (chemin)", () => {
    const { nodes } = buildMap(3, input(), mapConfig());
    for (const node of nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.x).toBeLessThanOrEqual(1);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeLessThanOrEqual(1);
    }
    // `y` strictement croissant du 1ᵉʳ au dernier (progression du chemin).
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i].position.y).toBeGreaterThan(nodes[i - 1].position.y);
    }
    // 1ᵉʳ nœud en haut (y=0), dernier en bas (y=1).
    expect(nodes[0].position.y).toBe(0);
    expect(nodes[nodes.length - 1].position.y).toBe(1);
  });

  it("world_index 0 (1ᵉʳ monde) produit une carte valide et déterministe", () => {
    const a = buildMap(0, input(), mapConfig());
    const b = buildMap(0, input(), mapConfig());
    expect(a).toEqual(b);
    expect(a.worldIndex).toBe(0);
  });

  it("monde dégénéré (levelsPerWorld amène 1 seul nœud) : y=0, pas de division par zéro", () => {
    // levelsPerWorld = 0 est rejeté par la config (parsePositiveInt) ; on force la borne
    // basse ici pour couvrir la branche `count === 1` de computePositions (boss seul).
    const config = mapConfig({ levelsPerWorld: 0 });
    // levelsPerWorld 0 → baseCount 1 → un seul nœud (boss).
    const { nodes } = buildMap(4, input(), config);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].position.y).toBe(0);
    expect(nodes[0].type).toBe("boss");
  });
});

// ── Taille du monde (MAP §1/§6) ──────────────────────────────────────────────
describe("buildMap — taille du monde (MAP §1/§6)", () => {
  it("monde = levelsPerWorld niveaux + 1 boss (~11 nœuds au défaut)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    expect(nodes).toHaveLength(MAP.levelsPerWorld + 1); // 10 + 1 = 11
  });

  it("index contigus et croissants de 0", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    expect(nodes.map((n) => n.index)).toEqual([...Array(nodes.length).keys()]);
  });
});

// ── Boss toujours en dernier (MAP §6) — garde à effet observable ──────────────
describe("buildMap — boss toujours en dernier (MAP §6)", () => {
  it("le dernier nœud est le boss (sans révision)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    expect(nodes[nodes.length - 1].type).toBe("boss");
  });

  it("aucun autre nœud n'est boss (le boss est unique et final)", () => {
    const { nodes } = buildMap(5, input(), mapConfig());
    const bossCount = nodes.filter((n) => n.type === "boss").length;
    expect(bossCount).toBe(1);
    // Effet observable « boss = dernier » : le boss n'est nulle part ailleurs.
    nodes.slice(0, -1).forEach((n) => expect(n.type).not.toBe("boss"));
  });

  it("le boss reste en dernier MÊME avec overlay de révision (dette haute)", () => {
    // Garde-fou clé : l'overlay révision ne touche que le nœud courant, jamais le boss.
    const { nodes } = buildMap(1, input({ debt: REVISION_THRESHOLD + 1 }), mapConfig());
    expect(nodes[nodes.length - 1].type).toBe("boss");
    // L'overlay est sur le nœud courant (0 ici, aucun niveau fait), pas avant le boss.
    expect(nodes[0].type).toBe("revision");
  });

  it("le boss reste boss même si sa position tombe sur un multiple de la cadence trésor", () => {
    // Effet observable : boss prime sur trésor. Avec levelsPerWorld=3 + treasureEvery=4,
    // le boss est à l'index 3 → (3+1)%4===0 le rendrait trésor si le boss ne primait pas.
    const config = mapConfig({ levelsPerWorld: 3, treasureEvery: 4 });
    const { nodes } = buildMap(1, input(), config);
    expect(nodes[nodes.length - 1].type).toBe("boss");
  });
});

// ── Cadence des trésors (MAP §3) — positions exactes ─────────────────────────
describe("buildMap — cadence des trésors (MAP §3)", () => {
  it("trésor exactement tous les treasureEvery nœuds (positions exactes, défaut=4)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    const treasureIndices = nodes.filter((n) => n.type === "treasure").map((n) => n.index);
    // treasureEvery=4, levelsPerWorld=10 → trésors aux positions (index+1)%4===0 hors boss :
    // index 3 (4ᵉ), 7 (8ᵉ). L'index 11 serait le 12ᵉ mais il n'existe pas (11 nœuds,
    // dernier index 10 = boss). Positions EXACTES → échoue si treasureEvery est ignoré.
    expect(treasureIndices).toEqual([3, 7]);
  });

  it("cadence 3 ⇒ trésors aux positions attendues (effet observable de treasureEvery)", () => {
    // Muter treasureEvery (4→3) DOIT changer les positions → garde non vacuous.
    const config = mapConfig({ treasureEvery: 3, levelsPerWorld: 10 });
    const { nodes } = buildMap(1, input(), config);
    const treasureIndices = nodes.filter((n) => n.type === "treasure").map((n) => n.index);
    // (index+1)%3===0 hors boss(10) : index 2, 5, 8. (index 11 n'existe pas.)
    expect(treasureIndices).toEqual([2, 5, 8]);
  });

  it("le nœud 0 n'est jamais un trésor (démarrage sur un niveau normal)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    expect(nodes[0].type).toBe("normal");
  });

  it("les nœuds ni trésor ni boss ni révision sont `normal`", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    // index 0,1,2 → normal,normal,treasure(à 3). Vérifie le défaut normal.
    expect(nodes[0].type).toBe("normal");
    expect(nodes[1].type).toBe("normal");
    expect(nodes[2].type).toBe("normal");
  });
});

// ── Révision = overlay de type sur le nœud courant (MAP §5) ───────────────────
describe("buildMap — révision = overlay de type sur le nœud courant (MAP §5)", () => {
  it("dette JUSTE AU-DESSUS du seuil ⇒ le nœud COURANT devient révision (remédiation immédiate)", () => {
    // Nœud 0 courant (rien de fait) → il devient révision. Remédiation immédiate : la
    // révision est LÀ OÙ L'ENFANT VA JOUER, pas reportée à la fin du monde.
    const { nodes } = buildMap(1, input({ debt: REVISION_THRESHOLD + 1 }), mapConfig());
    expect(nodes[0].type).toBe("revision");
    expect(nodes[0].status).toBe("current");
    // Un SEUL nœud révision (l'overlay ne touche que le courant).
    expect(nodes.filter((n) => n.type === "revision")).toHaveLength(1);
  });

  it("remédiation IMMÉDIATE : la révision suit le nœud courant, pas la fin du monde", () => {
    // Effet observable clé du fix : dette haute alors que l'enfant est au nœud 2 → c'est
    // le nœud 2 (courant) qui devient révision, PAS un nœud à la fin. Casse si on revient
    // à un modèle « révision insérée avant le boss ».
    const p = progress([
      [0, 3],
      [1, 2],
    ]);
    const { nodes } = buildMap(
      1,
      input({ progress: p, debt: REVISION_THRESHOLD + 1 }),
      mapConfig(),
    );
    expect(nodes[2].status).toBe("current");
    expect(nodes[2].type).toBe("revision");
    // Aucun autre nœud n'est révision (pas de nœud révision fantôme en fin de monde).
    expect(nodes.filter((n) => n.type === "revision")).toHaveLength(1);
  });

  it("dette ÉGALE au seuil ⇒ AUCUN overlay (borne stricte >) ; JUSTE EN-DESSOUS non plus", () => {
    // Borne exacte : `debt > threshold`. À `debt === threshold`, pas d'overlay. Muter
    // `>` en `>=` DOIT casser ce test (le cas `== seuil` deviendrait révision).
    const atThreshold = buildMap(1, input({ debt: REVISION_THRESHOLD }), mapConfig());
    const below = buildMap(1, input({ debt: REVISION_THRESHOLD - 1 }), mapConfig());
    expect(atThreshold.nodes.some((n) => n.type === "revision")).toBe(false);
    expect(below.nodes.some((n) => n.type === "revision")).toBe(false);
    // Le nœud courant garde son type de base (normal au nœud 0).
    expect(atThreshold.nodes[0].type).toBe("normal");
  });

  it("dette 0 ⇒ pas de révision (cas nominal)", () => {
    const { nodes } = buildMap(1, input({ debt: 0 }), mapConfig());
    expect(nodes.some((n) => n.type === "revision")).toBe(false);
  });

  it("l'overlay écrase un TRÉSOR sur le nœud courant (remédiation prime le bonus, MAP §5)", () => {
    // Nœud courant = 3 (trésor de base à treasureEvery=4) → sous dette haute il devient
    // révision malgré son type de base trésor. Effet observable : la remédiation prime.
    const p = progress([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    const baseline = buildMap(1, input({ progress: p, debt: 0 }), mapConfig());
    expect(baseline.nodes[3].type).toBe("treasure"); // type de base = trésor
    const withDebt = buildMap(1, input({ progress: p, debt: REVISION_THRESHOLD + 1 }), mapConfig());
    expect(withDebt.nodes[3].status).toBe("current");
    expect(withDebt.nodes[3].type).toBe("revision"); // overlay écrase le trésor
  });

  it("current == boss (tous les niveaux faits sauf le boss) ⇒ PAS d'overlay (priorité boss)", () => {
    // Tous les niveaux normaux terminés, il ne reste que le boss (courant). Dette haute :
    // le boss reste boss, jamais overlay-é (MAP §6). Effet observable : boss ≠ révision.
    const entries: Array<[number, MapStars]> = [];
    for (let i = 0; i < MAP.levelsPerWorld; i += 1) entries.push([i, 3]); // 0..9 faits
    const { nodes } = buildMap(
      1,
      input({ progress: progress(entries), debt: REVISION_THRESHOLD + 5 }),
      mapConfig(),
    );
    const boss = nodes[nodes.length - 1];
    expect(boss.status).toBe("current"); // le boss est le prochain à jouer
    expect(boss.type).toBe("boss"); // jamais overlay-é
    expect(nodes.some((n) => n.type === "revision")).toBe(false);
  });

  it("monde 100 % terminé (aucun nœud courant) ⇒ PAS d'overlay même dette haute", () => {
    const entries: Array<[number, MapStars]> = [];
    for (let i = 0; i < MAP.levelsPerWorld + 1; i += 1) entries.push([i, 3]); // tout fait
    const { nodes } = buildMap(
      1,
      input({ progress: progress(entries), debt: REVISION_THRESHOLD + 5 }),
      mapConfig(),
    );
    expect(nodes.some((n) => n.type === "revision")).toBe(false);
    expect(nodes.some((n) => n.status === "current")).toBe(false);
  });

  it("le seuil est ⚙️ configurable (un seuil plus bas déclenche l'overlay plus tôt)", () => {
    // Effet observable du seuil : à seuil 3, une dette de 4 pose l'overlay ; à 12, non.
    const lowThreshold = mapConfig({ revisionDebtThreshold: 3 });
    const on = buildMap(1, input({ debt: 4 }), lowThreshold);
    const off = buildMap(1, input({ debt: 4 }), mapConfig()); // seuil 12
    expect(on.nodes[0].type).toBe("revision");
    expect(off.nodes[0].type).toBe("normal");
  });
});

// ── Géométrie invariante à la dette (MAP §4) — préoccupation data PO ──────────
describe("buildMap — géométrie invariante à la dette (MAP §4)", () => {
  it("dette au-dessus vs en-dessous du seuil ⇒ MÊME nb de nœuds, MÊMES positions, MÊMES level_index", () => {
    // Garde data (PO) : la dette ne doit JAMAIS changer la géométrie. Ce test CASSE si on
    // revient à un `splice` qui ajoute un nœud (nb de nœuds / level_index divergeraient).
    const high = buildMap(3, input({ debt: REVISION_THRESHOLD + 10 }), mapConfig());
    const low = buildMap(3, input({ debt: 0 }), mapConfig());
    // Même nombre de nœuds.
    expect(high.nodes).toHaveLength(low.nodes.length);
    expect(high.nodes).toHaveLength(MAP.levelsPerWorld + 1); // toujours 11, jamais 12
    // Mêmes level_index (index contigus identiques).
    expect(high.nodes.map((n) => n.index)).toEqual(low.nodes.map((n) => n.index));
    // Mêmes positions (géométrie seedée, indépendante de la dette).
    expect(high.nodes.map((n) => n.position)).toEqual(low.nodes.map((n) => n.position));
  });

  it("SEUL le type du nœud courant diffère entre dette haute et basse (le reste identique)", () => {
    // Le nœud courant (0) passe de normal→révision ; TOUS les autres nœuds sont identiques
    // (type, position, index, statut). Effet observable : l'overlay est chirurgical.
    const high = buildMap(3, input({ debt: REVISION_THRESHOLD + 10 }), mapConfig());
    const low = buildMap(3, input({ debt: 0 }), mapConfig());
    expect(high.nodes[0].type).toBe("revision");
    expect(low.nodes[0].type).toBe("normal");
    // Tous les nœuds SAUF le courant (0) sont strictement égaux.
    expect(high.nodes.slice(1)).toEqual(low.nodes.slice(1));
  });
});

// ── Déblocage linéaire / états (MAP §1/§4) — étoiles jamais une barrière ──────
describe("buildMap — déblocage linéaire, états dérivés du progrès (MAP §1/§4)", () => {
  it("aucun niveau joué ⇒ nœud 0 courant, le reste verrouillé", () => {
    const { nodes } = buildMap(1, input({ progress: progress() }), mapConfig());
    expect(nodes[0].status).toBe("current");
    nodes.slice(1).forEach((n) => expect(n.status).toBe("locked"));
  });

  it("niveaux 0 et 1 terminés ⇒ eux `completed`, le 2 `current`, le reste `locked`", () => {
    const p = progress([
      [0, 3],
      [1, 2],
    ]);
    const { nodes } = buildMap(1, input({ progress: p }), mapConfig());
    expect(nodes[0].status).toBe("completed");
    expect(nodes[1].status).toBe("completed");
    expect(nodes[2].status).toBe("current");
    nodes.slice(3).forEach((n) => expect(n.status).toBe("locked"));
  });

  it("tous les niveaux terminés ⇒ aucun `current`, tous `completed`", () => {
    const entries: Array<[number, MapStars]> = [];
    for (let i = 0; i < MAP.levelsPerWorld + 1; i += 1) entries.push([i, 1]);
    const { nodes } = buildMap(1, input({ progress: progress(entries) }), mapConfig());
    nodes.forEach((n) => expect(n.status).toBe("completed"));
    expect(nodes.some((n) => n.status === "current")).toBe(false);
  });

  it("les ÉTOILES ne sont JAMAIS une barrière : 1 étoile ouvre le suivant comme 3", () => {
    // Effet observable anti-gate-étoiles : niveau 0 avec 1 SEULE étoile → il est
    // `completed` et le niveau 1 est `current` (pas verrouillé faute d'étoiles).
    const oneStar = buildMap(1, input({ progress: progress([[0, 1]]) }), mapConfig());
    const threeStars = buildMap(1, input({ progress: progress([[0, 3]]) }), mapConfig());
    expect(oneStar.nodes[0].status).toBe("completed");
    expect(oneStar.nodes[1].status).toBe("current");
    // Le déblocage est IDENTIQUE quel que soit le nombre d'étoiles (seul `stars` diffère).
    expect(oneStar.nodes.map((n) => n.status)).toEqual(threeStars.nodes.map((n) => n.status));
  });

  it("un niveau non terminé au MILIEU ne verrouille pas via les étoiles (0 étoile = pas fait)", () => {
    // Niveau 2 sauté (jamais joué) → il devient `current` même si 3,4 existaient : le
    // 1ᵉʳ trou pilote le `current`. (Cas défensif : progression normalement contiguë.)
    const p = progress([
      [0, 3],
      [1, 3],
      [3, 3], // niveau 2 manquant
    ]);
    const { nodes } = buildMap(1, input({ progress: p }), mapConfig());
    expect(nodes[2].status).toBe("current"); // 1ᵉʳ non terminé
    expect(nodes[3].status).toBe("completed"); // terminé même s'il suit un trou
  });
});

// ── Étoiles d'affichage (MAP §4) ─────────────────────────────────────────────
describe("buildMap — étoiles d'affichage (MAP §4)", () => {
  it("reporte les étoiles du progrès sur les nœuds terminés", () => {
    const p = progress([
      [0, 3],
      [1, 1],
    ]);
    const { nodes } = buildMap(1, input({ progress: p }), mapConfig());
    expect(nodes[0].stars).toBe(3);
    expect(nodes[1].stars).toBe(1);
  });

  it("un niveau jamais joué a 0 étoile (no-fail : 0 est un état normal)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    nodes.forEach((n) => expect(n.stars).toBe(0));
  });
});

// ── baseNodeTypeAt : type de base d'un level_index (MAP §2/§3/§6, gains #126) ──
describe("baseNodeTypeAt — type de base d'un level_index (dérivé serveur, gains #126)", () => {
  // GARDE « cohérent avec buildMap » (effet observable) : le type dérivé par level_index doit
  // matcher exactement le type de base du nœud correspondant de `buildMap` (dette 0, aucun
  // overlay révision). Rouge si `baseNodeTypeAt` divergeait de la géométrie de la carte.
  it("matche le type de base de chaque nœud de buildMap (MAP défaut)", () => {
    const { nodes } = buildMap(1, input(), mapConfig());
    for (const node of nodes) {
      expect(baseNodeTypeAt(node.index, MAP)).toBe(node.type);
    }
  });

  it("boss au dernier index (levelsPerWorld) — même si multiple de la cadence trésor", () => {
    // levelsPerWorld=3, treasureEvery=4 : index 3 = boss (prime sur trésor).
    expect(baseNodeTypeAt(3, { levelsPerWorld: 3, treasureEvery: 4, bossQuestionCount: 13 })).toBe(
      "boss",
    );
  });

  it("trésor aux positions de cadence (index 3 et 7 au défaut), normal ailleurs", () => {
    expect(baseNodeTypeAt(3, MAP)).toBe("treasure");
    expect(baseNodeTypeAt(7, MAP)).toBe("treasure");
    expect(baseNodeTypeAt(0, MAP)).toBe("normal");
    expect(baseNodeTypeAt(2, MAP)).toBe("normal");
  });

  // GARDE « jamais l'overlay révision » : `baseNodeTypeAt` renvoie le type de BASE (le gain
  // dépend de la position, pas de l'état de dette). Un nœud normal reste normal quelle que
  // soit la dette — le type de base ne connaît pas la révision (overlay d'affichage seul).
  it("ne renvoie JAMAIS `revision` (type de base seul, indépendant de la dette)", () => {
    for (let i = 0; i <= MAP.levelsPerWorld; i += 1) {
      expect(baseNodeTypeAt(i, MAP)).not.toBe("revision");
    }
  });
});
