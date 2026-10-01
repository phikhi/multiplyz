import Link from "next/link";
import { strings } from "@/strings";
import { parent as p } from "@/strings/parent";
import { SKILLS } from "@/lib/engine/domain";
import { parseFactKey } from "@/lib/engine/facts";
import { formatEquation } from "@/lib/game/equation";
import type { ParentStats } from "@/lib/parent/stats";
import type { ProgressionSummary } from "@/lib/parent/progression";
import { PARENT_SMALL_SAMPLE, type ParentOverview } from "@/lib/parent/overview";
import { signedPercentPoints, toPercent, toSecondsFr } from "./dashboard-format";

export interface ParentDashboardProps {
  readonly displayName: string;
  readonly stats: ParentStats;
  readonly progression: ProgressionSummary | null;
  readonly respectWindowMinMinutes: number;
  readonly respectWindowMaxMinutes: number;
  readonly pendingWorldsCount: number;
  readonly sparklineWindowDays: number;
  readonly overview?: ParentOverview;
  readonly profileId?: number;
  readonly profiles?: readonly { id: number; name: string }[];
}
const percent = (value: number | null) => (value === null ? p.empty : `${toPercent(value)} %`);
const equation = (key: string) => {
  const fact = parseFactKey(key);
  return fact ? formatEquation(fact.skill, fact.operands) : key;
};
const dayLabel = (ordinal: number) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    ordinal * 86400000,
  );
export function ParentDashboard({
  displayName,
  stats,
  progression,
  pendingWorldsCount,
  sparklineWindowDays,
  overview: o,
  profileId,
  profiles = [],
}: ParentDashboardProps) {
  if (!o) return null;
  const date = (value: number) =>
    new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: o.timeZone,
    }).format(value);
  return (
    <main className="parent-page parent-dashboard">
      <header className="parent-heading">
        <p className="parent-eyebrow">{p.nav}</p>
        <h1>{p.title(displayName)}</h1>
        <p>{p.intro}</p>
      </header>
      <form className="parent-filters" action="/parent">
        <label>
          {p.profile}
          <select name="profile" defaultValue={profileId} key={profileId}>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {p.period}
          <select name="period" defaultValue={o.period} key={o.period}>
            <option value="recent">{p.recent(sparklineWindowDays)}</option>
            <option value="month">{p.recent(sparklineWindowDays * 4)}</option>
            <option value="all">{p.all}</option>
          </select>
        </label>
        <button className="parent-primary" type="submit">
          {p.apply}
        </button>
      </form>
      <div className="parent-period">
        <strong>{o.start === null ? p.all : p.recent(o.days!)}</strong>
        <p>{o.start === null ? p.asOf(date(o.now)) : p.range(date(o.start), date(o.now))}</p>
        <p>{p.periodHint}</p>
      </div>
      {o.historyTotal === 0 && <p className="parent-notice">{p.noHistory}</p>}
      <div className="parent-summary">
        <section className="parent-panel parent-accuracy">
          <h2>{p.accuracy}</h2>
          <strong className="parent-number">{percent(o.accuracy.overall)}</strong>
          <p>{o.total === 0 ? p.noAnswers : p.answers(o.correct, o.total)}</p>
          {o.total > 0 && o.total < PARENT_SMALL_SAMPLE && (
            <p className="parent-caution">{p.small}</p>
          )}
          {o.comparison !== "history" && (
            <div className="parent-comparison">
              <h3>{p.prior(o.days!)}</h3>
              <p>
                {o.comparison === "missing"
                  ? p.noComparison
                  : o.comparison === "small"
                    ? p.small
                    : o.trend.direction === "stable"
                      ? p.stable
                      : p.delta(signedPercentPoints(o.trend.delta!))}
              </p>
              <p>{p.comparison(o.total, o.previousTotal)}</p>
            </div>
          )}
        </section>
        <section className="parent-panel">
          <h2>{p.speed}</h2>
          <strong className="parent-number">
            {o.speed.overallMs === null ? p.empty : p.seconds(toSecondsFr(o.speed.overallMs))}
          </strong>
          <p>{p.sample(o.total)}</p>
          <p>{p.speedHint}</p>
        </section>
        <section className="parent-panel parent-today">
          <h2>{p.today}</h2>
          <strong className="parent-number">
            {stats.regularity.today === null
              ? p.empty
              : stats.regularity.today.activeMinutes === 0
                ? p.zeroMinutes
                : p.minutes(stats.regularity.today.activeMinutes)}
          </strong>
          {stats.regularity.today === null && <p>{p.noToday}</p>}
          <a className="parent-text-link" href="#parent-time-method">
            {p.regularity}
          </a>
        </section>
      </div>
      <section className="parent-panel">
        <h2>{p.skills}</h2>
        <p>{p.skillsHint}</p>
        <div className="parent-skills">
          {SKILLS.map((skill) => {
            const sample = o.bySkill[skill],
              mastery = stats.masteryMap[skill];
            return (
              <article className="parent-skill" key={skill}>
                <h3>{strings.parent.dashboard.skills[skill]}</h3>
                <strong>{percent(o.accuracy.bySkill[skill])}</strong>
                <p>{p.answers(sample.correct, sample.total)}</p>
                <p>
                  {o.speed.bySkillMs[skill] === null
                    ? p.empty
                    : p.seconds(toSecondsFr(o.speed.bySkillMs[skill]!))}
                </p>
                {sample.total > 0 && sample.total < PARENT_SMALL_SAMPLE && (
                  <p className="parent-small-sample">{p.small}</p>
                )}
                <div className="parent-mastery">
                  <p>{sample.seen === 0 ? p.unseen : p.seen(sample.seen)}</p>
                  <p>{p.mastered(mastery.masteredCount, mastery.totalCount)}</p>
                  <meter
                    min={0}
                    max={mastery.totalCount || 1}
                    value={mastery.masteredCount}
                    aria-label={p.mastered(mastery.masteredCount, mastery.totalCount)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <div className="parent-columns">
        <section className="parent-panel">
          <h2>{p.daily}</h2>
          <p>{p.dailyHint}</p>
          {o.total === 0 ? (
            <p>{p.noAnswers}</p>
          ) : (
            <details className="parent-daily-details" open={o.daily.length <= 8}>
              <summary>{p.daily}</summary>
              <table className="parent-table">
                <thead>
                  <tr>
                    <th scope="col">{p.date}</th>
                    <th scope="col">{p.count}</th>
                    <th scope="col">{p.right}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.daily.map((day) => (
                    <tr key={day.dayOrdinal}>
                      <th scope="row">{dayLabel(day.dayOrdinal)}</th>
                      <td>{day.total || p.noDay}</td>
                      <td>
                        <span
                          className="parent-daily-bar"
                          style={
                            {
                              "--day-accuracy": `${(day.accuracy ?? 0) * 100}%`,
                            } as React.CSSProperties
                          }
                        >
                          {day.accuracy === null ? p.noDay : percent(day.accuracy)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
        <section className="parent-panel">
          <h2>{p.review}</h2>
          <p>{p.reviewHint}</p>
          {o.seen === 0 ? (
            <p>{p.reviewUnseen}</p>
          ) : (
            <>
              <dl className="parent-counts">
                <div>
                  <dt>{p.weak}</dt>
                  <dd>{o.weak}</dd>
                </div>
                <div>
                  <dt>{p.due}</dt>
                  <dd>{o.due}</dd>
                </div>
                <div>
                  <dt>{p.slow}</dt>
                  <dd>{o.slow}</dd>
                </div>
              </dl>
              <ul className="parent-review-list">
                {stats.reviewList.map((item) => (
                  <li key={item.factKey}>
                    <strong>{equation(item.factKey)}</strong>
                    <span>{p.reason[item.reason]}</span>
                  </li>
                ))}
              </ul>
              {stats.reviewList.length === 0 && <p>{p.reviewEmpty}</p>}
            </>
          )}
        </section>
      </div>
      <div className="parent-columns">
        <section className="parent-panel" id="parent-time-method">
          <h2>{p.regularity}</h2>
          <p className="parent-fact">{p.days(stats.regularity.daysPlayed)}</p>
          <p>{p.streak(stats.regularity.currentStreakDays)}</p>
          <p>{p.rest}</p>
          <p className="parent-method">{p.timeHint(o.maxAmplitudeMinutes, o.timeZone)}</p>
        </section>
        <section className="parent-panel">
          <h2>{p.adventure}</h2>
          {progression === null ? (
            <p>{p.adventureEmpty}</p>
          ) : (
            <>
              <p className="parent-fact">{p.world(progression.worldNumber)}</p>
              <p>{p.levels(progression.levelsCompleted, progression.totalLevels)}</p>
              <p>{p.creatures(progression.creaturesCount)}</p>
            </>
          )}
          <Link className="parent-text-link" href="/parent/mondes">
            {p.pending(pendingWorldsCount)}
          </Link>
        </section>
      </div>
    </main>
  );
}
