import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import type { ParentStats } from "@/lib/parent/stats";
import type { ProgressionSummary } from "@/lib/parent/progression";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import { ParentDashboard } from "./ParentDashboard";

// `ParentExitButton` a besoin d'un routeur Next monté (`useRouter`) — testé isolément
// (`ParentExitButton.test.tsx`) ; on le stubbe ici pour ne vérifier QUE l'assemblage du
// tableau de bord (même patron que l'ex-stub `page.test.tsx`, story 7.1).
vi.mock("@/components/ParentExitButton", () => ({
  ParentExitButton: () => <button type="button">{strings.parent.dashboard.exit}</button>,
}));

const d = strings.parent.dashboard;

/** Agrégats riches : chaque bloc a des données réelles (tous les états non-vides exercés). */
const FULL_STATS: ParentStats = {
  accuracy: {
    overall: 0.82,
    bySkill: { comp10: 0.88, add: 0.79, sub: 0.64, mult: 0.52 },
    trend: { current: 0.82, previous: 0.77, delta: 0.05, direction: "improving" },
  },
  speed: {
    overallMs: 3200,
    bySkillMs: { comp10: 2000, add: 2800, sub: 3400, mult: 4100 },
    trend: { current: 3200, previous: 3600, delta: -400, direction: "improving" },
  },
  masteryMap: {
    comp10: { skill: "comp10", ratio: 0.9, level: "mastered", masteredCount: 9, totalCount: 10 },
    add: { skill: "add", ratio: 0.5, level: "in-progress", masteredCount: 5, totalCount: 10 },
    sub: { skill: "sub", ratio: 0.1, level: "weak", masteredCount: 1, totalCount: 10 },
    mult: { skill: "mult", ratio: 0.05, level: "weak", masteredCount: 1, totalCount: 20 },
  },
  reviewList: [
    {
      factKey: "mult_6x7",
      skill: "mult",
      box: 1,
      wrongCount: 2,
      avgResponseMs: 5000,
      reason: "wrong",
    },
    {
      factKey: "sub_13-6",
      skill: "sub",
      box: 2,
      wrongCount: 0,
      avgResponseMs: 6000,
      reason: "slow",
    },
  ],
  regularity: {
    daysPlayed: 5,
    currentStreakDays: 5,
    recordStreakDays: 7,
    today: { dayOrdinal: 100, activeMs: 18 * 60_000, activeMinutes: 18, respect: "within" },
    days: [
      { dayOrdinal: 96, activeMs: 5 * 60_000, activeMinutes: 5, respect: "under" },
      { dayOrdinal: 97, activeMs: 12 * 60_000, activeMinutes: 12, respect: "under" },
      { dayOrdinal: 98, activeMs: 20 * 60_000, activeMinutes: 20, respect: "within" },
      { dayOrdinal: 99, activeMs: 25 * 60_000, activeMinutes: 25, respect: "over" },
      { dayOrdinal: 100, activeMs: 18 * 60_000, activeMinutes: 18, respect: "within" },
    ],
  },
  // Série QUOTIDIENNE de justesse (issue #241) — 5 jours, ratios DISTINCTS et connus, dont un jour
  // à 0 % (plancher 4 %, #170) et un à 100 % (hauteur pleine) — mêmes bornes que le graphique de
  // régularité pour couvrir les deux cas extrêmes en un seul jeu de fixtures.
  accuracyDaily: [
    { dayOrdinal: 200, accuracy: 0.2 },
    { dayOrdinal: 201, accuracy: 0.5 },
    { dayOrdinal: 202, accuracy: 1 },
    { dayOrdinal: 203, accuracy: 0 },
    { dayOrdinal: 204, accuracy: 0.8 },
  ],
};

/** Agrégats vides : profil jamais joué (tous les replis no-fail exercés). */
const EMPTY_STATS: ParentStats = {
  accuracy: {
    overall: null,
    bySkill: { comp10: null, add: null, sub: null, mult: null },
    trend: { current: null, previous: null, delta: null, direction: "stable" },
  },
  speed: {
    overallMs: null,
    bySkillMs: { comp10: null, add: null, sub: null, mult: null },
    trend: { current: null, previous: null, delta: null, direction: "stable" },
  },
  masteryMap: {
    comp10: { skill: "comp10", ratio: 0, level: "weak", masteredCount: 0, totalCount: 10 },
    add: { skill: "add", ratio: 0, level: "weak", masteredCount: 0, totalCount: 10 },
    sub: { skill: "sub", ratio: 0, level: "weak", masteredCount: 0, totalCount: 10 },
    mult: { skill: "mult", ratio: 0, level: "weak", masteredCount: 0, totalCount: 20 },
  },
  reviewList: [],
  regularity: {
    daysPlayed: 0,
    currentStreakDays: 0,
    recordStreakDays: 0,
    today: null,
    days: [],
  },
  accuracyDaily: [],
};

/** Justesse/rapidité NON-nulles (l'enfant a déjà joué, un jour) mais SANS donnée dans la
 * fenêtre hebdo courante — cas RÉEL distinct de "jamais joué" : `overall` porte sur TOUT
 * l'historique, `trend` seulement sur la semaine courante/précédente (`stats.ts`). Un enfant qui
 * a joué il y a 3 semaines et pas depuis a `overall !== null` mais `trend.delta === null`
 * (indécidable, `computeTrend`) → le mot de tendance retombe sur "stable" SANS aucun delta —
 * branche distincte de "jamais joué" (`accuracy.empty` ne s'affiche PAS ici, un pourcentage réel
 * est montré). */
const STALE_STATS: ParentStats = {
  ...FULL_STATS,
  accuracy: {
    overall: 0.7,
    bySkill: FULL_STATS.accuracy.bySkill,
    trend: { current: null, previous: null, delta: null, direction: "stable" },
  },
  speed: {
    overallMs: 4000,
    bySkillMs: FULL_STATS.speed.bySkillMs,
    trend: { current: null, previous: null, delta: null, direction: "stable" },
  },
};

/** Variante EN BAISSE (branche `direction === "regressing"` de `trendWord`/`accuracyTrendText`,
 * non exercée par FULL_STATS qui est toujours "improving"). */
const REGRESSING_STATS: ParentStats = {
  ...FULL_STATS,
  accuracy: {
    ...FULL_STATS.accuracy,
    trend: { current: 0.6, previous: 0.7, delta: -0.1, direction: "regressing" },
  },
  speed: {
    ...FULL_STATS.speed,
    trend: { current: 5000, previous: 4000, delta: 1000, direction: "regressing" },
  },
};

const FULL_PROGRESSION: ProgressionSummary = {
  worldNumber: 2,
  levelsCompleted: 3,
  totalLevels: 11,
  creaturesCount: 5,
  levelsToday: 3,
};

const BASE_PROPS = {
  displayName: "Léa",
  respectWindowMinMinutes: 15,
  respectWindowMaxMinutes: 20,
  pendingWorldsCount: 0,
  sparklineWindowDays: 7, // défaut réel `ReportingConfig.trendWindowDays` (ADR 0012).
};

describe("ParentDashboard — bandeau + en-tête", () => {
  it("rend le h1 inchangé (7.1) + le sous-titre nominatif (COPY §5)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByRole("heading", { level: 1, name: d.title })).toBeInTheDocument();
    expect(screen.getByText("Progression de Léa")).toBeInTheDocument();
  });

  it("bandeau du jour : minutes + niveaux + série quand today et progression sont disponibles", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText("Aujourd'hui : 18 min · 3 niveaux")).toBeInTheDocument();
    expect(screen.getByText("Série : 5 jours")).toBeInTheDocument();
  });

  it("bandeau du jour : repli minutes seules quand la progression est indisponible", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={null} />);
    expect(screen.getByText("Aujourd'hui : 18 min")).toBeInTheDocument();
  });

  it("bandeau du jour : repli no-fail quand rien n'a encore été joué", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getByText(d.today.notPlayed)).toBeInTheDocument();
    expect(screen.getByText(d.today.noStreak)).toBeInTheDocument();
  });

  it('pluralisation FR (bug PR #239 "1 jours"/"1 niveaux") : SINGULIER à 0 et 1, PLURIEL à ≥2', () => {
    const today18min = { dayOrdinal: 1, activeMs: 0, activeMinutes: 18, respect: "under" as const };
    const withStreak = (currentStreakDays: number): ParentStats => ({
      ...FULL_STATS,
      regularity: { ...FULL_STATS.regularity, today: today18min, currentStreakDays },
    });
    const progressionWith = (levelsToday: number): ProgressionSummary => ({
      ...FULL_PROGRESSION,
      levelsToday,
    });

    // niveaux : 0 → singulier, 1 → singulier, 2 → pluriel.
    const { rerender } = render(
      <ParentDashboard {...BASE_PROPS} stats={withStreak(2)} progression={progressionWith(0)} />,
    );
    expect(screen.getByText("Aujourd'hui : 18 min · 0 niveau")).toBeInTheDocument();
    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withStreak(2)} progression={progressionWith(1)} />,
    );
    expect(screen.getByText("Aujourd'hui : 18 min · 1 niveau")).toBeInTheDocument();
    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withStreak(2)} progression={progressionWith(2)} />,
    );
    expect(screen.getByText("Aujourd'hui : 18 min · 2 niveaux")).toBeInTheDocument();

    // série : 1 → singulier (0 passe par le repli `noStreak`, déjà testé ci-dessus), 2 → pluriel.
    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withStreak(1)} progression={progressionWith(3)} />,
    );
    expect(screen.getByText("Série : 1 jour")).toBeInTheDocument();
    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withStreak(2)} progression={progressionWith(3)} />,
    );
    expect(screen.getByText("Série : 2 jours")).toBeInTheDocument();
  });
});

describe("ParentDashboard — justesse (semaine) + par compétence", () => {
  it("affiche la justesse globale + la tendance signée quand des données existent", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText("82 %")).toBeInTheDocument();
    expect(screen.getByText("en progression (+5 % vs la semaine précédente)")).toBeInTheDocument();
  });

  it("repli no-fail quand aucune 1ʳᵉ réponse n'est comptée cette fenêtre", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getAllByText(d.accuracy.empty).length).toBeGreaterThan(0);
  });

  it("tendance EN BAISSE : mot + delta signé négatif (branche `regressing`)", () => {
    render(
      <ParentDashboard {...BASE_PROPS} stats={REGRESSING_STATS} progression={FULL_PROGRESSION} />,
    );
    expect(screen.getByText("en baisse (−10 % vs la semaine précédente)")).toBeInTheDocument();
  });

  it('historique NON vide mais fenêtre hebdo sans donnée (delta indécidable) → mot "stable" SANS delta, valeur réelle affichée', () => {
    render(<ParentDashboard {...BASE_PROPS} stats={STALE_STATS} progression={null} />);
    expect(screen.getByText("70 %")).toBeInTheDocument(); // overall réel, PAS le repli "empty"
    // "stable" apparaît aussi côté rapidité (STALE_STATS a les 2 tendances indécidables) → ≥1.
    expect(screen.getAllByText(d.accuracy.trend.stable).length).toBeGreaterThan(0);
    expect(screen.queryByText(/vs la semaine précédente/u)).not.toBeInTheDocument();
  });

  it("rend les 4 barres par compétence (compte EXACT, ordre canonique SKILLS)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const bars = screen.getAllByRole("img", {
      name: /Compléments|Addition|Soustraction|Multiplication/u,
    });
    expect(bars).toHaveLength(4);
    expect(bars[0]).toHaveAccessibleName(`${d.skills.comp10} : 88 %`);
    expect(bars[1]).toHaveAccessibleName(`${d.skills.add} : 79 %`);
    expect(bars[2]).toHaveAccessibleName(`${d.skills.sub} : 64 %`);
    expect(bars[3]).toHaveAccessibleName(`${d.skills.mult} : 52 %`);
  });

  it("la largeur de la barre reflète le pourcentage réel (effet observable, pas juste le texte)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const bar = screen.getByRole("img", { name: `${d.skills.comp10} : 88 %` });
    const fillEl = bar.firstElementChild as HTMLElement;
    expect(fillEl.style.width).toBe("88%");
  });
});

// ==========================================================================
// Sparkline de justesse QUOTIDIENNE (issue #241, ADR 0018) — réalise honnêtement la métaphore du
// wireframe (WIREFRAMES §7 `▁▃▅▆▇`) avec de VRAIES données journalières `accuracyDaily`, jamais
// `AccuracyStats.trend` (ADR 0012, current/previous seulement) — même patron de garde que le
// graphique de régularité (#125 consommation, #170 plancher non-vacuous, compte EXACT #127).
// ==========================================================================
describe("ParentDashboard — sparkline de justesse quotidienne (#241)", () => {
  it("graphique LISIBLE (≥2 jours) : consomme `sparklinePlural` en role=img (fenêtre PLURIEL), compte EXACT de barres", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    // Fenêtre ⚙️ = 7 (BASE_PROPS) → PLURIEL, même si seuls 5 points existent (même sémantique que
    // `regularity.chartLabel`, la fenêtre nommée n'est pas le compte de barres réellement rendues).
    const chart = screen.getByRole("img", { name: "Justesse par jour (7 derniers jours)" });
    expect(chart.children).toHaveLength(5); // compte EXACT (5 jours dans la fixture)
  });

  it("repli textuel accessible : 0 jour → PAS de sparkline, `sparklineEmpty` affiché", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getByText(d.accuracy.sparklineEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Justesse par jour/u })).not.toBeInTheDocument();
  });

  it("repli textuel accessible : EXACTEMENT 1 jour → PAS de sparkline (un point isolé n'est pas une forme)", () => {
    const oneDay: ParentStats = {
      ...FULL_STATS,
      accuracyDaily: [{ dayOrdinal: 200, accuracy: 0.5 }],
    };
    render(<ParentDashboard {...BASE_PROPS} stats={oneDay} progression={FULL_PROGRESSION} />);
    expect(screen.getByText(d.accuracy.sparklineEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Justesse par jour/u })).not.toBeInTheDocument();
  });

  it("hauteur des barres = pourcentage RÉEL par jour, plancher 4 % pour 0 % (jamais invisible, #170)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const chart = screen.getByRole("img", { name: "Justesse par jour (7 derniers jours)" });
    const bars = Array.from(chart.children) as HTMLElement[];
    expect(bars).toHaveLength(5);
    // Ordre CROISSANT de la fixture : 20 % / 50 % / 100 % / 0 %→plancher 4 % / 80 %.
    expect(bars[0].style.height).toBe("20%");
    expect(bars[1].style.height).toBe("50%");
    expect(bars[2].style.height).toBe("100%");
    expect(bars[3].style.height).toBe("4%"); // 0 % de justesse — plancher, jamais 0 %
    expect(bars[4].style.height).toBe("80%");
  });

  it("aucune barre de la sparkline lisible n'a une hauteur nulle (rendu ≠ invisible, #170)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const chart = screen.getByRole("img", { name: "Justesse par jour (7 derniers jours)" });
    const bars = Array.from(chart.children) as HTMLElement[];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.style.height).not.toBe("0%");
      expect(bar.style.height).not.toBe("");
    }
  });

  it("MUTATION-PROUVÉ : ne rend QUE les `sparklineWindowDays` DERNIERS jours (fenêtre ⚙️ AGIT, tranche la fin)", () => {
    const nineDays: ParentStats = {
      ...FULL_STATS,
      accuracyDaily: Array.from({ length: 9 }, (_, i) => ({
        dayOrdinal: 300 + i,
        accuracy: i / 8, // 0, 0.125, …, 1 — croissant, le DERNIER (i=8) vaut 1 (100 %)
      })),
    };
    render(
      <ParentDashboard
        {...BASE_PROPS}
        sparklineWindowDays={3}
        stats={nineDays}
        progression={FULL_PROGRESSION}
      />,
    );
    // 9 jours dispo, fenêtre 3 → seuls les 3 DERNIERS (i=6,7,8) sont rendus, jamais les 9.
    const chart = screen.getByRole("img", { name: /Justesse par jour \(3 derniers jours\)/u });
    const bars = Array.from(chart.children) as HTMLElement[];
    expect(bars).toHaveLength(3); // rougit si le slice `-windowDays` est retiré (rendrait 9)
    expect(bars[2].style.height).toBe("100%"); // le TOUT DERNIER jour (i=8), pas un jour ancien
  });

  it("pluralisation FR EXACTE de la fenêtre : SINGULIER à `sparklineWindowDays=1`, PLURIEL à ≥2", () => {
    const { rerender } = render(
      <ParentDashboard
        {...BASE_PROPS}
        sparklineWindowDays={1}
        stats={FULL_STATS}
        progression={FULL_PROGRESSION}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Justesse par jour (1 dernier jour)" }),
    ).toBeInTheDocument();

    rerender(
      <ParentDashboard
        {...BASE_PROPS}
        sparklineWindowDays={2}
        stats={FULL_STATS}
        progression={FULL_PROGRESSION}
      />,
    );
    // PLURIEL à ≥2 — retirer `pluralize()` au profit d'un gabarit unique figé romprait ce test.
    expect(
      screen.getByRole("img", { name: "Justesse par jour (2 derniers jours)" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2 dernier jour\)/u)).toBeNull();
  });
});

describe("ParentDashboard — rapidité", () => {
  it("affiche la rapidité moyenne (virgule française) + la tendance orientée enfant", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText("3,2 s")).toBeInTheDocument();
    // Amélioration de vitesse = ms qui BAISSE → mot "plus rapide", jamais "en baisse" (ambigu).
    expect(screen.getByText(d.speed.trend.improving)).toBeInTheDocument();
  });

  it("repli no-fail quand aucune donnée de rapidité", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getByText(d.speed.empty)).toBeInTheDocument();
  });

  it('tendance PLUS LENTE (branche `regressing`, mot orienté enfant — jamais "en hausse")', () => {
    render(
      <ParentDashboard {...BASE_PROPS} stats={REGRESSING_STATS} progression={FULL_PROGRESSION} />,
    );
    expect(screen.getByText(d.speed.trend.regressing)).toBeInTheDocument();
  });

  it('historique NON vide mais fenêtre hebdo sans donnée → mot "stable", valeur réelle affichée', () => {
    render(<ParentDashboard {...BASE_PROPS} stats={STALE_STATS} progression={null} />);
    expect(screen.getByText("4,0 s")).toBeInTheDocument(); // valeur réelle, PAS le repli "empty"
    // "stable" apparaît aussi côté justesse (STALE_STATS a les 2 tendances indécidables) → ≥1.
    expect(screen.getAllByText(d.speed.trend.stable).length).toBeGreaterThan(0);
  });
});

describe("ParentDashboard — carte de maîtrise (heatmap)", () => {
  it("rend les 4 compétences avec un statut TEXTE distinct (mastered/in-progress/weak)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText(d.mastery.mastered)).toBeInTheDocument();
    expect(screen.getByText(d.mastery.inProgress)).toBeInTheDocument();
    // 2 compétences sont "weak" dans la fixture (sub + mult).
    expect(screen.getAllByText(d.mastery.weak)).toHaveLength(2);
  });
});

describe("ParentDashboard — à revoir", () => {
  it("rend une puce par calcul (équation formatée, réutilise formatEquation)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const list = screen.getByRole("list", { name: d.review.heading });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("6 × 7 = ?");
    expect(items[1]).toHaveTextContent("13 − 6 = ?");
  });

  it("état vide = posture croissance (jamais une liste vide muette)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getByText(d.review.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: d.review.heading })).not.toBeInTheDocument();
  });

  it("garde de forme : une clé de fait MALFORMÉE retombe sur la clé brute (jamais un plantage)", () => {
    const malformed: ParentStats = {
      ...EMPTY_STATS,
      reviewList: [
        {
          factKey: "not-a-real-key",
          skill: "add",
          box: 1,
          wrongCount: 1,
          avgResponseMs: 1000,
          reason: "wrong",
        },
      ],
    };
    render(<ParentDashboard {...BASE_PROPS} stats={malformed} progression={null} />);
    expect(screen.getByText("not-a-real-key")).toBeInTheDocument();
  });
});

describe("ParentDashboard — régularité", () => {
  it("jours joués + record + respect du jour + repère indicatif interpolé aux bornes ⚙️", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText("5 jours joués au total")).toBeInTheDocument();
    expect(screen.getByText("Record : 7 jours")).toBeInTheDocument();
    expect(screen.getByText(d.regularity.respect.within)).toBeInTheDocument();
    expect(
      screen.getByText("Repère indicatif (15-20 min), distinct du réglage de temps d'écran."),
    ).toBeInTheDocument();
  });

  it('pluralisation FR (bug PR #239) : "jours joués"/"Record" SINGULIER à 0 et 1, PLURIEL à ≥2', () => {
    const withDaysAndStreak = (daysPlayed: number, recordStreakDays: number): ParentStats => ({
      ...EMPTY_STATS,
      regularity: { ...EMPTY_STATS.regularity, daysPlayed, recordStreakDays },
    });

    const { rerender } = render(
      <ParentDashboard {...BASE_PROPS} stats={withDaysAndStreak(0, 0)} progression={null} />,
    );
    expect(screen.getByText("0 jour joué au total")).toBeInTheDocument();
    expect(screen.getByText("Record : 0 jour")).toBeInTheDocument();

    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withDaysAndStreak(1, 1)} progression={null} />,
    );
    expect(screen.getByText("1 jour joué au total")).toBeInTheDocument();
    expect(screen.getByText("Record : 1 jour")).toBeInTheDocument();

    rerender(
      <ParentDashboard {...BASE_PROPS} stats={withDaysAndStreak(2, 2)} progression={null} />,
    );
    expect(screen.getByText("2 jours joués au total")).toBeInTheDocument();
    expect(screen.getByText("Record : 2 jours")).toBeInTheDocument();
  });

  // ==========================================================================
  // Graphique minutes/jour — FIX-2 (review Frontend PR #239) : `chartLabel` CONSOMMÉE
  // (role="img"+aria-label, jamais déclarée-orpheline #125) + repli textuel accessible sous
  // le seuil de lisibilité (< 2 jours OU toutes les minutes à 0 → un trait au plancher 4 % lirait
  // comme un graphique CASSÉ, pas comme « pas assez de données »).
  // ==========================================================================
  it("graphique LISIBLE (≥2 jours, au moins 1 minute) : consomme `chartLabel` en role=img, compte EXACT de barres", () => {
    const { container, rerender } = render(
      <ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />,
    );
    const chart = screen.getByRole("img", { name: d.regularity.chartLabel });
    expect(chart.children).toHaveLength(5); // compte EXACT (5 jours dans la fixture)
    expect(container.querySelector('[aria-hidden="true"][style*="flex-end"]')).toBeNull(); // plus de aria-hidden nu sur le conteneur

    // Repli textuel absent quand le graphique est lisible.
    expect(screen.queryByText(d.regularity.chartEmpty)).not.toBeInTheDocument();

    // Ré-affiche sans jour → plus de rôle image (le repli prend le relais, cf. test suivant).
    rerender(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.queryByRole("img", { name: d.regularity.chartLabel })).not.toBeInTheDocument();
  });

  it("repli textuel accessible : 0 jour → PAS de graphique, `chartEmpty` affiché", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} progression={null} />);
    expect(screen.getByText(d.regularity.chartEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: d.regularity.chartLabel })).not.toBeInTheDocument();
  });

  it("repli textuel accessible : EXACTEMENT 1 jour (même avec de vraies minutes) → PAS de graphique", () => {
    const oneDay: ParentStats = {
      ...FULL_STATS,
      regularity: {
        ...FULL_STATS.regularity,
        days: [{ dayOrdinal: 50, activeMs: 18 * 60_000, activeMinutes: 18, respect: "within" }],
      },
    };
    render(<ParentDashboard {...BASE_PROPS} stats={oneDay} progression={FULL_PROGRESSION} />);
    expect(screen.getByText(d.regularity.chartEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: d.regularity.chartLabel })).not.toBeInTheDocument();
  });

  it("repli textuel accessible : ≥2 jours mais TOUTES les minutes à 0 → PAS de graphique", () => {
    const allZero: ParentStats = {
      ...FULL_STATS,
      regularity: {
        ...FULL_STATS.regularity,
        days: [
          { dayOrdinal: 50, activeMs: 0, activeMinutes: 0, respect: "under" },
          { dayOrdinal: 51, activeMs: 0, activeMinutes: 0, respect: "under" },
        ],
      },
    };
    render(<ParentDashboard {...BASE_PROPS} stats={allZero} progression={FULL_PROGRESSION} />);
    expect(screen.getByText(d.regularity.chartEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: d.regularity.chartLabel })).not.toBeInTheDocument();
  });

  it("graphique lisible avec un jour à 0 min : ce jour reste au plancher 4 % (jamais 0 %, #170)", () => {
    const mixed: ParentStats = {
      ...FULL_STATS,
      regularity: {
        ...FULL_STATS.regularity,
        days: [
          { dayOrdinal: 50, activeMs: 0, activeMinutes: 0, respect: "under" },
          { dayOrdinal: 51, activeMs: 5 * 60_000, activeMinutes: 5, respect: "under" },
        ],
      },
    };
    render(<ParentDashboard {...BASE_PROPS} stats={mixed} progression={FULL_PROGRESSION} />);
    // Ciblage PRÉCIS du graphique de régularité (`getByRole` par nom, PAS un `querySelector`
    // générique `[role="img"]` — les 4 barres de justesse portent AUSSI `role="img"` et sont
    // rendues AVANT dans le DOM, un sélecteur générique ciblerait la mauvaise barre en silence).
    const chart = screen.getByRole("img", { name: d.regularity.chartLabel });
    const bars = Array.from(chart.children) as HTMLElement[];
    expect(bars).toHaveLength(2);
    expect(bars[0].style.height).toBe("4%"); // jour à 0 min — plancher, jamais invisible
    expect(bars[1].style.height).toBe("100%"); // jour au maximum de la fenêtre
  });

  it("aucune barre du graphique lisible n'a une hauteur nulle (rendu ≠ invisible, #170)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    const chart = screen.getByRole("img", { name: d.regularity.chartLabel });
    const bars = Array.from(chart.children) as HTMLElement[];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.style.height).not.toBe("0%");
      expect(bar.style.height).not.toBe("");
    }
  });
});

describe("ParentDashboard — progression", () => {
  it("monde/niveaux/créatures quand la progression est disponible", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByText("Monde 2")).toBeInTheDocument();
    expect(screen.getByText("3 / 11 niveaux")).toBeInTheDocument();
    expect(screen.getByText("5 créatures débloquées")).toBeInTheDocument();
  });

  it("repli neutre quand le socle n'est pas amorcé (progression null)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={null} />);
    expect(screen.getByText(d.progression.unavailable)).toBeInTheDocument();
  });

  it('pluralisation FR (bug PR #239 "0 créatures") : "niveau"/"créature" SINGULIER à 0 et 1, PLURIEL à ≥2', () => {
    const progressionWith = (totalLevels: number, creaturesCount: number): ProgressionSummary => ({
      ...FULL_PROGRESSION,
      levelsCompleted: 0,
      totalLevels,
      creaturesCount,
    });

    const { rerender } = render(
      <ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={progressionWith(1, 0)} />,
    );
    expect(screen.getByText("0 / 1 niveau")).toBeInTheDocument();
    expect(screen.getByText("0 créature débloquée")).toBeInTheDocument();

    rerender(
      <ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={progressionWith(1, 1)} />,
    );
    expect(screen.getByText("1 créature débloquée")).toBeInTheDocument();

    rerender(
      <ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={progressionWith(11, 2)} />,
    );
    expect(screen.getByText("0 / 11 niveaux")).toBeInTheDocument();
    expect(screen.getByText("2 créatures débloquées")).toBeInTheDocument();
  });
});

describe("ParentDashboard — liens + sortie (repris de 7.1/7.5/7.3, inchangés)", () => {
  it("expose les liens « Gérer les profils »/« Réglages » vers leurs routes", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByRole("link", { name: d.manageLink })).toHaveAttribute(
      "href",
      "/parent/profils",
    );
    expect(screen.getByRole("link", { name: d.settingsLink })).toHaveAttribute(
      "href",
      "/parent/reglages",
    );
  });

  it("expose le lien « Mondes à valider » (story 7.9) — TOUJOURS affiché, même à 0 en attente", () => {
    render(
      <ParentDashboard
        {...BASE_PROPS}
        pendingWorldsCount={0}
        stats={FULL_STATS}
        progression={FULL_PROGRESSION}
      />,
    );
    expect(screen.getByRole("link", { name: d.worldApprovalLink })).toHaveAttribute(
      "href",
      "/parent/mondes",
    );
    // Aucun repère de compte à 0 (jamais « 0 monde en attente », posture no-fail).
    expect(screen.queryByText(/en attente/u)).toBeNull();
  });

  it("MUTATION-PROUVÉ : repère de compte pluralisé (FR EXACTE) quand des mondes attendent", () => {
    const { rerender } = render(
      <ParentDashboard
        {...BASE_PROPS}
        pendingWorldsCount={1}
        stats={FULL_STATS}
        progression={FULL_PROGRESSION}
      />,
    );
    // SINGULIER à 1 (grammaire FR — promotion #239, jamais « 1 mondes »).
    expect(screen.getByText("1 monde en attente")).toBeInTheDocument();

    rerender(
      <ParentDashboard
        {...BASE_PROPS}
        pendingWorldsCount={3}
        stats={FULL_STATS}
        progression={FULL_PROGRESSION}
      />,
    );
    // PLURIEL à ≥2 — retirer `pluralize()` au profit d'un gabarit unique figé romprait ce test.
    expect(screen.getByText("3 mondes en attente")).toBeInTheDocument();
    expect(screen.queryByText("3 monde en attente")).toBeNull();
  });

  it("rend le bouton de sortie (ParentExitButton, testé isolément ailleurs)", () => {
    render(<ParentDashboard {...BASE_PROPS} stats={FULL_STATS} progression={FULL_PROGRESSION} />);
    expect(screen.getByRole("button", { name: d.exit })).toBeInTheDocument();
  });
});

// ============================================================================
// Contraste WCAG RÉSOLU (rétro #104/#125/#126 : audit de TOUS les glyphes/traits DISTINCTS de
// l'écran, valeurs résolues depuis tokens.css — jamais seulement le nom du token). Deux thèmes.
// ============================================================================
describe("ParentDashboard — contraste WCAG résolu (tous glyphes/traits rendus)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it("texte primary/secondary ≥ 4.5:1 sur --card-bg (titres, valeurs, texte secondaire)", () => {
    for (const theme of THEMES) {
      const surface = resolveTokenColor(theme, "color-bg-secondary"); // = --card-bg
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-primary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-secondary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("carte de maîtrise : les 3 glyphes de statut (✓/~/!) ≥ 4.5:1 sur LEUR fond de badge propre", () => {
    const pairs = [
      ["parent-mastery-mastered-glyph", "parent-mastery-mastered-bg"],
      ["parent-mastery-inprogress-glyph", "parent-mastery-inprogress-bg"],
      ["parent-mastery-weak-glyph", "parent-mastery-weak-bg"],
    ] as const;
    for (const theme of THEMES) {
      for (const [glyph, bg] of pairs) {
        expect(
          contrastRatio(resolveTokenColor(theme, glyph), resolveTokenColor(theme, bg)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // NB : la bordure de statut (`--parent-mastery-*-border`) n'est PAS testée indépendamment ici —
  // même patron que `--map-node-completed-border` (tokens.css) : c'est un renfort DÉCORATIF sur
  // un badge déjà pleinement porté par le glyphe (✓/~/!, testé ci-dessus ≥4.5:1) ET le mot de
  // statut affiché en texte à côté (Maîtrisé/En cours/À renforcer) — retirer la bordure ne
  // réduirait aucune information (contrairement au trait de connexion de la carte, #170, qui LUI
  // est le SEUL porteur du lien visuel entre nœuds et exige son propre ≥3:1).

  it("barre de justesse : remplissage ≥ 3:1 sur le rail (élément NON-TEXTE, WCAG 1.4.11)", () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "parent-bar-fill-bg"),
          resolveTokenColor(theme, "parent-bar-track-bg"),
        ),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("graphique de régularité : remplissage ≥ 3:1 sur le rail (élément NON-TEXTE)", () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "parent-chart-fill-bg"),
          resolveTokenColor(theme, "parent-chart-track-bg"),
        ),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("sparkline de justesse quotidienne (#241) : remplissage ≥ 3:1 sur SON rail exact (élément NON-TEXTE)", () => {
    // Fond de référence = le fond DOM RÉELLEMENT empilé derrière CETTE barre précise
    // (`--parent-chart-track-bg`, réutilisé par `accuracySparklineTrackStyle`) — jamais supposé
    // identique à la paire barre-de-justesse déjà testée plus haut (rétro #125 : un frère empilé
    // n'a pas le fond du médaillon voisin ; chaque paire consommée a sa PROPRE garde).
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "parent-accuracy-sparkline-fill-bg"),
          resolveTokenColor(theme, "parent-chart-track-bg"),
        ),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("puce « à revoir » : texte ≥ 4.5:1 sur son fond de puce propre", () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "parent-review-chip-text"),
          resolveTokenColor(theme, "parent-review-chip-bg"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
