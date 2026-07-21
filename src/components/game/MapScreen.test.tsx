import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapScreen } from "./MapScreen";
import { currentMapAction } from "@/app/(app)/carte/actions";
import { strings } from "@/strings";
import type { MapNode } from "@/lib/game/map";
import type { CurrentWorldMap, WorldTheme } from "@/lib/game/world-theme";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
} from "@/components/game/scaffolds/test-support/tokens-css";
import { CURATED_THEMES } from "@/config/worldgen-themes";
import { mockPhone } from "@/lib/responsive/test-support/mock-phone";

/**
 * Accents curatés (la palette BORNÉE des mondes du socle, `worldgen-themes.ts`) — source de vérité
 * des couleurs qu'un monde peut réellement poser en `--world-accent`. Le tint per-monde sans-photo
 * (#199) est peint SANS scrim : c'est légitime UNIQUEMENT parce que cette palette est finie, donc le
 * contraste sur le tint dérivé est PROUVÉ pour chacune (jamais une couleur IA arbitraire, cf. photo).
 */
const CURATED_ACCENTS = CURATED_THEMES.map((t) => t.accent);

/**
 * Tests de l'écran carte (story #125, WIREFRAMES §2, PRODUCT §2.1, MAP §1/§2/§4/§5).
 *
 * **Piège #1 (rétro #104, feed-forward brief)** : tout glyphe/trait de nœud visible
 * exige un test de contraste WCAG **résolu** (`tokens.css` → valeur hex → ratio réel),
 * pas seulement le nom du token — cf. blocs "contraste WCAG résolu" ci-dessous.
 *
 * **Piège #2 (rétro #123, feed-forward brief)** : la carte affichée ne doit RIEN
 * recalculer de la géométrie — le rendu doit être un miroir FIDÈLE de `WorldMap.nodes`
 * (même compte, mêmes positions, quel que soit l'état runtime) — cf. bloc "fidélité de
 * rendu à la géométrie fournie".
 */

vi.mock("@/app/(app)/carte/actions", () => ({ currentMapAction: vi.fn() }));

const currentMapActionMock = vi.mocked(currentMapAction);

function node(overrides: Partial<MapNode> = {}): MapNode {
  return {
    index: 0,
    position: { x: 0.5, y: 0 },
    type: "normal",
    status: "locked",
    stars: 0,
    ...overrides,
  };
}

/** Thème per-monde par défaut (océan) — surchargeable par test (accent/slug/label/fond/tuiles/Teddy). */
function theme(overrides: Partial<WorldTheme> = {}): WorldTheme {
  return {
    slug: "ocean",
    accent: "#2BB7E6",
    label: "Océan scintillant",
    background: null,
    tiles: null,
    teddy: null,
    ...overrides,
  };
}

function map(
  nodes: readonly MapNode[],
  worldIndex = 0,
  themeOverrides: Partial<WorldTheme> = {},
): CurrentWorldMap {
  return { worldIndex, nodes, theme: theme(themeOverrides) };
}

async function renderReady(worldMap: CurrentWorldMap) {
  currentMapActionMock.mockResolvedValue({ status: "ready", map: worldMap });
  const result = render(<MapScreen />);
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  return result;
}

/** Le conteneur carte `<main>` (porte `data-world` + `--world-accent` + le fond du monde). */
function mainEl(): HTMLElement {
  const el = document.querySelector("main");
  if (el === null) throw new Error("aucun <main> rendu");
  return el;
}

/**
 * Le lien de **nœud** (vers `/jouer`) — l'écran carte porte aussi un lien de hub vers la
 * collection (`/collection`, story 5.6, WIREFRAMES §2), donc on cible le nœud par son attribut
 * `data-map-node` plutôt qu'un `getByRole("link")` ambigu.
 */
function nodeLink(): HTMLElement {
  const link = document.querySelector<HTMLElement>("a[data-map-node]");
  if (link === null) throw new Error("aucun lien de nœud rendu");
  return link;
}

describe("MapScreen — chargement / erreur", () => {
  it("affiche un statut de chargement puis la carte (non authentifié → erreur)", async () => {
    currentMapActionMock.mockResolvedValue({ status: "unauthenticated" });
    render(<MapScreen />);
    expect(screen.getByRole("status")).toHaveTextContent(strings.map.loading);
    await waitFor(() => expect(screen.getByText(strings.map.loadError)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: strings.map.loadErrorRetry })).toBeInTheDocument();
  });

  it("retry recharge la carte après une erreur", async () => {
    currentMapActionMock.mockResolvedValue({ status: "unauthenticated" });
    render(<MapScreen />);
    await waitFor(() => screen.getByText(strings.map.loadError));

    currentMapActionMock.mockResolvedValue({
      status: "ready",
      map: map([node({ status: "current" })]),
    });
    fireEvent.click(screen.getByRole("button", { name: strings.map.loadErrorRetry }));

    await waitFor(() =>
      expect(
        screen.getByText(
          strings.map.titleThemed.replace("{n}", "1").replace("{theme}", "Océan scintillant"),
        ),
      ).toBeInTheDocument(),
    );
  });

  it("un rejet inattendu de l'action (invariant serveur) → message générique de repli, jamais l'erreur brute", async () => {
    // Effet observable : le `try/catch` de `fetchMap` retombe sur l'écran d'erreur générique
    // (jamais un crash / une erreur brute à l'enfant). Casse si le catch est retiré.
    currentMapActionMock.mockRejectedValue(new Error("boom serveur"));
    render(<MapScreen />);
    await waitFor(() => expect(screen.getByText(strings.map.loadError)).toBeInTheDocument());
    expect(screen.queryByText("boom serveur")).not.toBeInTheDocument();
  });
});

describe("MapScreen — monde indispo (message DOUX voix de Teddy, story 6.7)", () => {
  it("status 'unavailable' (socle non amorcé) → message doux Teddy (COPY), jamais l'erreur brute, + retry", async () => {
    currentMapActionMock.mockResolvedValue({ status: "unavailable" });
    render(<MapScreen />);
    await waitFor(() => expect(screen.getByText(strings.map.worldUnavailable)).toBeInTheDocument());
    // Message doux Teddy, jamais l'erreur générique/technique.
    expect(screen.queryByText(strings.map.loadError)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.map.loadErrorRetry })).toBeInTheDocument();
  });

  it("retry après 'unavailable' recharge la carte (socle amorcé entre-temps)", async () => {
    currentMapActionMock.mockResolvedValue({ status: "unavailable" });
    render(<MapScreen />);
    await waitFor(() => screen.getByText(strings.map.worldUnavailable));

    currentMapActionMock.mockResolvedValue({
      status: "ready",
      map: map([node({ status: "current" })]),
    });
    fireEvent.click(screen.getByRole("button", { name: strings.map.loadErrorRetry }));

    await waitFor(() =>
      expect(
        screen.getByText(
          strings.map.titleThemed.replace("{n}", "1").replace("{theme}", "Océan scintillant"),
        ),
      ).toBeInTheDocument(),
    );
  });
});

describe("MapScreen — thématisation per-monde (--world-accent, story 6.7)", () => {
  it("pose data-world + --world-accent (token consommé au DOM, #125) sur le conteneur carte", async () => {
    await renderReady(map([node({ status: "current" })], 0, { slug: "forest", accent: "#5BBF73" }));
    const main = mainEl();
    expect(main.getAttribute("data-world")).toBe("forest");
    // Effet observable : la variable per-monde est réellement POSÉE au DOM (pas juste déclarée).
    expect(main.style.getPropertyValue("--world-accent")).toBe("#5BBF73");
  });

  it("l'accent VARIE par monde (effet observable #180) : deux thèmes → deux --world-accent distincts", async () => {
    const { unmount } = await renderReady(
      map([node({ status: "current" })], 0, { accent: "#2BB7E6" }),
    );
    const first = mainEl().style.getPropertyValue("--world-accent");
    unmount();

    await renderReady(map([node({ status: "current" })], 1, { accent: "#B57BEF" }));
    const second = mainEl().style.getPropertyValue("--world-accent");

    expect(first).toBe("#2BB7E6");
    expect(second).toBe("#B57BEF");
    expect(second).not.toBe(first); // l'accent per-monde change réellement d'un monde à l'autre.
  });

  it("bandeau d'accent : consommateur DIRECT de --world-accent (pixel per-monde), décoratif (aria-hidden)", async () => {
    await renderReady(map([node({ status: "current" })]));
    const bar = document.querySelector<HTMLElement>("[data-world-accent-bar]");
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // Fond plein = la variable per-monde (jamais une couleur en dur) → varie avec le monde.
    expect(bar!.style.backgroundColor).toBe("var(--world-accent)");
  });

  it("titre THÉMATISÉ : le nom du thème atteint l'enfant dans le titre (WIREFRAMES §2, #180)", async () => {
    await renderReady(map([node({ status: "current" })], 2, { label: "Forêt enchantée" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      strings.map.titleThemed.replace("{n}", "3").replace("{theme}", "Forêt enchantée"),
    );
  });
});

describe("MapScreen — fond du monde validé avant rendu (sécurité, story 6.7)", () => {
  it("asset réel validé (URL Nginx) → image de fond rendue (background-image) + repli teinté dessous", async () => {
    await renderReady(
      map([node({ status: "current" })], 0, { background: "/generated/socle/0/background.png" }),
    );
    const main = mainEl();
    expect(main.style.backgroundImage).toContain("/generated/socle/0/background.png");
    // Repli teinté theme-safe SOUS l'image (jamais une couleur en dur).
    expect(main.style.backgroundColor).toBe("var(--world-bg-tint)");
  });

  it("pas d'asset réel (placeholder → null côté serveur) → AUCUNE image de fond (le tint per-monde reste peint, #199)", async () => {
    // Effet observable : le front n'émet PAS de background-image vers une URL non fournie/validée
    // (aucune URL non validée fetchée). Mais le TINT per-monde reste peint comme fond réel (#199,
    // cf. bloc dédié plus bas). Rougit si un `background-image` fuyait sans asset validé.
    await renderReady(map([node({ status: "current" })], 0, { background: null }));
    const main = mainEl();
    expect(main.style.backgroundImage).toBe("");
    // #199 : le fond n'est plus vide sans photo — le tint per-monde EST peint (identité du monde
    // vécue même sans asset). Rougit si on retire le `backgroundColor` du chemin sans-image.
    expect(main.style.backgroundColor).toBe("var(--world-bg-tint)");
  });
});

describe("MapScreen — tint per-monde PEINT comme fond réel même sans photo (story #199)", () => {
  it("thème résolu SANS photo (background null) → <main> PEINT --world-bg-tint comme backgroundColor (identité du monde vécue, #180)", async () => {
    // Effet observable (#199) : avant, le tint était re-dérivé (#184) mais PEINT seulement quand une
    // photo existait → carte neutre dans l'état sans-image (repli socle/CI/hors-ligne). Ici on prouve
    // que le tint EST le fond réel même sans photo. Rougit si on regate le backgroundColor sur la photo.
    await renderReady(
      map([node({ status: "current" })], 0, { accent: "#5BBF73", background: null }),
    );
    const main = mainEl();
    expect(main.style.backgroundImage).toBe(""); // toujours aucune image (pas de fetch non validé)
    expect(main.style.backgroundColor).toBe("var(--world-bg-tint)"); // mais le tint EST peint
    // Le tint est bien re-dérivé per-monde (fix #184) sur le MÊME élément que l'accent → per-monde réel.
    const tint = main.style.getPropertyValue("--world-bg-tint");
    expect(tint).toContain("color-mix");
    expect(tint).toContain("var(--world-accent)");
    expect(main.style.getPropertyValue("--world-accent")).toBe("#5BBF73");
  });

  it("le tint sans-photo est SÛR car la palette d'accent est BORNÉE : titre (--color-text-primary) ≥ 4.5:1 sur le tint per-monde résolu, pour CHAQUE accent curaté × 2 thèmes", () => {
    // Effet observable (#199, honnêteté #170) : sans photo, le tint est peint SANS scrim — c'est
    // légitime UNIQUEMENT parce que la palette est bornée (6 accents curatés), donc le contraste est
    // PROUVÉ analytiquement (pas affirmé). On résout le tint réel `color-mix(accent 10%, surface)`
    // pour chaque accent et on vérifie le plancher texte. Rougit si un accent curaté est ajouté/changé
    // pour une couleur qui casse ce plancher, ou si le ratio du wash (10%) est modifié dangereusement.
    for (const theme of ["light", "dark"] as const) {
      const surface = resolveTokenColor(theme, "--color-bg-secondary");
      const textPrimary = resolveTokenColor(theme, "--color-text-primary");
      for (const accent of CURATED_ACCENTS) {
        const tint = mixSrgb(accent, surface, 0.1); // même formule que --world-bg-tint (tokens.css)
        expect(contrastRatio(textPrimary, tint)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("le tint sans-photo est SÛR : trait du chemin (--map-node-path-color) ≥ 3:1 sur le tint per-monde résolu, pour CHAQUE accent curaté × 2 thèmes", () => {
    // Même garantie analytique pour le trait du chemin (élément non-texte, WCAG 1.4.11 ≥3:1) sur le
    // tint borné. Rougit si un accent curaté rend le tint trop proche de `--color-text-secondary`.
    for (const theme of ["light", "dark"] as const) {
      const surface = resolveTokenColor(theme, "--color-bg-secondary");
      const pathColor = resolveTokenColor(theme, "--map-node-path-color");
      for (const accent of CURATED_ACCENTS) {
        const tint = mixSrgb(accent, surface, 0.1);
        expect(contrastRatio(pathColor, tint)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("MapScreen — scrim de contraste du titre (--world-surface, story #189)", () => {
  it("fond réel → scrim de titre rendu consommant --world-surface (token jusqu'ici ORPHELIN, #125), titre en enfant au-dessus", async () => {
    // Effet observable (#125) : `--world-surface`, sans aucun consommateur DOM jusqu'ici, est
    // désormais RENDU + CONSOMMÉ par une carte scrim derrière le titre. Rougit si le scrim n'est pas
    // rendu (chemin `background !== null`) ou n'utilise pas `--world-surface`.
    await renderReady(
      map([node({ status: "current" })], 0, { background: "/generated/socle/0/background.png" }),
    );
    const scrim = document.querySelector<HTMLElement>("[data-world-scrim]");
    expect(scrim).not.toBeNull();
    expect(scrim!.style.backgroundColor).toBe("var(--world-surface)");
    // Le titre est un ENFANT EN FLUX du scrim → peint AU-DESSUS du fond de carte, jamais occulté (#170).
    const heading = scrim!.querySelector<HTMLElement>("h1");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toContain("Océan scintillant");
    // LIEN glyphe RENDU ↔ token testé (#104/#125) : la couleur EFFECTIVEMENT posée sur le titre est
    // bien `--color-text-primary` — le MÊME token dont la garde de contraste plancher ci-dessous
    // prouve le ≥4.5:1 sur `--world-surface`. Sans cette assertion, un swap de `TITLE_TEXT_STYLE.color`
    // vers un autre token ne rougirait pas (la garde de contraste le résout par NOM, pas sur le rendu).
    expect(heading!.style.color).toBe("var(--color-text-primary)");
  });

  it("pas de fond réel (background null) → AUCUN scrim : le titre garde le fond de page neutre (pas de régression #125)", async () => {
    // Effet observable : le scrim n'apparaît QUE sur le chemin fond-image réel. Rougit si le scrim
    // est rendu inconditionnellement (le titre porterait alors `--world-surface` même sans photo).
    await renderReady(map([node({ status: "current" })], 0, { background: null }));
    expect(document.querySelector("[data-world-scrim]")).toBeNull();
    // Le titre thématisé reste rendu (nu, directement sur le fond de page neutre).
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)(
    "%s : titre (--color-text-primary) ≥ 4.5:1 sur le scrim (--world-surface résolu) — plancher garanti INDÉPENDAMMENT de la photo",
    (theme) => {
      // Fond de RÉFÉRENCE = `--world-surface` (le fond DOM réellement empilé derrière le titre, le
      // scrim étant opaque), JAMAIS la photo IA arbitraire (rétro #125/#170). Rougit si
      // `--world-surface` est remappé sur une couleur à faible contraste avec le texte du titre.
      const text = resolveTokenColor(theme, "--color-text-primary");
      const surface = resolveTokenColor(theme, "--world-surface");
      expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("MapScreen — tint de fond per-monde (fix #184, story #189)", () => {
  it("thème rendu → --world-bg-tint RE-DÉCLARÉ inline sur <main> (dérive per-monde), pas seulement --world-accent", async () => {
    // Effet observable du fix #184 : le tint dérivé est re-déclaré AU NIVEAU de la surcharge de
    // `--world-accent` (sinon le `color-mix` de `:root` reste NEUTRE sous la surcharge descendante,
    // faux-dérivé dormant). Rougit si on retire la re-déclaration inline (retour au piège #184).
    await renderReady(map([node({ status: "current" })], 0, { accent: "#B57BEF" }));
    const main = mainEl();
    const tint = main.style.getPropertyValue("--world-bg-tint");
    expect(tint).toContain("color-mix");
    expect(tint).toContain("var(--world-accent)");
    // La var source est bien re-posée sur le MÊME élément (donc le color-mix s'y re-dérive).
    expect(main.style.getPropertyValue("--world-accent")).toBe("#B57BEF");
  });

  it("thème NULL (état indispo) → aucune surcharge --world-bg-tint (repli :root neutre, pas de fuite)", async () => {
    // Effet observable : la re-déclaration per-monde est GATÉE sur un thème résolu (elle ne fuit pas
    // dans les états sans thème). Rougit si `worldMainStyle` posait le tint sans thème.
    currentMapActionMock.mockResolvedValue({ status: "unavailable" });
    render(<MapScreen />);
    await waitFor(() => screen.getByText(strings.map.worldUnavailable));
    expect(mainEl().style.getPropertyValue("--world-bg-tint")).toBe("");
  });
});

describe("MapScreen — bande de décor thématisée (tuiles per-monde, story #190)", () => {
  it("tuiles validées → bande de décor RENDUE + CONSOMME theme.tiles (URL) + repli --world-bg-tint, décorative (aria-hidden)", async () => {
    // Effet observable (#125/#180) : la ref `tiles` du monde résolu ATTEINT le DOM — pas juste
    // déclarée. Rougit si la bande n'est pas rendue (chemin `tiles !== null`) ou n'émet pas l'URL.
    await renderReady(
      map([node({ status: "current" })], 0, { tiles: "/generated/socle/0/tiles.png" }),
    );
    const band = document.querySelector<HTMLElement>("[data-world-tiles]");
    expect(band).not.toBeNull();
    expect(band).toHaveAttribute("aria-hidden", "true");
    // Image du monde en couverture + repli teinté per-monde dessous (jamais une couleur en dur).
    expect(band!.style.backgroundImage).toContain("/generated/socle/0/tiles.png");
    expect(band!.style.backgroundColor).toBe("var(--world-bg-tint)");
    // Dimension = token de bande (jamais une valeur en dur).
    expect(band!.style.height).toBe("var(--map-tiles-height)");
    // Cadre « carte postale » (⚙️ playtest #203) : bordure + ombre tokenisées, jamais en dur —
    // rougit si le cadre régresse à un bandeau nu (déclaré ≠ consommé, #125/#180).
    expect(band!.style.border).toBe("1px solid var(--map-tiles-border)");
    expect(band!.style.boxShadow).toBe("var(--map-tiles-shadow)");
  });

  it("pas de tuiles (tiles null) → AUCUNE bande de décor (repli propre, pas de fetch non validé)", async () => {
    // Effet observable : la bande n'apparaît QUE sur le chemin `tiles !== null`. Rougit si elle est
    // rendue inconditionnellement (elle émettrait un background-image vers une URL absente/`null`).
    await renderReady(map([node({ status: "current" })], 0, { tiles: null }));
    expect(document.querySelector("[data-world-tiles]")).toBeNull();
  });

  it("la bordure du cadre (--map-tiles-border) est VISIBLE : ≥ 3:1 RÉSOLU contre le tint per-monde, pour CHAQUE accent curaté × 2 thèmes (⚙️ #203, piège #226/#170)", () => {
    // Effet observable (#226/#170, round 2 Frontend) : le cadre « carte postale » (⚙️ #203) ne fait
    // lire la bande comme un élément posé QUE si sa bordure est réellement VISIBLE contre le fond
    // tint per-monde qui l'entoure en tint-seul (#199). `--color-border-primary` (le 1er choix) est
    // un neutre CLAIR à ~1.1–1.2:1 résolu contre `--world-bg-tint` = bordure invisible (la capture
    // texturée le masquait par contraste fortuit avec le motif rayé, PAS avec la bordure). On résout
    // le tint réel `color-mix(accent 10%, surface)` pour chaque accent curaté et on vérifie le
    // plancher WCAG non-texte ≥3:1 (1.4.11). MÊME garantie que le jumeau `--map-node-path-color`
    // ci-dessus (les deux = `--color-text-secondary`). ROUGIT si `--map-tiles-border` repasse à un
    // neutre clair (ex. `--color-border-primary`) : vérifié par mutation (build #203).
    for (const theme of ["light", "dark"] as const) {
      const surface = resolveTokenColor(theme, "--color-bg-secondary");
      const border = resolveTokenColor(theme, "--map-tiles-border");
      for (const accent of CURATED_ACCENTS) {
        const tint = mixSrgb(accent, surface, 0.1); // même formule que --world-bg-tint (tokens.css)
        expect(contrastRatio(border, tint)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("MapScreen — avatar Teddy per-monde sur le nœud courant (story #190, ADR 0009)", () => {
  it("Teddy validé → avatar RENDU sur le nœud COURANT, CONSOMME theme.teddy (URL), superposé (absolu), décoratif (aria-hidden)", async () => {
    // Effet observable (#125/#180) : la variante Teddy du monde ATTEINT le nœud courant. Rougit si
    // l'avatar n'est pas rendu (chemin `teddy !== null` sur un nœud courant) ou n'émet pas l'URL.
    await renderReady(
      map([node({ status: "current" })], 0, { teddy: "/generated/socle/0/teddy.png" }),
    );
    const teddy = document.querySelector<HTMLElement>("[data-world-teddy]");
    expect(teddy).not.toBeNull();
    expect(teddy).toHaveAttribute("aria-hidden", "true");
    expect(teddy!.style.backgroundImage).toContain("/generated/socle/0/teddy.png");
    // Superposé (hors flux) → n'altère pas la géométrie (#123) ; taille = token (jamais en dur).
    expect(teddy!.style.position).toBe("absolute");
    expect(teddy!.style.width).toBe("var(--map-node-teddy-size)");
    // Anti-occlusion (#170) : flotte AU-DESSUS de la pastille (bottom:100%) — jamais sur le glyphe.
    expect(teddy!.style.bottom).toBe("100%");
    // Chevauchement décoratif du haut du médaillon (⚙️ playtest #203, couplé à la taille 40px pour
    // garder la marge amont — cf. commentaire de tête) : rougit si le couple se désynchronise.
    expect(teddy!.style.marginBottom).toBe("calc(var(--space-4) * -1)");
    // zIndex > connecteur (0) : l'avatar passe au-dessus du trait, jamais recouvert par lui.
    expect(Number(teddy!.style.zIndex)).toBeGreaterThan(0);
    // L'avatar est bien un enfant du médaillon du nœud COURANT (le marqueur « tu es ici »).
    expect(teddy!.closest('[data-map-node-status="current"]')).not.toBeNull();
  });

  it("un SEUL avatar Teddy, uniquement sur le nœud courant (pas sur verrouillé/terminé) — marqueur unique", async () => {
    // Effet observable : Teddy marque LE point de reprise (MAP §1), pas chaque nœud. Rougit si
    // l'avatar était rendu sur tous les nœuds (encombrement) ou sur le mauvais statut.
    await renderReady(
      map(
        [
          node({ index: 0, status: "completed", stars: 2 }),
          node({ index: 1, status: "current" }),
          node({ index: 2, status: "locked" }),
        ],
        0,
        { teddy: "/generated/socle/0/teddy.png" },
      ),
    );
    const teddies = document.querySelectorAll("[data-world-teddy]");
    expect(teddies).toHaveLength(1);
    expect(teddies[0].closest('[data-map-node-status="current"]')).not.toBeNull();
  });

  it("pas de Teddy (teddy null) → AUCUN avatar sur le nœud courant (repli propre, pas de fetch non validé)", async () => {
    // Effet observable : l'avatar n'apparaît QUE sur le chemin `teddy !== null`. Rougit si rendu
    // inconditionnellement (il émettrait un background-image vers une URL absente/`null`).
    await renderReady(map([node({ status: "current" })], 0, { teddy: null }));
    expect(document.querySelector("[data-world-teddy]")).toBeNull();
  });

  it("Teddy présent mais AUCUN nœud courant (tous terminés) → aucun avatar (gaté sur le statut courant)", async () => {
    // Effet observable : l'avatar est gaté sur le STATUT courant, pas seulement sur `teddy !== null`.
    // Rougit si l'avatar se posait sur un nœud terminé/verrouillé quand il n'y a pas de courant.
    await renderReady(
      map([node({ status: "completed", stars: 3 })], 0, { teddy: "/generated/socle/0/teddy.png" }),
    );
    expect(document.querySelector("[data-world-teddy]")).toBeNull();
  });
});

// Le describe « contraste des glyphes de bas d'écran sur photo arbitraire (scrim #189
// généralisé, story #202) » (bouton « Changer de joueur » + `FooterScrim`) a été RETIRÉ
// (story R1.1 #337) : le bouton vit désormais dans le shell persistant (`AppShell.tsx`),
// hors de `<main>` — jamais peint sur le fond-photo per-monde, donc plus de scrim à tester
// ici. Couverture équivalente : `AppShell.test.tsx` (le bouton 👤 est sur `--topbar-bg`
// **constant**, jamais une photo arbitraire — le problème #202 ne s'y pose plus).

describe("MapScreen — casing opaque du trait du chemin sur photo arbitraire (story #202)", () => {
  const withPhoto = { background: "/generated/socle/0/background.png" as string };

  async function readyTwoNodes(themeOverrides: Partial<WorldTheme>) {
    await renderReady(
      map(
        [node({ index: 0, status: "current" }), node({ index: 1, status: "locked" })],
        0,
        themeOverrides,
      ),
    );
  }

  it("photo réelle → une casing opaque --world-surface est peinte SOUS le trait coloré (contraste garanti sur photo)", async () => {
    // Effet observable (#202/#170) : le trait est peint dans la gouttière de <main> (backmost) sur la
    // photo → contraste non garanti. La casing opaque (peinte AVANT le trait, donc dessous) redonne un
    // fond de référence tokenisé. Rougit si la casing n'est pas rendue (chemin photo) ou perd son token.
    await readyTwoNodes(withPhoto);
    const casing = document.querySelector<SVGLineElement>("[data-map-connector-casing]");
    expect(casing).not.toBeNull();
    expect(casing!.style.stroke).toBe("var(--world-surface)");
    expect(casing!.style.strokeWidth).toBe("var(--map-node-path-casing-width)");
    // La casing est peinte AVANT le trait coloré (ordre de peinture SVG = sous le trait) : elle est le
    // 1ᵉʳ enfant <line> du SVG, le trait coloré le 2ᵉ. Rougit si l'ordre s'inverse (casing par-dessus).
    const lines = document.querySelectorAll("[data-map-connector] line");
    expect(lines[0]).toBe(casing);
    expect((lines[1] as SVGLineElement).style.stroke).toBe("var(--map-node-path-color)");
  });

  it("pas de photo (background null, #199 tint-seul) → AUCUNE casing (contraste du trait déjà prouvé sur le tint borné)", async () => {
    // Effet observable : la casing n'apparaît QUE sur photo. Rougit si elle était rendue
    // inconditionnellement (casing opaque superflue épaississant le trait sur un fond déjà sûr).
    await readyTwoNodes({ background: null });
    expect(document.querySelector("[data-map-connector-casing]")).toBeNull();
    // Le trait coloré lui-même reste rendu (le chemin est toujours visible, juste sans casing).
    expect(document.querySelector("[data-map-connector] line")).not.toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "%s : trait du chemin (--map-node-path-color) ≥ 3:1 sur la casing (--world-surface résolu) — plancher garanti sur photo",
    (theme) => {
      // Fond de RÉFÉRENCE du trait sur photo = la casing opaque `--world-surface` (empilée dessous),
      // jamais la photo (#170). Élément non-texte → ≥3:1 (WCAG 1.4.11). Rougit si le token régresse.
      const path = resolveTokenColor(theme, "--map-node-path-color");
      const surface = resolveTokenColor(theme, "--world-surface");
      expect(contrastRatio(path, surface)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("MapScreen — fidélité de rendu à la géométrie fournie (rétro #123)", () => {
  it("rend EXACTEMENT le nombre de nœuds fournis par WorldMap, quel que soit le compte", async () => {
    // Effet observable : si le composant recalculait/tronquait la géométrie, ce
    // compte ne suivrait pas un WorldMap à N nœuds arbitraire.
    const nodes = Array.from({ length: 7 }, (_, i) =>
      node({ index: i, position: { x: 0.5, y: i / 6 }, status: i === 0 ? "current" : "locked" }),
    );
    await renderReady(map(nodes));
    expect(screen.getAllByText((_, el) => el?.hasAttribute("data-map-node") ?? false)).toHaveLength(
      7,
    );
  });

  it("le même WorldMap (positions/types/statuts) produit le MÊME rendu structurel, peu importe l'ordre d'appel (déterminisme d'affichage)", async () => {
    const nodes = [
      node({ index: 0, status: "completed", stars: 2, type: "normal" }),
      node({ index: 1, status: "current", type: "revision" }),
      node({ index: 2, status: "locked", type: "boss" }),
    ];
    const { unmount } = await renderReady(map(nodes));
    const first = [...document.querySelectorAll("[data-map-node]")].map((el) => ({
      index: el.getAttribute("data-map-node"),
      status: el.getAttribute("data-map-node-status"),
      type: el.getAttribute("data-map-node-type"),
    }));
    unmount();

    await renderReady(map(nodes));
    const second = [...document.querySelectorAll("[data-map-node]")].map((el) => ({
      index: el.getAttribute("data-map-node"),
      status: el.getAttribute("data-map-node-status"),
      type: el.getAttribute("data-map-node-type"),
    }));
    expect(second).toEqual(first);
  });

  it("la position horizontale rendue dérive de node.position.x (pas recalculée) — translateX nul au centre (x=0.5)", async () => {
    await renderReady(map([node({ status: "current", position: { x: 0.5, y: 0 } })]));
    const li = document.querySelector("li");
    expect(li).not.toBeNull();
    expect(li!.style.transform).toBe("translateX(0%)");
  });

  it("un décalage x≠0.5 produit un translateX non nul dérivé de CETTE position (pas une constante)", async () => {
    await renderReady(map([node({ status: "current", position: { x: 0.8, y: 0 } })]));
    const li = document.querySelector("li");
    expect(li!.style.transform).toBe("translateX(30%)");
  });
});

describe("MapScreen — connecteur du chemin (métaphore Candy Crush, WIREFRAMES §2, décoratif)", () => {
  it("N nœuds → N-1 connecteurs (un entre chaque paire consécutive, aucun avant le 1ᵉʳ)", async () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      node({ index: i, position: { x: 0.5, y: i / 4 }, status: i === 0 ? "current" : "locked" }),
    );
    await renderReady(map(nodes));
    // Effet observable : le nombre de connecteurs suit exactement (nœuds − 1) — casse si
    // un connecteur est ajouté au 1ᵉʳ nœud (départ) ou omis entre deux nœuds.
    expect(document.querySelectorAll("[data-map-connector]")).toHaveLength(4);
  });

  it("un seul nœud → AUCUN connecteur (rien à relier)", async () => {
    await renderReady(map([node({ status: "current" })]));
    expect(document.querySelectorAll("[data-map-connector]")).toHaveLength(0);
  });

  it("le connecteur est DÉCORATIF : aria-hidden, jamais navigable, jamais dans le nom accessible", async () => {
    await renderReady(
      map([node({ index: 0, status: "current" }), node({ index: 1, status: "locked" })]),
    );
    const connector = document.querySelector("[data-map-connector]");
    expect(connector).not.toBeNull();
    expect(connector).toHaveAttribute("aria-hidden", "true");
    // Aucun connecteur n'est un lien / focusable (jamais navigable).
    expect(connector!.closest("a")).toBeNull();
    expect(connector!.querySelector("a, button, [tabindex]")).toBeNull();
  });

  it("le connecteur utilise les tokens --map-node-path-* (trait), jamais une valeur en dur", async () => {
    await renderReady(
      map([node({ index: 0, status: "current" }), node({ index: 1, status: "locked" })]),
    );
    const line = document.querySelector("[data-map-connector] line");
    expect(line).not.toBeNull();
    // stroke ET strokeWidth via `style` (SEUL le CSS résout var() dans tous les moteurs,
    // cf. NumberLine/#110) — plus l'attribut `stroke` brut (corrigé avec l'occlusion #169).
    expect((line as SVGLineElement).style.stroke).toBe("var(--map-node-path-color)");
    expect((line as SVGLineElement).style.strokeWidth).toBe("var(--map-node-path-width)");
    expect(line!.getAttribute("stroke")).toBeNull();
  });

  it("le connecteur vit dans la GOUTTIÈRE sous la pastille (top = --map-node-size), jamais derrière le médaillon opaque (régression invisibilité #169)", async () => {
    // Effet observable : ancré au BAS de la pastille (`--map-node-size`), le trait descend
    // dans la gouttière ENTRE deux nœuds — il n'est donc pas recouvert par le médaillon
    // opaque (zIndex 1). Casse si on régresse vers `calc(var(--map-node-size) / 2)` (la
    // moitié de la pastille), qui repeignait le trait DANS le nœud, invisible (playtest
    // owner). jsdom ne fait pas de layout → on garde la valeur de `top` (source du bug),
    // à doubler d'une preuve visuelle E2E (capture `/carte`).
    await renderReady(
      map([node({ index: 0, status: "current" }), node({ index: 1, status: "locked" })]),
    );
    const svg = document.querySelector<SVGSVGElement>("[data-map-connector]");
    expect(svg).not.toBeNull();
    expect(svg!.style.top).toBe("var(--map-node-size)");
    expect(svg!.style.top).not.toContain("/ 2");
    expect(svg!.style.height).toBe("var(--map-node-gap)");
  });

  it("l'ajout des connecteurs ne change NI le nombre de nœuds NI leurs positions (invariance géométrie, rétro #123)", async () => {
    // Effet observable : la géométrie (compte + translateX de chaque <li>) est identique
    // que le connecteur soit rendu ou non — le connecteur est un ornement superposé.
    const nodes = [
      node({ index: 0, status: "current", position: { x: 0.5, y: 0 } }),
      node({ index: 1, status: "locked", position: { x: 0.8, y: 0.5 } }),
      node({ index: 2, status: "locked", position: { x: 0.2, y: 1 } }),
    ];
    await renderReady(map(nodes));
    // Toujours 3 nœuds (les connecteurs ne s'ajoutent pas au décompte de nœuds).
    expect(document.querySelectorAll("[data-map-node]")).toHaveLength(3);
    // Positions dérivées des positions 5.2, inchangées par la présence du connecteur.
    const transforms = [...document.querySelectorAll("li")].map((li) => li.style.transform);
    expect(transforms).toEqual(["translateX(0%)", "translateX(30%)", "translateX(-30%)"]);
  });
});

describe("MapScreen — états de nœud visibles (verrouillé / courant / terminé)", () => {
  it("nœud verrouillé : pas un lien, nom accessible dédié, jamais navigable", async () => {
    await renderReady(map([node({ status: "locked" })]));
    // Aucun lien de NŒUD (le lien de hub collection est un lien distinct, non-nœud).
    expect(document.querySelector("a[data-map-node]")).toBeNull();
    expect(
      screen.getByRole("img", {
        name:
          strings.map.nodeLocked.replace("{n}", "1").replace("{total}", "1") +
          " — " +
          strings.map.type.normal,
      }),
    ).toBeInTheDocument();
  });

  it("nœud courant : lien vers /jouer (point de reprise), nom accessible dédié", async () => {
    await renderReady(map([node({ status: "current" })]));
    const link = nodeLink();
    expect(link).toHaveAttribute("href", "/jouer");
    expect(link).toHaveAccessibleName(
      strings.map.nodeCurrent.replace("{n}", "1").replace("{total}", "1") +
        " — " +
        strings.map.type.normal,
    );
  });

  it("nœud terminé : lien vers /jouer (rejoue monotone), nom accessible porte les étoiles", async () => {
    await renderReady(map([node({ status: "completed", stars: 2 })]));
    const link = nodeLink();
    expect(link).toHaveAttribute("href", "/jouer");
    expect(link.getAttribute("aria-label")).toContain(
      strings.map.starsLabelPlural.replace("{n}", "2"),
    );
  });

  it("étoiles à 1 → libellé singulier, pas pluriel", async () => {
    await renderReady(map([node({ status: "completed", stars: 1 })]));
    const link = nodeLink();
    expect(link.getAttribute("aria-label")).toContain(strings.map.starsLabel.replace("{n}", "1"));
  });

  it("le médaillon d'étoiles est ABSOLU (hors flux) sur un chip blanc — n'allonge pas le nœud (playtest owner : le connecteur atteint le cercle suivant + trait sous les étoiles)", async () => {
    // Effet observable : si les étoiles repassaient EN FLUX (position statique), la ligne
    // du nœud s'allongerait et le connecteur `height:--map-node-gap` ne rejoindrait plus
    // le cercle suivant (bug « le trait s'arrête avant le 2ᵉ rond »). La garde casse si on
    // retire `position:absolute` ou le fond opaque du chip (sous lequel le trait passe).
    await renderReady(map([node({ status: "completed", stars: 3 })]));
    const stars = document.querySelector<HTMLElement>("[data-map-stars]");
    expect(stars).not.toBeNull();
    expect(stars!.style.position).toBe("absolute");
    expect(stars!.style.backgroundColor).toBe("var(--map-node-star-badge-bg)");
    expect(Number(stars!.style.zIndex)).toBeGreaterThan(0); // au-dessus du connecteur (zIndex 0)
  });
});

describe("MapScreen — icône de type (normal / révision / trésor / boss), doublage a11y", () => {
  it.each([
    ["normal", strings.map.type.normal],
    ["revision", strings.map.type.revision],
    ["treasure", strings.map.type.treasure],
    ["boss", strings.map.type.boss],
  ] as const)(
    "type=%s → le nom accessible du nœud porte le libellé de type '%s'",
    async (type, label) => {
      await renderReady(map([node({ status: "current", type })]));
      expect(nodeLink().getAttribute("aria-label")).toContain(label);
    },
  );

  it("le médaillon de type n'est jamais rendu pour un nœud 'normal' (pas de doublon visuel inutile)", async () => {
    await renderReady(map([node({ status: "current", type: "normal" })]));
    expect(document.querySelector("[data-map-type-badge]")).toBeNull();
  });

  it.each(["revision", "treasure", "boss"] as const)(
    "un médaillon décoratif est rendu pour le type '%s' (doublage forme, aria-hidden)",
    async (type) => {
      await renderReady(map([node({ status: "current", type })]));
      const badge = document.querySelector(`[data-map-type-badge="${type}"]`);
      expect(badge).not.toBeNull();
      expect(badge).toHaveAttribute("aria-hidden", "true");
    },
  );
});

describe("MapScreen — hub collection (story 5.6, WIREFRAMES §2)", () => {
  it("affiche un lien vers la collection (Pokédex) depuis la carte (hub)", async () => {
    await renderReady(map([node({ status: "current" })]));
    const link = screen.getByRole("link", { name: strings.collection.title });
    expect(link).toHaveAttribute("href", "/collection");
  });
});

describe("MapScreen — cibles tactiles ≥ 44px (a11y)", () => {
  it("chaque nœud navigable expose une cible ≥ --tap-target-min", async () => {
    await renderReady(map([node({ status: "current" })]));
    const link = nodeLink();
    expect(link.style.minWidth).toBe("var(--tap-target-min)");
    expect(link.style.minHeight).toBe("var(--tap-target-min)");
  });

  it("un nœud verrouillé (non navigable) réserve aussi la même cible minimale (cohérence visuelle)", async () => {
    await renderReady(map([node({ status: "locked" })]));
    const img = screen.getByRole("img");
    expect(img.style.minWidth).toBe("var(--tap-target-min)");
    expect(img.style.minHeight).toBe("var(--tap-target-min)");
  });
});

describe("MapScreen — contraste WCAG résolu (piège #94/#104, feed-forward brief)", () => {
  it.each(["light", "dark"] as const)(
    "%s : glyphe verrouillé (--map-node-locked-glyph) ≥ 4.5:1 sur son fond (--map-node-locked-bg)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--map-node-locked-glyph");
      const bg = resolveTokenColor(theme, "--map-node-locked-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s : glyphe courant (--map-node-current-glyph) ≥ 4.5:1 sur son fond ACCENT (--map-node-current-bg)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--map-node-current-glyph");
      const bg = resolveTokenColor(theme, "--map-node-current-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s : glyphe terminé (--map-node-completed-glyph) ≥ 4.5:1 sur son fond (--map-node-completed-bg)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--map-node-completed-glyph");
      const bg = resolveTokenColor(theme, "--map-node-completed-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s : médaillon de type (--map-node-type-badge-glyph) ≥ 4.5:1 sur son fond (--map-node-type-badge-bg)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--map-node-type-badge-glyph");
      const bg = resolveTokenColor(theme, "--map-node-type-badge-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Les étoiles (★ pleine / ☆ vide) sont désormais rendues sur le MÉDAILLON BLANC (chip,
  // `--map-node-star-badge-bg` = --color-bg-secondary), plus sur le fond de page (playtest
  // owner : étoiles sorties du flux). Le fond de RÉFÉRENCE du contraste = ce fond réellement
  // empilé derrière le glyphe (rétro #125/#126 : jamais un fond que le glyphe ne touche pas).
  // Une garde PAR glyphe rendu (pleine ET vide), pas une fois par famille (CLAUDE.md).
  it.each(["light", "dark"] as const)(
    "%s : étoile PLEINE (--map-node-star-filled) ≥ 4.5:1 sur le médaillon blanc (fond réel du glyphe)",
    (theme) => {
      const star = resolveTokenColor(theme, "--map-node-star-filled");
      const bg = resolveTokenColor(theme, "--map-node-star-badge-bg");
      expect(contrastRatio(star, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)(
    "%s : étoile VIDE (--map-node-star-empty) ≥ 4.5:1 sur le médaillon blanc (fond réel du glyphe)",
    (theme) => {
      // Effet observable : ☆ vide est un glyphe rendu à part entière (pas juste une
      // absence) — casse si le token est remappé sur une couleur à faible contraste
      // (ex. --color-star/-star-empty décoratifs, qui échouent ~1.2:1 en light).
      const star = resolveTokenColor(theme, "--map-node-star-empty");
      const bg = resolveTokenColor(theme, "--map-node-star-badge-bg");
      expect(contrastRatio(star, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Le connecteur du chemin (trait entre nœuds) est rendu SUR le fond de PAGE
  // (--color-bg-primary), dans la gouttière derrière les pastilles. Depuis l'ADR 0010
  // il est un GUIDE VISIBLE : sa couleur résolue doit passer ≥3:1 (WCAG 1.4.11, élément
  // non-texte) dans les 2 thèmes. Effet observable : casse si --map-node-path-color est
  // remappé sur un token quasi-invisible (ex. l'ancien --color-border-primary ≈ 1.3:1)
  // ou si --color-text-secondary régresse — c'est la garde que revendique le commentaire
  // du token (tell commentaire↔code, CLAUDE.md).
  it.each(["light", "dark"] as const)(
    "%s : trait du chemin (--map-node-path-color) ≥ 3:1 sur le fond de page (guide visible, ADR 0010)",
    (theme) => {
      const path = resolveTokenColor(theme, "--map-node-path-color");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(path, bg)).toBeGreaterThanOrEqual(3);
    },
  );

  it("nœud RENDU verrouillé/terminé (fond neutre/pastel) : la couleur EFFECTIVE du glyphe n'est jamais --color-text-inverse (piège #94/#104 récurrent)", async () => {
    // Garde anti-régression sur le DOM RÉEL (pas une comparaison de littéraux) :
    // inspecte `style.color` du badge tel qu'effectivement rendu par le composant.
    // Rougit si un futur changement pose --color-text-inverse sur un fond non-accent.
    await renderReady(map([node({ status: "locked" })]));
    const lockedBadge = document.querySelector('[data-map-node-status="locked"] span[aria-hidden]');
    expect((lockedBadge as HTMLElement).style.color).not.toBe("var(--color-text-inverse)");
    expect((lockedBadge as HTMLElement).style.color).toBe("var(--map-node-locked-glyph)");
  });

  it("nœud RENDU terminé : couleur effective = --map-node-completed-glyph, jamais --color-text-inverse", async () => {
    await renderReady(map([node({ status: "completed", stars: 1 })]));
    const badge = document.querySelector('[data-map-node-status="completed"] span[aria-hidden]');
    expect((badge as HTMLElement).style.color).toBe("var(--map-node-completed-glyph)");
    expect((badge as HTMLElement).style.color).not.toBe("var(--color-text-inverse)");
  });

  it("nœud RENDU courant (fond accent plein) : couleur effective = --map-node-current-glyph — SEULE exception légitime à --color-text-inverse", async () => {
    await renderReady(map([node({ status: "current" })]));
    const badge = document.querySelector('[data-map-node-status="current"] span[aria-hidden]');
    expect((badge as HTMLElement).style.color).toBe("var(--map-node-current-glyph)");
    // Résolu : --map-node-current-glyph EST --color-text-inverse (fond accent plein,
    // exception documentée) — vérifié via le token réel, pas un littéral isolé.
    expect(resolveTokenColor("light", "--map-node-current-glyph")).toBe(
      resolveTokenColor("light", "--color-text-inverse"),
    );
  });
});

describe("MapScreen — reflow responsive (--bp-phone, story 8.2 #255, WIREFRAMES §8 « carte : scroll vertical du chemin »)", () => {
  it("tablette/desktop (défaut) : marge de <main> = --space-6 (disposition actuelle préservée, AC : pas de régression)", async () => {
    await renderReady(map([node({ status: "current" })]));
    expect(mainEl().style.padding).toBe("var(--space-6)");
  });

  it("téléphone (useIsPhone → true) : marge de <main> resserrée à --space-4 (plus de largeur utile pour le chemin serpentin)", async () => {
    const restore = mockPhone(true);
    try {
      await renderReady(map([node({ status: "current" })]));
      // Garde à effet observable : si la branche téléphone est retirée/mutée, la marge
      // retomberait sur --space-6 (assertion ci-dessus) et ce test rougirait.
      expect(mainEl().style.padding).toBe("var(--space-4)");
    } finally {
      restore();
    }
  });

  it("le reflow téléphone NE CHANGE ni le nombre de nœuds ni leurs positions dérivées (invariance géométrie, rétro #123 étendue à l'état isPhone)", async () => {
    const nodes = [
      node({ index: 0, status: "current", position: { x: 0.5, y: 0 } }),
      node({ index: 1, status: "locked", position: { x: 0.8, y: 0.5 } }),
      node({ index: 2, status: "locked", position: { x: 0.2, y: 1 } }),
    ];
    const { unmount } = await renderReady(map(nodes));
    const desktopCount = document.querySelectorAll("[data-map-node]").length;
    const desktopTransforms = [...document.querySelectorAll("li")].map((li) => li.style.transform);
    unmount();

    const restore = mockPhone(true);
    try {
      await renderReady(map(nodes));
      // Même compte de nœuds ET mêmes translateX dérivés — le padding de <main> (CSS pur, story
      // 8.2) ne recalcule JAMAIS `WorldMap.nodes` (rétro #123, ici étendue à l'état `isPhone`).
      expect(document.querySelectorAll("[data-map-node]")).toHaveLength(desktopCount);
      const phoneTransforms = [...document.querySelectorAll("li")].map((li) => li.style.transform);
      expect(phoneTransforms).toEqual(desktopTransforms);
    } finally {
      restore();
    }
  });

  it("téléphone : les cibles tactiles des nœuds restent ≥ --tap-target-min (aucune régression a11y du reflow)", async () => {
    const restore = mockPhone(true);
    try {
      await renderReady(map([node({ status: "current" })]));
      const link = nodeLink();
      expect(link.style.minWidth).toBe("var(--tap-target-min)");
      expect(link.style.minHeight).toBe("var(--tap-target-min)");
    } finally {
      restore();
    }
  });
});

describe("MapScreen — auto-scroll vers le nœud courant au montage (story #268, discovered playtest-⚙️)", () => {
  it("au montage, scrollIntoView est appelé UNE FOIS sur le lien du nœud COURANT (pas un autre), block:center + smooth par défaut", async () => {
    // Effet observable (#60) : rougit si l'ancrage est retiré (jamais appelé) OU s'il cible le
    // MAUVAIS nœud (le fixture place le courant en position 2 sur 3, jamais le 1ᵉʳ lien du DOM,
    // pour exclure un faux-positif « toujours le premier lien trouvé »).
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    await renderReady(
      map([
        node({ index: 0, status: "completed", stars: 2 }),
        node({ index: 1, status: "current" }),
        node({ index: 2, status: "locked" }),
      ]),
    );
    const currentLink = document.querySelector('a[data-map-node-status="current"]');
    expect(currentLink).not.toBeNull();
    // `waitFor` (pas une assertion immédiate) : l'effet `useEffect([])` de `NodePath` qui appelle
    // `scrollIntoView` est un effet PASSIF, flushé par le scheduler après le commit — pas
    // synchrone avec la disparition du rôle "status" que `renderReady` observe (mutation DOM du
    // MÊME commit, mais la mutation-observer de jsdom peut résoudre AVANT le flush des effets
    // passifs). Une assertion immédiate ici flake en CI (timing plus lent/différent) : `waitFor`
    // reste rouge si l'ancrage est retiré (jamais appelé, timeout) et vert dès que l'effet flush,
    // donc la garde reste équivalente — juste déterministe (cf. rétro CI #332, companion #230).
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    // Le CONTEXTE d'appel (`this`) est bien le lien du nœud courant — pas le nœud terminé voisin
    // (`data-map-node` 0) ni un autre élément (rougit si l'ancrage cible le mauvais nœud/ref).
    expect(spy.mock.contexts[0]).toBe(currentLink);
  });

  it("prefers-reduced-motion: reduce → scrollIntoView appelé avec behavior:'auto' (scroll INSTANTANÉ, jamais l'animation 'smooth', a11y CLAUDE.md)", async () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      await renderReady(map([node({ status: "current" })]));
      // Rougit si `prefers-reduced-motion` n'est pas consommé (l'animation 'smooth' resterait
      // posée inconditionnellement, régression a11y — CLAUDE.md « prefers-reduced-motion »).
      // `waitFor` : même race effet-passif-non-flushé que ci-dessus (rétro CI #332) — l'assertion
      // reste rouge si l'appel n'arrive jamais (timeout), déterministe si l'effet flush plus tard.
      await waitFor(() => expect(spy).toHaveBeenCalledWith({ behavior: "auto", block: "center" }));
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("aucun nœud COURANT (fixture sans statut 'current') → scrollIntoView N'EST PAS appelé (garde optionnelle sûre, pas de crash)", async () => {
    // Effet observable : la ref n'est jamais attachée quand aucun nœud n'est 'current' —
    // `currentNodeRef.current` reste `null`, l'appel `?.scrollIntoView` est donc un no-op sûr.
    // Rougit si l'optional chaining est retiré (crash) OU si l'appel devient inconditionnel.
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    await renderReady(
      map([
        node({ index: 0, status: "completed", stars: 3 }),
        node({ index: 1, status: "locked" }),
      ]),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("MONT-ONLY (piège #244) : un re-render de MapScreen qui reste 'ready' NE réinvoque PAS scrollIntoView (jamais un scroll-jack en pleine lecture)", async () => {
    // Effet observable du garde-fou #244 : `NodePath` n'est rendu QUE depuis la branche `ready`
    // (jamais échangé avec un composant du MÊME type depuis une autre branche à la même
    // position), donc son `useEffect(() => …, [])` ne doit PAS se ré-exécuter à un simple
    // re-render pendant que l'écran reste `ready`. Rougit si le tableau de dépendances `[]` est
    // retiré/élargi (l'effet re-tournerait à CHAQUE rendu, scroll-jackant l'enfant en pleine
    // lecture de la carte).
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const { rerender } = await renderReady(map([node({ index: 0, status: "current" })]));
    // `waitFor` (pas une assertion immédiate) : flake CI connu (#332) — l'effet passif `[]` de
    // `NodePath` qui appelle `scrollIntoView` au montage n'est pas garanti flushé au moment où
    // `renderReady` observe la disparition du rôle "status" (mutation-observer jsdom vs flush
    // d'effets passifs du scheduler React, deux mécanismes asynchrones distincts sur le MÊME
    // commit) — CI (timing plus lent/différent) peut évaluer l'assertion AVANT le flush, où le
    // local ne le fait quasi jamais. Rougit TOUJOURS si l'ancrage est retiré (jamais appelé →
    // timeout du waitFor) ; devient vert dès que l'effet flush, quel que soit le délai — la
    // garantie (a) « appelé 1× au montage » reste donc intacte, juste rendue déterministe.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Le `rerender` ci-dessous est un `act()` SYNCHRONE (aucun await/promesse interposé,
    // contrairement au chargement initial) : React flush ses effets passifs à la fin de l'appel
    // avant que ce `rerender` ne retourne — pas de race possible ici, l'assertion immédiate reste
    // le bon outil. Garantie (b) « piège #244 mont-only » : un re-render qui reste 'ready' (même
    // instance de `NodePath`, même Fiber) NE réinvoque PAS l'effet `[]` — rougit si le tableau de
    // dépendances est retiré/élargi côté prod (scroll-jack à chaque re-render).
    rerender(<MapScreen />);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
