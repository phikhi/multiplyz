import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import {
  getEngineConfig,
  getMapConfig,
  getRegularityConfig,
  getReportingConfig,
} from "@/config/server-config";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { listManagedProfiles } from "@/lib/parent/profiles";
import { loadParentStats } from "@/lib/parent/stats-source";
import type { StatsConfig } from "@/lib/parent/stats";
import { loadProgressionSummary, type ProgressionSummary } from "@/lib/parent/progression";
import { countPendingWorlds } from "@/lib/parent/world-approval";
import { SocleUnavailableError } from "@/lib/worldgen/socle";
import { ParentDashboard, type ParentDashboardProps } from "./ParentDashboard";

// Rendu dynamique (route gardée par `(espace)/layout.tsx` qui lit la session à chaque
// requête) → jamais prérendu au build. Runtime Node explicite (cohérence épic auth).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Charge + compose tout ce que `ParentDashboard` a besoin d'afficher pour un profil
 * (7.2/7.4/7.7/#241, lecture seule). **Fonction régulière** (pas un composant) : c'est ICI, à la frontière
 * serveur/données, que l'horloge (`Date.now()`) est légitimement lue UNE fois et **injectée**
 * dans les fonctions pures en aval — jamais un `Date.now()` interne à un composant (règle de
 * pureté React 19 des Server Components, en plus de la discipline horloge-injectée CLAUDE.md).
 *
 * **Résilience du bloc progression** : `loadProgressionSummary` peut lever
 * `SocleUnavailableError` (socle de secours non amorcé, 6.6/6.7) — interceptée ICI pour que SEUL
 * ce bloc affiche un repli neutre (`ParentDashboard` gère `progression: null`), jamais tout le
 * tableau de bord (même discipline que l'écran carte, `carte/actions.ts`, story 6.7).
 *
 * **`pendingWorldsCount` (story 7.9)** : lecture `countPendingWorlds(db)` **foyer** (pas
 * `profileId`) — les mondes sont partagés entre profils (WORLDGEN §1, pas de FK profil sur
 * `worlds`), même portée que le buffer lui-même.
 */
async function loadDashboardProps(profileId: number): Promise<ParentDashboardProps> {
  const db = getDb();
  const now = Date.now();

  const statsConfig: StatsConfig = {
    engine: getEngineConfig(),
    reporting: getReportingConfig(),
    regularity: getRegularityConfig(),
  };
  const stats = loadParentStats(db, profileId, statsConfig, now);

  const profiles = listManagedProfiles(db);
  const displayName = profiles.find((p) => p.id === profileId)?.name ?? "";

  const mapConfig = getMapConfig();
  let progression: ProgressionSummary | null = null;
  try {
    progression = loadProgressionSummary(
      db,
      profileId,
      mapConfig,
      statsConfig.engine,
      statsConfig.regularity,
      now,
    );
  } catch (error) {
    if (!(error instanceof SocleUnavailableError)) throw error;
    // Socle non amorcé → `progression` reste `null`, `ParentDashboard` affiche un repli neutre
    // pour CE bloc seulement (le reste du tableau de bord ne dépend pas de la carte/collection).
  }

  return {
    displayName,
    stats,
    progression,
    respectWindowMinMinutes: statsConfig.regularity.respectWindowMinMinutes,
    respectWindowMaxMinutes: statsConfig.regularity.respectWindowMaxMinutes,
    pendingWorldsCount: countPendingWorlds(db),
    // Sparkline de justesse quotidienne (issue #241, ADR 0018) : réutilise l'⚙️ EXISTANT
    // `trendWindowDays` (ADR 0012, même « semaine glissante » que le titre « Justesse (semaine) »
    // ci-dessus) — jamais un second réglage de largeur inventé.
    sparklineWindowDays: statsConfig.reporting.trendWindowDays,
  };
}

/**
 * **Tableau de bord parent** (story 7.7, WIREFRAMES §7). Charge le **profil de la session
 * parent** (jamais un profil client) et délègue l'assemblage à `loadDashboardProps`, puis rend
 * `ParentDashboard` (composant de présentation pur, testé isolément).
 *
 * **Garde répétée** (défense en profondeur, même patron que les server actions) : le groupe
 * `(espace)/layout.tsx` redirige déjà sans session parent valide, mais cette page **relit** la
 * session pour obtenir le `profileId` — un `null` ici (session révoquée entre le layout et la
 * page, course rarissime) redirige à nouveau plutôt que de planter.
 */
export default async function ParentDashboardPage() {
  const session = await getCurrentParentSession();
  if (session === null) {
    redirect("/");
    return null; // inatteignable en prod (`redirect` lève) ; garde le contrôle de flux testable
  }

  const props = await loadDashboardProps(session.profileId);
  return <ParentDashboard {...props} />;
}
