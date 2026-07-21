"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";

/**
 * **Shell applicatif persistant** (story R1.1 #337, WIREFRAMES §2 « 🪙120 ✨40 ⚙️ 👤 »).
 * Monté **UNE SEULE FOIS** par `(app)/layout.tsx`, visible en continu sur `/carte`,
 * `/collection`, `/jouer` — remplace les 3 `LogoutButton` dupliqués par écran
 * (`MapScreen`, `PlayScreen` ×2) par UN SEUL montage ici (👤).
 *
 * **Non-occlusion STRUCTURELLE** (CLAUDE.md, extension #170/#190/#278 — préférée à la
 * non-occlusion GARDÉE par overlay `position:fixed` + `boundingClientRect`) : ce
 * `<header>` est le **premier enfant EN FLUX** du layout (aucun `position`), il **réserve
 * un espace réel** (`--app-shell-height`) et **pousse** le `<main>` de chaque écran vers
 * le bas — par construction, il ne peut ni occulter ni relocaliser une occlusion vers une
 * route non testée (contrairement à un bandeau `fixed`). Chaque écran enfant du groupe
 * `(app)` compense la hauteur réservée (`minHeight: calc(100dvh - var(--app-shell-height))`
 * au lieu de `100dvh` brut) pour rester exactement un viewport, jamais de scroll excédentaire.
 * Volontairement **statique** (jamais `position:sticky`) : la carte (`MapScreen`) fait un
 * auto-scroll vers le nœud courant au montage (story #268, `scrollIntoView`) — un bandeau
 * sticky réintroduirait un risque d'occlusion partielle de la cible scrollée, non couvert
 * par la garde `boundingClientRect` existante de cette feature.
 *
 * **Solde pièces/éclats** (ECONOMY §3.1) — lu **serveur** par `(app)/layout.tsx`
 * (`loadWallet`, source de vérité, session-based) et projeté en props ici : ce composant
 * n'a AUCUN accès DB, pur affichage. Consomme les tokens `--topbar-*` déclarés depuis
 * l'épic #5 mais restés SANS consommateur DOM jusqu'ici (piège #125 « déclaré ≠ rendu »).
 * `--color-coin`/`--color-shard` (comme `--color-star`) ÉCHOUENT le contraste texte sur
 * fond neutre (~1.5:1, rétro #104/#125/#126) : jamais posés en `color` sur le CHIFFRE
 * (`--color-text-primary` fiable, même règle que `ResultsScreen.tsx`/`CollectionScreen.tsx`)
 * ni sur l'emoji (police emoji couleur native, `color` CSS sans effet). Consommation SÛRE =
 * un lavis DÉCORATIF dilué derrière chaque pastille (`--topbar-*-tint`, `color-mix` 12 %,
 * même technique que `--world-bg-tint` #184/#199) — redondant avec l'emoji (🪙 ≠ ✨ par
 * FORME, jamais la seule couleur), donc hors du réquisit WCAG 1.4.11 « objet requis ».
 *
 * **Pluriel FR n≤1 → singulier** (CLAUDE.md #239) : `0`/`1` pièce/éclat = singulier, `≥2` =
 * pluriel — nouvelle règle honorée ici (distincte du gabarit legacy `n===1` seul de
 * `ResultsScreen`/`MapScreen`, résidu pré-#239 hors scope de cette story).
 *
 * **⚙️ réglages — résolution de l'ambiguïté WIREFRAMES §2** : il n'existe AUCUNE route de
 * réglages enfant (seule `parent/(espace)/reglages` existe, PIN-gatée, DETAILS §3). Le SEUL
 * réglage no-PIN enfant est `SoundQuickMute` (DETAILS §3 « in-game », ADR 0017) —
 * délibérément **laissé inchangé et scopé au niveau de jeu** (loud SFX/musique n'y jouent
 * QUE là ; `/carte`/`/collection` sont silencieux aujourd'hui) plutôt que manufacturé ici,
 * pour ne PAS inventer une nouvelle surface de réglages enfant (consigne du brief). ⚙️
 * REUTILISE donc le point d'entrée PIN-gaté EXISTANT (`ProfileSelector` « 🔒 Parent »,
 * WIREFRAMES §1a) — un lien nu vers `/`, ZÉRO nouvelle logique de session/PIN, copie
 * honnête (« Réglages » mène à la porte, pas directement dans l'espace parent — le PIN
 * reste à saisir). 👤 reste l'action de déconnexion existante (`LogoutButton`, logique
 * inchangée — seul son rendu VISUEL est resserré ici via `compact`, cf. ci-dessous).
 *
 * **⚙️/👤 = icône SEULE, jamais de libellé visible** (WIREFRAMES §2 montre `⚙️  👤` nus) — nom
 * accessible complet porté par `aria-label`/`compact` (jamais icône sans alternative texte,
 * a11y). Choix STRUCTUREL, pas seulement esthétique : un libellé visible (« ⚙️ Réglages »,
 * « 👤 Changer de joueur ») ferait passer le bandeau à la ligne sur un viewport étroit (375px)
 * — mesuré empiriquement (147px de haut au lieu des 60px déclarés par `--app-shell-height`) —
 * ce qui rendrait ce token FAUX et rognerait la marge sous la barre d'action fixe de
 * `PlayScreen` (story 8.1 #254, régression réelle rencontrée puis corrigée à la source).
 *
 * **A11y** : cibles ≥44px (`--tap-target-min`), chaque solde porte un nom accessible complet
 * (`role="img"`, glyphe+chiffre `aria-hidden`, daltonisme — la FORME de l'emoji distingue déjà
 * pièces d'éclats, jamais la seule couleur), `prefers-reduced-motion` : aucune animation posée.
 */
export interface AppShellProps {
  /** Solde de pièces courant (ECONOMY §3.1, `loadWallet`) — 0 = état initial normal. */
  readonly coins: number;
  /** Solde d'éclats courant (ECONOMY §3.1, doublon de créature) — 0 = état initial normal. */
  readonly shards: number;
}

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const COIN_ICON = "🪙";
const SHARD_ICON = "✨";
const SETTINGS_ICON = "⚙️";

function fillCount(template: string, n: number): string {
  return template.replace("{n}", String(n));
}

/** Français : n≤1 → singulier (0 ET 1), n≥2 → pluriel (CLAUDE.md #239). */
function countLabel(n: number, singular: string, plural: string): string {
  return fillCount(n <= 1 ? singular : plural, n);
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "var(--space-3)",
  minHeight: "var(--app-shell-height)",
  padding: "var(--space-2) var(--space-4)",
  backgroundColor: "var(--topbar-bg)",
  borderBottom: "1px solid var(--topbar-border)",
};

const balanceGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

function balancePillStyle(tint: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-1)",
    minHeight: "var(--tap-target-min)",
    padding: "var(--space-1) var(--space-3)",
    borderRadius: "var(--border-radius-full)",
    backgroundColor: tint,
  };
}

const balanceNumberStyle: CSSProperties = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
};

const actionsGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

// Icône SEULE (pas de libellé visible) — WIREFRAMES §2 montre `⚙️  👤` nus dans le bandeau, ET
// c'est ce qui garde ce bandeau RÉELLEMENT sur une seule ligne à `--app-shell-height` à TOUTE
// largeur (375px inclus) : un libellé visible ferait passer le bandeau à la ligne, rendant le
// token `--app-shell-height` FAUX (hauteur réelle > déclarée) et rognant la marge sous la barre
// d'action fixe de `PlayScreen` (story 8.1 #254, régression mesurée puis corrigée à la source).
// Nom accessible complet porté par `aria-label` (jamais icône SANS alternative texte, a11y).
const settingsLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "var(--tap-target-min)",
  minWidth: "var(--tap-target-min)",
  padding: "var(--space-2)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  textDecoration: "none",
};

export function AppShell({ coins, shards }: AppShellProps) {
  const s = strings.shell;
  const coinsLabel = countLabel(coins, s.balanceCoins, s.balanceCoinsPlural);
  const shardsLabel = countLabel(shards, s.balanceShards, s.balanceShardsPlural);

  return (
    <header data-app-shell="" style={headerStyle}>
      <div style={balanceGroupStyle}>
        <span
          role="img"
          aria-label={coinsLabel}
          data-shell-balance="coins"
          data-shell-balance-value={coins}
          style={balancePillStyle("var(--topbar-coin-tint)")}
        >
          <span aria-hidden="true">{COIN_ICON}</span>
          <span aria-hidden="true" style={balanceNumberStyle}>
            {coins}
          </span>
        </span>
        <span
          role="img"
          aria-label={shardsLabel}
          data-shell-balance="shards"
          data-shell-balance-value={shards}
          style={balancePillStyle("var(--topbar-shard-tint)")}
        >
          <span aria-hidden="true">{SHARD_ICON}</span>
          <span aria-hidden="true" style={balanceNumberStyle}>
            {shards}
          </span>
        </span>
      </div>
      <div style={actionsGroupStyle}>
        {/* ⚙️ = doorway vers le point d'entrée PIN-gaté EXISTANT (ProfileSelector « 🔒 Parent »),
            jamais une nouvelle surface de réglages enfant — cf. JSDoc de tête. Icône seule +
            aria-label (nom accessible complet), cf. `settingsLinkStyle`. */}
        <Link
          href="/"
          className="mz-focusable"
          aria-label={s.settingsLabel}
          data-app-shell-settings=""
          style={settingsLinkStyle}
        >
          <span aria-hidden="true">{SETTINGS_ICON}</span>
        </Link>
        {/* 👤 = déconnexion / changer de joueur (composant EXISTANT, `compact` = icône seule,
            même rationale que ⚙️ ci-dessus — cf. LogoutButton.tsx). */}
        <LogoutButton compact />
      </div>
    </header>
  );
}
