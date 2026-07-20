import Link from "next/link";
import { strings } from "@/strings";
import { ParentExitButton } from "@/components/ParentExitButton";
import { SKILLS, type Skill } from "@/lib/engine/domain";
import { parseFactKey } from "@/lib/engine/facts";
import { formatEquation } from "@/lib/game/equation";
import type {
  AccuracyStats,
  MasteryLevel,
  MasteryMap,
  ParentStats,
  ReviewItem,
  SpeedStats,
  Trend,
} from "@/lib/parent/stats";
import type { AccuracyDayPoint } from "@/lib/parent/accuracy-daily";
import type { DayActivity, DayRespect } from "@/lib/parent/regularity";
import type { ProgressionSummary } from "@/lib/parent/progression";
import { pluralize, signedPercentPoints, toPercent, toSecondsFr } from "./dashboard-format";

/**
 * **Tableau de bord parent** (story 7.7, WIREFRAMES §7, PLAN §Espace parent ; sparkline de
 * justesse quotidienne : issue #241, ADR 0018). Assemble les agrégats **déjà calculés** côté
 * serveur (7.2 `stats.ts` + 7.4 `regularity.ts` + 7.7 `progression.ts` + #241 `accuracy-daily.ts`)
 * — ce composant est un pur **rendu**, aucun calcul pédagogique/statistique n'y vit (CLAUDE.md :
 * la logique de maîtrise/reporting ne se réinvente pas côté UI). Registre **neutre/vouvoiement**
 * (COPY §5, pas Teddy), zéro texte en dur (strings centralisées), zéro valeur en dur (tokens
 * `tokens.css`).
 *
 * **Aucun élément superposé/positionné** (pas de `position:absolute`, pas de z-index) : barres,
 * badges et puces sont des frères en flux normal (`flex`) → hors du périmètre de la garde
 * d'occlusion #170 par construction (documenté au corps de PR, pas une esquive — une capture
 * Playwright ouverte/regardée reste obligatoire, DoD).
 */
export interface ParentDashboardProps {
  /** Prénom du profil affiché (gabarit du sous-titre, COPY §5 « Progression de {prénom} »). */
  readonly displayName: string;
  /** Agrégats complets (7.2 + 7.4 + #241), lecture seule, déjà calculés côté serveur. */
  readonly stats: ParentStats;
  /** Résumé de progression (7.7), ou `null` si le socle de secours n'est pas amorcé
   * (`SocleUnavailableError` — repli neutre, n'affecte QUE ce bloc, jamais tout l'écran). */
  readonly progression: ProgressionSummary | null;
  /** Borne basse ⚙️ de la fenêtre saine de temps de jeu (`RegularityConfig`, ADR 0014) —
   * interpolée dans le repère indicatif, jamais un « 15 » en dur. */
  readonly respectWindowMinMinutes: number;
  /** Borne haute ⚙️ de la fenêtre saine de temps de jeu. */
  readonly respectWindowMaxMinutes: number;
  /** Nombre de mondes `buffered` en attente d'approbation (story 7.9, `countPendingWorlds`) —
   * repère de découvrabilité de l'impasse #231 (le lien reste affiché même à 0). */
  readonly pendingWorldsCount: number;
  /** Nombre de jours affichés par la sparkline de justesse (issue #241, ADR 0018) — réutilise
   * l'⚙️ EXISTANT `ReportingConfig.trendWindowDays` (ADR 0012, MÊME « semaine glissante » que le
   * titre « Justesse (semaine) » ci-dessus), jamais un second réglage de largeur inventé. */
  readonly sparklineWindowDays: number;
}

const d = strings.parent.dashboard;

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX,
// tout texte/glyphe visible passe par une constante nommée ou par `strings` (même patron que
// ProfileManager.tsx, CHECK_ICON/WARN_ICON).
const FIRE_ICON = "🔥";
const MASTERED_ICON = "✓";
const IN_PROGRESS_ICON = "~";
const WEAK_ICON = "!";
const RESPECT_ICON: Record<DayRespect, string> = { under: "↓", within: "✓", over: "↑" };

/** Remplace un jeton `{x}` par sa valeur (même micro-interpolation que `ProfileManager`/`equation.ts`). */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

const SKILL_LABEL: Record<Skill, string> = {
  comp10: d.skills.comp10,
  add: d.skills.add,
  sub: d.skills.sub,
  mult: d.skills.mult,
};

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  mastered: d.mastery.mastered,
  "in-progress": d.mastery.inProgress,
  weak: d.mastery.weak,
};
const MASTERY_ICON: Record<MasteryLevel, string> = {
  mastered: MASTERED_ICON,
  "in-progress": IN_PROGRESS_ICON,
  weak: WEAK_ICON,
};

const RESPECT_LABEL: Record<DayRespect, string> = {
  under: d.regularity.respect.under,
  within: d.regularity.respect.within,
  over: d.regularity.respect.over,
};

const mainStyle = { minHeight: "100dvh", padding: "var(--space-6)" } as const;

const cardStyle = {
  maxWidth: "var(--max-width-play)",
  width: "100%",
  margin: "0 auto",
  padding: "var(--space-6)",
  backgroundColor: "var(--card-bg)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
} as const;

const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
} as const;

const subtitleStyle = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
} as const;

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
} as const;

const headingStyle = {
  margin: 0,
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
} as const;

const bodyTextStyle = {
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  color: "var(--color-text-primary)",
} as const;

const mutedTextStyle = {
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
} as const;

// Lien « Gérer les profils »/« Réglages » (repris à l'identique de 7.1/7.5/7.3) — cible tactile
// ≥ 44 px, registre neutre, texte fort sur --card-bg (contraste déjà testé, story 7.1).
const manageLinkStyle = {
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-5)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  textDecoration: "none",
} as const;

const actionsRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
} as const;

// ============================================================================
// Bandeau du jour (minutes + niveaux touchés aujourd'hui) + série (WIREFRAMES §7 en-tête).
// ============================================================================
function TodayBanner({
  today,
  currentStreakDays,
  levelsToday,
}: {
  readonly today: DayActivity | null;
  readonly currentStreakDays: number;
  readonly levelsToday: number | null;
}) {
  const summary =
    today === null
      ? d.today.notPlayed
      : levelsToday === null
        ? fill(d.today.minutesOnly, "{min}", String(today.activeMinutes))
        : fill(
            fill(
              pluralize(levelsToday, d.today.summary, d.today.summaryPlural),
              "{min}",
              String(today.activeMinutes),
            ),
            "{n}",
            String(levelsToday),
          );
  const streak =
    currentStreakDays > 0
      ? fill(
          pluralize(currentStreakDays, d.today.streak, d.today.streakPlural),
          "{n}",
          String(currentStreakDays),
        )
      : d.today.noStreak;
  return (
    <div style={sectionStyle}>
      <p style={bodyTextStyle}>{summary}</p>
      <p style={{ ...bodyTextStyle, ...rowStyle }}>
        <span aria-hidden="true">{FIRE_ICON}</span>
        <span>{streak}</span>
      </p>
    </div>
  );
}

// ============================================================================
// Justesse (semaine) + tendance + détail par compétence (barres).
// ============================================================================
type TrendWords = Record<"improving" | "regressing" | "stable", string>;

/** Mot de tendance seul (`words.stable` si `delta === null`, sinon `improving`/`regressing`
 * selon `direction`). `delta === null` ⟺ `direction === "stable"` (computeTrend, `stats.ts`). */
function trendWord(trend: Trend, words: TrendWords): string {
  if (trend.delta === null) {
    return words.stable;
  }
  return trend.direction === "improving" ? words.improving : words.regressing;
}

/** Tendance de JUSTESSE : mot + delta signé en points de %, composés en une phrase (WIREFRAMES
 * §7 « ▲ +5% »). SPÉCIFIQUE à la justesse (delta = ratio `[0,1]`) — jamais réutilisé pour la
 * rapidité (delta en ms, une sémantique de formatage DIFFÉRENTE, cf. `speedTrendText`). */
function accuracyTrendText(trend: Trend): string {
  if (trend.delta === null) {
    return d.accuracy.trend.stable;
  }
  const word =
    trend.direction === "improving" ? d.accuracy.trend.improving : d.accuracy.trend.regressing;
  const delta = fill(d.accuracy.delta, "{delta}", signedPercentPoints(trend.delta));
  return fill(fill(d.accuracy.trendWithDelta, "{trend}", word), "{delta}", delta);
}

const barTrackStyle = {
  flex: 1,
  height: "var(--parent-bar-height)",
  backgroundColor: "var(--parent-bar-track-bg)",
  borderRadius: "var(--parent-bar-radius)",
  overflow: "hidden",
} as const;

function SkillBar({ skill, ratio }: { readonly skill: Skill; readonly ratio: number | null }) {
  const pct = ratio === null ? 0 : toPercent(ratio);
  const valueText =
    ratio === null ? d.accuracy.empty : fill(d.accuracy.value, "{pct}", String(pct));
  return (
    <div style={rowStyle}>
      <span style={{ ...mutedTextStyle, minWidth: "9ch" }}>{SKILL_LABEL[skill]}</span>
      <span
        role="img"
        aria-label={fill(
          fill(d.accuracy.skillBarLabel, "{skill}", SKILL_LABEL[skill]),
          "{value}",
          valueText,
        )}
        style={barTrackStyle}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${pct}%`,
            backgroundColor: "var(--parent-bar-fill-bg)",
            borderRadius: "var(--parent-bar-radius)",
          }}
        />
      </span>
      <span style={{ ...bodyTextStyle, minWidth: "5ch", textAlign: "right" }}>{valueText}</span>
    </div>
  );
}

// ============================================================================
// Sparkline de justesse QUOTIDIENNE (issue #241, ADR 0018) — réalise honnêtement la métaphore
// du wireframe (WIREFRAMES §7 `▁▃▅▆▇`) avec de VRAIES données journalières `accuracyDaily`
// (jamais `AccuracyStats.trend`, qui n'expose que current/previous, ADR 0012 inchangée).
// ============================================================================
const accuracySparklineTrackStyle = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-2)",
  height: "var(--parent-chart-max-height)",
  padding: "var(--space-2)",
  backgroundColor: "var(--parent-chart-track-bg)",
  borderRadius: "var(--border-radius-md)",
} as const;

// `accuracy` est TOUJOURS dans `[0,1]` (contrat `AccuracyDayPoint`) → hauteur = pourcentage
// DIRECT, aucune mise à l'échelle par un maximum de fenêtre (contrairement au graphique de
// régularité, qui normalise contre `maxMinutes`). Plancher 4 % : un jour à 0 % de justesse reste
// une barre RÉELLE et VISIBLE, jamais une hauteur nulle qui lirait comme un bug (#170).
const accuracySparklineBarStyle = (accuracy: number) =>
  ({
    display: "block",
    width: "var(--parent-chart-bar-width)",
    height: `${Math.max(accuracy * 100, 4)}%`,
    backgroundColor: "var(--parent-accuracy-sparkline-fill-bg)",
    borderRadius: "var(--parent-bar-radius)",
  }) as const;

/**
 * Rend la sparkline si ≥2 jours de justesse existent dans l'**historique COMPLET** (une FORME
 * exige au moins 2 points, WIREFRAMES §7 « voir la forme de la tendance ») ; sinon un repli
 * textuel accessible (`sparklineEmpty`, même patron que `regularity.chartEmpty`). `days` = série
 * COMPLÈTE triée croissante (`ParentStats.accuracyDaily`) — cette fonction tranche elle-même les
 * derniers `windowDays` POINTS AVEC DONNÉES (même sémantique que `RegularitySection` tranchant ses
 * 7 derniers jours JOUÉS, pas les 7 derniers jours calendaires) — jamais un second découpage
 * inventé.
 *
 * **La garde de lisibilité porte sur `days.length` (l'historique ENTIER), PAS sur le compte
 * post-découpage** : gater sur `days.slice(-windowDays).length` rendrait le gabarit SINGULIER
 * (« 1 dernier jour ») structurellement INATTEIGNABLE — `windowDays = 1` produirait TOUJOURS
 * `recentDays.length <= 1 < 2`, quel que soit le volume d'historique réel, donc jamais affiché
 * (piège #125 « déclaré ≠ rendu », variante fenêtre plutôt que donnée). En gatant sur l'historique
 * complet, un `windowDays` configuré à 1 (⚙️ valide, `trendWindowDays ≥ 1`) avec ≥2 jours
 * d'historique réel rend légitimement 1 SEULE barre + le gabarit singulier — un rendu MINIMAL mais
 * jamais un texte mort.
 */
function AccuracySparkline({
  days,
  windowDays,
}: {
  readonly days: readonly AccuracyDayPoint[];
  readonly windowDays: number;
}) {
  if (days.length < 2) {
    return <p style={mutedTextStyle}>{d.accuracy.sparklineEmpty}</p>;
  }
  const recentDays = days.slice(-windowDays);
  const label = fill(
    pluralize(windowDays, d.accuracy.sparkline, d.accuracy.sparklinePlural),
    "{n}",
    String(windowDays),
  );
  return (
    <div role="img" aria-label={label} style={accuracySparklineTrackStyle}>
      {recentDays.map((day) => (
        <span
          key={day.dayOrdinal}
          aria-hidden="true"
          style={accuracySparklineBarStyle(day.accuracy)}
        />
      ))}
    </div>
  );
}

function AccuracySection({
  accuracy,
  accuracyDaily,
  sparklineWindowDays,
}: {
  readonly accuracy: AccuracyStats;
  readonly accuracyDaily: readonly AccuracyDayPoint[];
  readonly sparklineWindowDays: number;
}) {
  const valueText =
    accuracy.overall === null
      ? d.accuracy.empty
      : fill(d.accuracy.value, "{pct}", String(toPercent(accuracy.overall)));
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.accuracy.heading}</h2>
      <p style={bodyTextStyle}>{valueText}</p>
      {accuracy.overall !== null && (
        <p style={mutedTextStyle}>{accuracyTrendText(accuracy.trend)}</p>
      )}
      <AccuracySparkline days={accuracyDaily} windowDays={sparklineWindowDays} />
      <h3 style={{ ...headingStyle, fontSize: "var(--font-size-sm)" }}>
        {d.accuracy.bySkillHeading}
      </h3>
      <div style={sectionStyle}>
        {SKILLS.map((skill) => (
          <SkillBar key={skill} skill={skill} ratio={accuracy.bySkill[skill]} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Rapidité moyenne + tendance.
// ============================================================================
function SpeedSection({ speed }: { readonly speed: SpeedStats }) {
  const valueText =
    speed.overallMs === null
      ? d.speed.empty
      : fill(d.speed.value, "{s}", toSecondsFr(speed.overallMs));
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.speed.heading}</h2>
      <p style={bodyTextStyle}>{valueText}</p>
      {speed.overallMs !== null && (
        <p style={mutedTextStyle}>{trendWord(speed.trend, d.speed.trend)}</p>
      )}
    </div>
  );
}

// ============================================================================
// Carte de maîtrise (heatmap maîtrisé/en cours/à renforcer) — un badge par compétence.
// ============================================================================
/** Triade de tokens `--parent-mastery-<niveau>-{bg,border,glyph}` par niveau (tokens.css). */
const MASTERY_TOKEN_PREFIX: Record<MasteryLevel, string> = {
  mastered: "--parent-mastery-mastered",
  "in-progress": "--parent-mastery-inprogress",
  weak: "--parent-mastery-weak",
};

function masteryBadgeStyle(level: MasteryLevel) {
  const prefix = MASTERY_TOKEN_PREFIX[level];
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "var(--parent-mastery-badge-size)",
    height: "var(--parent-mastery-badge-size)",
    borderRadius: "var(--border-radius-sm)",
    backgroundColor: `var(${prefix}-bg)`,
    border: `2px solid var(${prefix}-border)`,
    color: `var(${prefix}-glyph)`,
    fontFamily: "var(--font-family-display)",
    fontWeight: "var(--font-weight-bold)",
  } as const;
}

function MasterySection({ masteryMap }: { readonly masteryMap: MasteryMap }) {
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.mastery.heading}</h2>
      <div style={sectionStyle}>
        {SKILLS.map((skill) => {
          const entry = masteryMap[skill];
          return (
            <div key={skill} style={rowStyle}>
              <span aria-hidden="true" style={masteryBadgeStyle(entry.level)}>
                {MASTERY_ICON[entry.level]}
              </span>
              <span style={bodyTextStyle}>{SKILL_LABEL[skill]}</span>
              <span style={mutedTextStyle}>{MASTERY_LABEL[entry.level]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// À revoir (top calculs ratés/lents) — liste de puces, jamais un texte inline joint par un
// séparateur en dur (une vraie liste porte mieux l'a11y que la ponctuation du wireframe).
// ============================================================================
const reviewChipStyle = {
  display: "inline-flex",
  minHeight: "var(--tap-target-min)",
  alignItems: "center",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--parent-review-chip-radius)",
  backgroundColor: "var(--parent-review-chip-bg)",
  color: "var(--parent-review-chip-text)",
  fontFamily: "var(--font-family-numeric)",
  fontSize: "var(--font-size-base)",
} as const;

const reviewListStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
  margin: 0,
  padding: 0,
  listStyle: "none",
} as const;

/** Libellé d'affichage d'un calcul à revoir — réutilise `formatEquation` (COPY §6, jamais un
 * second gabarit d'équation). Repli sur la clé brute si `factKey` est malformé (garde de forme,
 * `parseFactKey` est total et robuste — jamais atteint pour une clé issue de `attempts` réelles). */
function equationLabel(item: ReviewItem): string {
  const fact = parseFactKey(item.factKey);
  return fact === null ? item.factKey : formatEquation(fact.skill, fact.operands);
}

function ReviewSection({ reviewList }: { readonly reviewList: readonly ReviewItem[] }) {
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.review.heading}</h2>
      {reviewList.length === 0 ? (
        <p style={mutedTextStyle}>{d.review.empty}</p>
      ) : (
        <ul aria-label={d.review.heading} style={reviewListStyle}>
          {reviewList.map((item) => (
            <li key={item.factKey} style={reviewChipStyle}>
              {equationLabel(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// Régularité (jours joués, série record, respect de la fenêtre saine, mini-graphique jours).
// ============================================================================
// `maxMinutes > 0` est GARANTI par le seul appelant (`isChartReadable`, plus bas) : un
// `maxMinutes` nul empêche le graphique de se rendre (repli textuel à la place) → pas de
// branche défensive `maxMinutes === 0` ici (redondante avec la garde de l'appelant, jamais
// atteignable/testable — CLAUDE.md « correct ≠ testable ≠ nécessaire », rétro #143).
const chartBarStyle = (activeMinutes: number, maxMinutes: number) =>
  ({
    display: "block",
    width: "var(--parent-chart-bar-width)",
    // Hauteur PROPORTIONNELLE (jamais 0 si l'enfant a joué — `Math.max` évite une barre
    // invisible pour une activité réelle mais très courte, cf. #170 « rendu ≠ visible »).
    height: `${Math.max((activeMinutes / maxMinutes) * 100, 4)}%`,
    backgroundColor: "var(--parent-chart-fill-bg)",
    borderRadius: "var(--parent-bar-radius)",
  }) as const;

const chartTrackStyle = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-2)",
  height: "var(--parent-chart-max-height)",
  padding: "var(--space-2)",
  backgroundColor: "var(--parent-chart-track-bg)",
  borderRadius: "var(--border-radius-md)",
} as const;

function RegularitySection({
  daysPlayed,
  recordStreakDays,
  today,
  days,
  respectWindowMinMinutes,
  respectWindowMaxMinutes,
}: {
  readonly daysPlayed: number;
  readonly recordStreakDays: number;
  readonly today: DayActivity | null;
  readonly days: readonly DayActivity[];
  readonly respectWindowMinMinutes: number;
  readonly respectWindowMaxMinutes: number;
}) {
  // Derniers jours affichés (fenêtre ⚙️ partagée avec la tendance hebdo — pas un second réglage
  // de largeur de graphique inventé, cf. corps de PR).
  const recentDays = days.slice(-7);
  const maxMinutes = recentDays.reduce((max, day) => Math.max(max, day.activeMinutes), 0);
  // Repli textuel accessible (review Frontend PR #239) : à < 2 jours ou toutes les minutes à 0,
  // le graphique n'est qu'un trait quasi invisible (chaque barre au plancher 4 %, indiscernable
  // d'un bug d'affichage) — un repli TEXTE vaut mieux qu'un graphique illisible ET non-consommé.
  const isChartReadable = recentDays.length >= 2 && maxMinutes > 0;
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.regularity.heading}</h2>
      <p style={bodyTextStyle}>
        {fill(
          pluralize(daysPlayed, d.regularity.daysPlayed, d.regularity.daysPlayedPlural),
          "{n}",
          String(daysPlayed),
        )}
      </p>
      <p style={mutedTextStyle}>
        {fill(
          pluralize(recordStreakDays, d.regularity.recordStreak, d.regularity.recordStreakPlural),
          "{n}",
          String(recordStreakDays),
        )}
      </p>
      {today !== null && (
        <p style={{ ...bodyTextStyle, ...rowStyle }}>
          <span aria-hidden="true">{RESPECT_ICON[today.respect]}</span>
          <span>{RESPECT_LABEL[today.respect]}</span>
        </p>
      )}
      <p style={mutedTextStyle}>
        {fill(
          fill(d.regularity.respectHint, "{min}", String(respectWindowMinMinutes)),
          "{max}",
          String(respectWindowMaxMinutes),
        )}
      </p>
      {isChartReadable ? (
        <div role="img" aria-label={d.regularity.chartLabel} style={chartTrackStyle}>
          {recentDays.map((day) => (
            <span
              key={day.dayOrdinal}
              aria-hidden="true"
              style={chartBarStyle(day.activeMinutes, maxMinutes)}
            />
          ))}
        </div>
      ) : (
        <p style={mutedTextStyle}>{d.regularity.chartEmpty}</p>
      )}
    </div>
  );
}

// ============================================================================
// Progression (monde/niveaux, créatures débloquées).
// ============================================================================
function ProgressionSection({ progression }: { readonly progression: ProgressionSummary | null }) {
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.progression.heading}</h2>
      {progression === null ? (
        <p style={mutedTextStyle}>{d.progression.unavailable}</p>
      ) : (
        <>
          <p style={bodyTextStyle}>
            {fill(d.progression.world, "{n}", String(progression.worldNumber))}
          </p>
          <p style={mutedTextStyle}>
            {fill(
              fill(
                pluralize(
                  progression.totalLevels,
                  d.progression.levels,
                  d.progression.levelsPlural,
                ),
                "{completed}",
                String(progression.levelsCompleted),
              ),
              "{total}",
              String(progression.totalLevels),
            )}
          </p>
          <p style={mutedTextStyle}>
            {fill(
              pluralize(
                progression.creaturesCount,
                d.progression.creatures,
                d.progression.creaturesPlural,
              ),
              "{n}",
              String(progression.creaturesCount),
            )}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Assemblage complet de l'écran (WIREFRAMES §7). Le `<h1>` reste **inchangé** depuis le stub
 * 7.1 (`strings.parent.dashboard.title`, sans focus programmatique — pas de stack-trap outline
 * UA #222 ici, cette page n'est jamais atteinte par un redirect client qui exigerait l'annonce
 * SR). Liens « Gérer les profils »/« Réglages » + sortie repris **tels quels** (7.1/7.5/7.3).
 *
 * **« Mondes à valider » (story 7.9, issue #231)** : lien **toujours affiché** (indépendant du
 * toggle « Votre approbation », 7.3 — des mondes en attente peuvent survivre à sa désactivation),
 * avec un repère de compte pluralisé (`pluralize`, promotion #239) affiché **seulement si > 0**
 * (jamais « 0 monde en attente » — bruit inutile, posture no-fail).
 */
export function ParentDashboard({
  displayName,
  stats,
  progression,
  respectWindowMinMinutes,
  respectWindowMaxMinutes,
  pendingWorldsCount,
  sparklineWindowDays,
}: ParentDashboardProps) {
  return (
    <main className="bg-bg text-text" style={mainStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>{d.title}</h1>
        <p style={subtitleStyle}>{fill(d.subtitle, "{prénom}", displayName)}</p>
        <TodayBanner
          today={stats.regularity.today}
          currentStreakDays={stats.regularity.currentStreakDays}
          levelsToday={progression === null ? null : progression.levelsToday}
        />
        <AccuracySection
          accuracy={stats.accuracy}
          accuracyDaily={stats.accuracyDaily}
          sparklineWindowDays={sparklineWindowDays}
        />
        <SpeedSection speed={stats.speed} />
        <MasterySection masteryMap={stats.masteryMap} />
        <ReviewSection reviewList={stats.reviewList} />
        <RegularitySection
          daysPlayed={stats.regularity.daysPlayed}
          recordStreakDays={stats.regularity.recordStreakDays}
          today={stats.regularity.today}
          days={stats.regularity.days}
          respectWindowMinMinutes={respectWindowMinMinutes}
          respectWindowMaxMinutes={respectWindowMaxMinutes}
        />
        <ProgressionSection progression={progression} />
        {pendingWorldsCount > 0 && (
          <p style={mutedTextStyle}>
            {fill(
              pluralize(pendingWorldsCount, d.worldApprovalCount, d.worldApprovalCountPlural),
              "{n}",
              String(pendingWorldsCount),
            )}
          </p>
        )}
        <div style={actionsRowStyle}>
          <Link href="/parent/profils" style={manageLinkStyle} className="mz-focusable">
            {d.manageLink}
          </Link>
          <Link href="/parent/reglages" style={manageLinkStyle} className="mz-focusable">
            {d.settingsLink}
          </Link>
          <Link href="/parent/mondes" style={manageLinkStyle} className="mz-focusable">
            {d.worldApprovalLink}
          </Link>
        </div>
        <ParentExitButton />
      </div>
    </main>
  );
}
