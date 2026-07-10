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
import type { DayActivity, DayRespect } from "@/lib/parent/regularity";
import type { ProgressionSummary } from "@/lib/parent/progression";
import { signedPercentPoints, toPercent, toSecondsFr } from "./dashboard-format";

/**
 * **Tableau de bord parent** (story 7.7, WIREFRAMES §7, PLAN §Espace parent). Assemble les
 * agrégats **déjà calculés** côté serveur (7.2 `stats.ts` + 7.4 `regularity.ts` + 7.7
 * `progression.ts`) — ce composant est un pur **rendu**, aucun calcul pédagogique/statistique
 * n'y vit (CLAUDE.md : la logique de maîtrise/reporting ne se réinvente pas côté UI). Registre
 * **neutre/vouvoiement** (COPY §5, pas Teddy), zéro texte en dur (strings centralisées), zéro
 * valeur en dur (tokens `tokens.css`).
 *
 * **Aucun élément superposé/positionné** (pas de `position:absolute`, pas de z-index) : barres,
 * badges et puces sont des frères en flux normal (`flex`) → hors du périmètre de la garde
 * d'occlusion #170 par construction (documenté au corps de PR, pas une esquive — une capture
 * Playwright ouverte/regardée reste obligatoire, DoD).
 */
export interface ParentDashboardProps {
  /** Prénom du profil affiché (gabarit du sous-titre, COPY §5 « Progression de {prénom} »). */
  readonly displayName: string;
  /** Agrégats complets (7.2 + 7.4), lecture seule, déjà calculés côté serveur. */
  readonly stats: ParentStats;
  /** Résumé de progression (7.7), ou `null` si le socle de secours n'est pas amorcé
   * (`SocleUnavailableError` — repli neutre, n'affecte QUE ce bloc, jamais tout l'écran). */
  readonly progression: ProgressionSummary | null;
  /** Borne basse ⚙️ de la fenêtre saine de temps de jeu (`RegularityConfig`, ADR 0014) —
   * interpolée dans le repère indicatif, jamais un « 15 » en dur. */
  readonly respectWindowMinMinutes: number;
  /** Borne haute ⚙️ de la fenêtre saine de temps de jeu. */
  readonly respectWindowMaxMinutes: number;
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
            fill(d.today.summary, "{min}", String(today.activeMinutes)),
            "{n}",
            String(levelsToday),
          );
  const streak =
    currentStreakDays > 0
      ? fill(d.today.streak, "{n}", String(currentStreakDays))
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

function AccuracySection({ accuracy }: { readonly accuracy: AccuracyStats }) {
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
const chartBarStyle = (activeMinutes: number, maxMinutes: number) =>
  ({
    display: "block",
    width: "var(--parent-chart-bar-width)",
    // Hauteur PROPORTIONNELLE (jamais 0 si l'enfant a joué — `Math.max` évite une barre
    // invisible pour une activité réelle mais très courte, cf. #170 « rendu ≠ visible »).
    height: maxMinutes > 0 ? `${Math.max((activeMinutes / maxMinutes) * 100, 4)}%` : "4%",
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
  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{d.regularity.heading}</h2>
      <p style={bodyTextStyle}>{fill(d.regularity.daysPlayed, "{n}", String(daysPlayed))}</p>
      <p style={mutedTextStyle}>
        {fill(d.regularity.recordStreak, "{n}", String(recordStreakDays))}
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
      {recentDays.length > 0 && (
        <div aria-hidden="true" style={chartTrackStyle}>
          {recentDays.map((day) => (
            <span key={day.dayOrdinal} style={chartBarStyle(day.activeMinutes, maxMinutes)} />
          ))}
        </div>
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
              fill(d.progression.levels, "{completed}", String(progression.levelsCompleted)),
              "{total}",
              String(progression.totalLevels),
            )}
          </p>
          <p style={mutedTextStyle}>
            {fill(d.progression.creatures, "{n}", String(progression.creaturesCount))}
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
 */
export function ParentDashboard({
  displayName,
  stats,
  progression,
  respectWindowMinMinutes,
  respectWindowMaxMinutes,
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
        <AccuracySection accuracy={stats.accuracy} />
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
        <div style={actionsRowStyle}>
          <Link href="/parent/profils" style={manageLinkStyle} className="mz-focusable">
            {d.manageLink}
          </Link>
          <Link href="/parent/reglages" style={manageLinkStyle} className="mz-focusable">
            {d.settingsLink}
          </Link>
        </div>
        <ParentExitButton />
      </div>
    </main>
  );
}
