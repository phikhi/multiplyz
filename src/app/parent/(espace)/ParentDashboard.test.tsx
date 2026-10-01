import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import { parent as p } from "@/strings/parent";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { SKILLS } from "@/lib/engine/domain";
import { computeParentOverview, type ParentPeriod } from "@/lib/parent/overview";
import type { ParentStats, AttemptRecord } from "@/lib/parent/stats";
import type { ProgressionSummary } from "@/lib/parent/progression";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import { ParentShell } from "@/components/ParentShell";
import { ParentDashboard, type ParentDashboardProps } from "./ParentDashboard";

vi.mock("@/components/ParentExitButton", () => ({
  ParentExitButton: () => <button type="button">{strings.parent.dashboard.exit}</button>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/parent",
  useSearchParams: () => new URLSearchParams("profile=2"),
}));

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

const now = Date.UTC(2026, 8, 11, 12);
const day = 86400000;
const record = (patch: Partial<AttemptRecord> = {}): AttemptRecord => ({
  skill: "add",
  correct: true,
  responseMs: 2000,
  isRetry: false,
  createdAt: now,
  ...patch,
});
const records = SKILLS.flatMap((skill, skillIndex) =>
  Array.from({ length: 25 }, (_, i) =>
    record({
      skill,
      correct: i < [22, 20, 16, 13][skillIndex],
      responseMs: [2000, 2800, 3400, 4100][skillIndex],
    }),
  ),
);
const previous = Array.from({ length: 100 }, (_, i) =>
  record({ correct: i < 60, createdAt: now - 8 * day }),
);
function overview(attempts = [...records, ...previous], period: ParentPeriod = "recent", days = 7) {
  return computeParentOverview(
    attempts,
    [],
    {
      ...CONFIG_DEFAULTS,
      reporting: { ...CONFIG_DEFAULTS.reporting, trendWindowDays: days },
    },
    now,
    period,
  );
}
const FULL_OVERVIEW = { ...overview(), seen: 3, weak: 1, due: 2, slow: 1 };
const FULL_PROGRESSION: ProgressionSummary = {
  worldNumber: 2,
  levelsCompleted: 3,
  totalLevels: 11,
  creaturesCount: 5,
  levelsToday: 3,
};
const BASE_PROPS: ParentDashboardProps = {
  displayName: "Léa",
  profileId: 2,
  profiles: [
    { id: 1, name: "Zoé" },
    { id: 2, name: "Léa" },
  ],
  stats: FULL_STATS,
  overview: FULL_OVERVIEW,
  progression: FULL_PROGRESSION,
  respectWindowMinMinutes: 15,
  respectWindowMaxMinutes: 20,
  pendingWorldsCount: 0,
  sparklineWindowDays: 7,
};
function dashboard(patch: Partial<ParentDashboardProps> = {}) {
  return render(<ParentDashboard {...BASE_PROPS} {...patch} />);
}
function section(title: string) {
  return within(screen.getByRole("heading", { level: 2, name: title }).closest("section")!);
}

describe("ParentDashboard — carnet et filtres", () => {
  it("annonce le profil et la période effectivement suivis", () => {
    dashboard();
    expect(screen.getByRole("heading", { level: 1, name: p.title("Léa") })).toBeInTheDocument();
    expect(screen.getByText(p.intro)).toBeInTheDocument();
    const profile = screen.getByRole("combobox", { name: p.profile });
    expect(profile).toHaveValue("2");
    expect(profile).toHaveAttribute("name", "profile");
    expect(
      within(profile)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Zoé", "Léa"]);
    expect(profile.closest("form")).toHaveAttribute("action", "/parent");
    expect(screen.getByRole("button", { name: p.apply })).toHaveAttribute("type", "submit");
    expect(screen.getByText(p.periodHint)).toBeInTheDocument();
  });
  it.each(["recent", "month", "all"] as const)(
    "sélectionne la période %s avec les bornes du rapport",
    (period) => {
      const report = overview(records, period, 3);
      dashboard({ overview: report, sparklineWindowDays: 3 });
      const filter = screen.getByRole("combobox", { name: p.period });
      expect(filter).toHaveValue(period);
      expect(
        within(filter)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual([p.recent(3), p.recent(12), p.all]);
      const format = (value: number) =>
        new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: report.timeZone,
        }).format(value);
      expect(
        screen.getByText(
          report.start === null ? p.asOf(format(now)) : p.range(format(report.start), format(now)),
        ),
      ).toBeInTheDocument();
    },
  );
  it("reste neutre si le rapport n'est pas disponible", () => {
    expect(dashboard({ overview: undefined, profiles: undefined }).container).toBeEmptyDOMElement();
  });
});

describe("ParentDashboard — justesse et comparaisons", () => {
  it("affiche le dénominateur réel et un écart positif sur deux périodes suffisantes", () => {
    dashboard();
    const accuracy = section(p.accuracy);
    expect(accuracy.getByText("71 %")).toBeInTheDocument();
    expect(accuracy.getByText(p.answers(71, 100))).toBeInTheDocument();
    expect(accuracy.getByText(p.delta("+11"))).toBeInTheDocument();
    expect(accuracy.getByText(p.comparison(100, 100))).toBeInTheDocument();
    expect(accuracy.queryByText(p.small)).not.toBeInTheDocument();
  });
  it("affiche un écart négatif avec le signe typographique", () => {
    dashboard({
      overview: overview([...records.map((r) => ({ ...r, correct: false })), ...previous]),
    });
    expect(section(p.accuracy).getByText(p.delta("−60"))).toBeInTheDocument();
  });
  it("réserve la stabilité aux périodes comparables", () => {
    dashboard({
      overview: overview([...records, ...records.map((r) => ({ ...r, createdAt: now - 8 * day }))]),
    });
    expect(section(p.accuracy).getByText(p.stable)).toBeInTheDocument();
  });
  it("ne transforme pas un historique ancien en réponse récente ou en stabilité", () => {
    dashboard({ overview: overview(previous) });
    expect(section(p.accuracy).getByText(p.empty)).toBeInTheDocument();
    expect(section(p.accuracy).getByText(p.noComparison)).toBeInTheDocument();
    expect(screen.queryByText(p.noHistory)).not.toBeInTheDocument();
    expect(screen.queryByText(p.stable)).not.toBeInTheDocument();
  });
  it("distingue un nouveau profil d'une justesse nulle", () => {
    dashboard({ stats: EMPTY_STATS, overview: overview([]), progression: null });
    expect(screen.getByText(p.noHistory)).toBeInTheDocument();
    expect(section(p.accuracy).getByText(p.noAnswers)).toBeInTheDocument();
    expect(screen.queryByText("0 %")).not.toBeInTheDocument();
  });
  it("montre un vrai zéro sans conclure de tendance sur un petit échantillon", () => {
    dashboard({ overview: overview([record({ correct: false }), ...previous]) });
    const accuracy = section(p.accuracy);
    expect(accuracy.getByText("0 %")).toBeInTheDocument();
    expect(accuracy.getByText(p.answers(0, 1))).toBeInTheDocument();
    expect(accuracy.getAllByText(p.small)).toHaveLength(2);
    expect(accuracy.queryByText(p.delta("−60"))).not.toBeInTheDocument();
  });
  it("l'historique complet ne revendique aucune comparaison de périodes", () => {
    dashboard({ overview: overview(records, "all") });
    expect(section(p.accuracy).queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});

describe("ParentDashboard — compétences et maîtrise", () => {
  it("garde les quatre compétences dans l'ordre canonique avec leurs propres dénominateurs et temps", () => {
    dashboard();
    const cards = section(p.skills).getAllByRole("article");
    expect(cards).toHaveLength(4);
    cards.forEach((card, i) => {
      const content = within(card);
      expect(
        content.getByRole("heading", { name: strings.parent.dashboard.skills[SKILLS[i]] }),
      ).toBeInTheDocument();
      expect(content.getByText(["88 %", "80 %", "64 %", "52 %"][i])).toBeInTheDocument();
      expect(content.getByText(p.answers([22, 20, 16, 13][i], 25))).toBeInTheDocument();
      expect(content.getByText(["2,0 s", "2,8 s", "3,4 s", "4,1 s"][i])).toBeInTheDocument();
      expect(content.queryByText(p.small)).not.toBeInTheDocument();
    });
  });
  it("la jauge reflète la maîtrise du socle entier, pas le taux de justesse", () => {
    dashboard();
    const meters = section(p.skills).getAllByRole("meter");
    expect(meters).toHaveLength(4);
    meters.forEach((meter, i) => {
      const count = [9, 5, 1, 1][i],
        total = [10, 10, 10, 20][i];
      expect(meter).toHaveAttribute("min", "0");
      expect(meter).toHaveAttribute("max", String(total));
      expect(meter).toHaveAttribute("value", String(count));
      expect(meter).toHaveAccessibleName(p.mastered(count, total));
    });
  });
  it("distingue les calculs rencontrés, non explorés et les compétences sans réponses", () => {
    const report = overview([record()]);
    dashboard({
      overview: {
        ...report,
        bySkill: { ...report.bySkill, add: { ...report.bySkill.add, seen: 1 } },
      },
    });
    const add = within(
      screen
        .getByRole("heading", { name: strings.parent.dashboard.skills.add })
        .closest("article")!,
    );
    expect(add.getByText(p.seen(1))).toBeInTheDocument();
    expect(add.getByText(p.small)).toBeInTheDocument();
    const sub = within(
      screen
        .getByRole("heading", { name: strings.parent.dashboard.skills.sub })
        .closest("article")!,
    );
    expect(sub.getByText(p.unseen)).toBeInTheDocument();
    expect(sub.getByText(p.answers(0, 0))).toBeInTheDocument();
    expect(sub.getAllByText(p.empty)).toHaveLength(2);
  });
  it("un socle vide garde une jauge valide et un compte explicite de zéro", () => {
    const masteryMap = {
      ...EMPTY_STATS.masteryMap,
      add: { ...EMPTY_STATS.masteryMap.add, totalCount: 0 },
    };
    dashboard({ stats: { ...EMPTY_STATS, masteryMap }, overview: overview([]) });
    const meter = screen.getByRole("meter", { name: p.mastered(0, 0) });
    expect(meter).toHaveAttribute("max", "1");
    expect(meter).toHaveAttribute("value", "0");
  });
});

describe("ParentDashboard — détail quotidien et vitesse", () => {
  it("montre les huit dates de la fenêtre glissante, y compris les jours sans réponse", () => {
    dashboard();
    const table = section(p.daily).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(9);
    expect(table.closest("details")).toHaveAttribute("open");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([p.date, p.count, p.right]);
  });
  it("un jour à zéro reste visible et distinct d'un jour sans réponse", () => {
    dashboard({ overview: overview([record({ correct: false })]) });
    const rows = section(p.daily).getAllByRole("row").slice(1);
    const last = within(rows.at(-1)!);
    expect(last.getByText("1")).toBeInTheDocument();
    const zero = last.getByText("0 %");
    expect(zero).toHaveStyle({ "--day-accuracy": "0%" });
    expect(within(rows[0]).getAllByText(p.noDay)).toHaveLength(2);
    expect(section(p.daily).getByText(p.dailyHint)).toBeInTheDocument();
  });
  it.each([
    [false, "0%"],
    [true, "100%"],
  ] as const)("la barre indique la proportion réelle, réponse juste=%s", (correct, width) => {
    dashboard({ overview: overview([record({ correct })]) });
    const bar = section(p.daily).getByText(correct ? "100 %" : "0 %");
    expect(bar).toHaveStyle({ "--day-accuracy": width });
  });
  it("la période longue replie le tableau accessible au lieu de supprimer des dates", () => {
    dashboard({ overview: overview(records, "month") });
    const details = section(p.daily)
      .getByText(p.daily, { selector: "summary" })
      .closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelectorAll("tbody tr")).toHaveLength(29);
  });
  it("l'historique rend les dates réellement jouées, même un seul jour", () => {
    dashboard({ overview: overview([record()], "all") });
    expect(section(p.daily).getAllByRole("row")).toHaveLength(2);
  });
  it("la fenêtre configurée filtre réellement les réponses et leurs dates", () => {
    dashboard({
      overview: overview([record(), record({ createdAt: now - 4 * day })], "recent", 3),
      sparklineWindowDays: 3,
    });
    expect(section(p.daily).getAllByRole("row")).toHaveLength(5);
    expect(section(p.accuracy).getByText(p.answers(1, 1))).toBeInTheDocument();
  });
  it("une période vide affiche un repli accessible sans tableau trompeur", () => {
    dashboard({ overview: overview([]) });
    expect(section(p.daily).getByText(p.noAnswers)).toBeInTheDocument();
    expect(section(p.daily).queryByRole("table")).not.toBeInTheDocument();
  });
  it("le temps moyen garde la virgule française et son échantillon sans prétendre mesurer la maîtrise", () => {
    dashboard();
    const speed = section(p.speed);
    expect(speed.getByText("3,1 s")).toBeInTheDocument();
    expect(speed.getByText(p.sample(100))).toBeInTheDocument();
    expect(speed.getByText(p.speedHint)).toBeInTheDocument();
    expect(speed.queryByText(p.stable)).not.toBeInTheDocument();
  });
  it("sans temps observé, le temps moyen reste absent", () => {
    dashboard({ overview: overview([]) });
    expect(section(p.speed).getByText(p.empty)).toBeInTheDocument();
    expect(section(p.speed).getByText(p.sample(0))).toBeInTheDocument();
  });
});

describe("ParentDashboard — accompagnement et rythme", () => {
  it("formate les calculs à revoir et explique leur sélection", () => {
    dashboard();
    const review = section(p.review);
    expect(review.getByText("6 × 7 = ?")).toBeInTheDocument();
    expect(review.getByText("13 − 6 = ?")).toBeInTheDocument();
    expect(review.getByText(p.reason.wrong)).toBeInTheDocument();
    expect(review.getByText(p.reason.slow)).toBeInTheDocument();
    expect(review.getByText(p.reviewHint)).toBeInTheDocument();
    expect(review.getAllByRole("definition").map((d) => d.textContent)).toEqual(["1", "2", "1"]);
  });
  it("une clé malformée est montrée sans faire planter le carnet", () => {
    dashboard({
      stats: {
        ...FULL_STATS,
        reviewList: [
          { ...FULL_STATS.reviewList[0], factKey: "legacy-key", reason: "wrong-and-slow" },
        ],
      },
    });
    expect(section(p.review).getByText("legacy-key")).toBeInTheDocument();
    expect(section(p.review).getByText(p.reason["wrong-and-slow"])).toBeInTheDocument();
  });
  it("une sélection vide et un profil jamais exploré ont des explications distinctes", () => {
    const view = dashboard({ stats: EMPTY_STATS });
    expect(section(p.review).getByText(p.reviewEmpty)).toBeInTheDocument();
    view.rerender(<ParentDashboard {...BASE_PROPS} stats={EMPTY_STATS} overview={overview([])} />);
    expect(section(p.review).getByText(p.reviewUnseen)).toBeInTheDocument();
    expect(section(p.review).queryByText(p.reviewEmpty)).not.toBeInTheDocument();
  });
  it("les minutes estimées restent disponibles sans progression et leur méthode est liée", () => {
    dashboard({ progression: null });
    expect(section(p.today).getByText(p.minutes(18))).toBeInTheDocument();
    expect(section(p.today).getByRole("link", { name: p.regularity })).toHaveAttribute(
      "href",
      "#parent-time-method",
    );
    expect(
      screen.getByText(
        p.timeHint(
          CONFIG_DEFAULTS.regularity.maxDayAmplitudeMinutes,
          CONFIG_DEFAULTS.regularity.dayTimeZone,
        ),
      ),
    ).toBeInTheDocument();
    expect(section(p.regularity).getByText(p.rest)).toBeInTheDocument();
  });
  it("distingue zéro minute estimée d'une journée sans réponse", () => {
    const view = dashboard({ stats: EMPTY_STATS });
    expect(section(p.today).getByText(p.noToday)).toBeInTheDocument();
    expect(section(p.today).getByText(p.empty)).toBeInTheDocument();
    view.rerender(
      <ParentDashboard
        {...BASE_PROPS}
        stats={{
          ...FULL_STATS,
          regularity: {
            ...FULL_STATS.regularity,
            today: { ...FULL_STATS.regularity.today!, activeMinutes: 0 },
          },
        }}
      />,
    );
    expect(section(p.today).getByText(p.zeroMinutes)).toBeInTheDocument();
    expect(section(p.today).queryByText(p.noToday)).not.toBeInTheDocument();
  });
  it.each([0, 1, 2])("les jours et compagnons respectent le singulier français à %i", (n) => {
    dashboard({
      stats: {
        ...FULL_STATS,
        regularity: { ...FULL_STATS.regularity, daysPlayed: n, currentStreakDays: n },
      },
      progression: { ...FULL_PROGRESSION, creaturesCount: n },
      pendingWorldsCount: n,
    });
    expect(
      section(p.regularity).getByText(
        `${n} jour${n > 1 ? "s" : ""} avec des réponses depuis le début`,
      ),
    ).toBeInTheDocument();
    expect(
      section(p.regularity).getByText(
        `${n} jour${n > 1 ? "s" : ""} consécutif${n > 1 ? "s" : ""} actuellement`,
      ),
    ).toBeInTheDocument();
    expect(
      section(p.adventure).getByText(
        `${n} compagnon${n > 1 ? "s" : ""} différent${n > 1 ? "s" : ""}`,
      ),
    ).toBeInTheDocument();
    expect(
      section(p.adventure).getByRole("link", { name: `${n} monde${n > 1 ? "s" : ""} à regarder` }),
    ).toHaveAttribute("href", "/parent/mondes");
  });
  it("montre le monde, les étapes et les compagnons conservés", () => {
    dashboard();
    expect(section(p.adventure).getByText(p.world(2))).toBeInTheDocument();
    expect(section(p.adventure).getByText(p.levels(3, 11))).toBeInTheDocument();
    expect(section(p.adventure).getByText(p.creatures(5))).toBeInTheDocument();
  });
  it("la progression indisponible a un repli neutre et conserve l'accès aux mondes", () => {
    dashboard({ progression: null });
    expect(section(p.adventure).getByText(p.adventureEmpty)).toBeInTheDocument();
    expect(section(p.adventure).getByRole("link", { name: p.pending(0) })).toBeInTheDocument();
  });
});

describe("ParentDashboard — navigation et contraste du carnet", () => {
  it("le cadre parent garde les accès, le profil suivi et la sortie", () => {
    render(
      <ParentShell>
        <ParentDashboard {...BASE_PROPS} />
      </ParentShell>,
    );
    for (const [label, href] of [
      [p.dashboard, "/parent?profile=2"],
      [p.settings, "/parent/reglages?profile=2"],
      [p.profiles, "/parent/profils"],
      [p.worlds, "/parent/mondes"],
      [p.access, "/parent/acces"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: p.dashboard })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: strings.parent.dashboard.exit })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: p.skip })).toHaveAttribute("href", "#parent-content");
  });
  it.each(["light", "dark"] as Theme[])("texte du carnet lisible dans le thème %s", (theme) => {
    const contrast = (text: string, bg: string) =>
      contrastRatio(resolveTokenColor(theme, text), resolveTokenColor(theme, bg));
    for (const text of ["parent-ink", "parent-muted"]) {
      expect(contrast(text, "parent-paper")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, "parent-soft")).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("parent-accent-ink", "parent-accent")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("parent-line", "parent-paper")).toBeGreaterThanOrEqual(3);
  });
});
