"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { strings } from "@/strings";
import { INSTALL_PROMPT_DISMISSED_KEY } from "@/config/pwa";

/**
 * Invite d'installation PWA (story 8.5, #258 — cf. PLAN.md §Vérification "installable").
 * Le manifest (`src/app/manifest.ts`), le service worker (`public/sw.js`) et son
 * enregistrement (`ServiceWorkerRegistration`) existent déjà (épic 8, story 8.1) — CE
 * composant complète la couche **UX d'installation** : invite Chrome/Android
 * (`beforeinstallprompt`), hint manuel iOS Safari, jamais si déjà installée.
 *
 * **Gating de surface (AC1 « discrète »)** : montée globalement dans `layout.tsx`, mais
 * ne se REND que sur des surfaces enfant **calmes et déjà engagées** — sélecteur de
 * profil / retour quotidien (`/` avec foyer), carte (`/carte`), collection
 * (`/collection`). JAMAIS pendant l'**onboarding premier-run** (`/` sans foyer — PRODUCT
 * §1.1, premier contact enfant↔Teddy à ne pas recouvrir), JAMAIS pendant une **partie
 * active** (`/jouer` — PRODUCT §3.5, « sessions douces, zéro pression »), JAMAIS dans
 * l'**espace parent** (`/parent/*` — COPY §5, la voix Teddy ne fuite pas dans le registre
 * neutre parent). L'événement `beforeinstallprompt` est **capturé quelle que soit la
 * route** (il ne se re-déclenche pas), mais l'invite n'apparaît qu'une fois une surface
 * calme atteinte (`usePathname` re-rend au changement de route). Voir
 * `shouldShowInstallPromptOnSurface` (pur, testé branche par branche).
 *
 * **Bandeau EN FLUX qui RÉSERVE un espace réel, jamais un overlay `position:fixed` (rétro
 * #170/#190, defect PO round 2).** Un overlay fixé recouvre le CONTENU EN FLUX de la surface
 * hôte — d'abord le titre onboarding (corrigé par le gating), puis, une fois le gating posé, le
 * `<h1>` propre des surfaces autorisées (`« Ma collection 🐾 »`, titre carte) réduit à un
 * fragment d'emoji au-dessus de la carte. Le raisonnement « OfflineBanner en bas → zone haute
 * libre » n'avait vérifié que les FRÈRES FIXES, jamais le `<h1>` en flux normal (piège #170/#190
 * exact : mécanisme/token vert, pixel du contenu hôte jamais regardé). **Correctif** : monté en
 * PREMIER enfant de `<body>` (avant `{children}`), en **flux normal** (aucune `position`) → sa
 * hauteur POUSSE tout le contenu de page vers le bas ⇒ non-occlusion du `<h1>` hôte **par
 * construction** (impossible de le recouvrir : il vit sous le bandeau, jamais dessous). Scrolle
 * avec la page (pas `sticky`) → ne recouvre RIEN à AUCUNE position de scroll. Aucune coexistence
 * à gérer avec `OfflineBanner`/`ActionBar` (eux `position:fixed` en BAS ; le bandeau est en flux
 * en HAUT). Garde E2E de non-occlusion du `<h1>` HÔTE (`elementFromPoint`, `/collection` ET
 * `/carte`) + captures pixel-lookées desktop ET 375px.
 *
 * Registre : voix de Teddy, tutoiement (invite montée dans l'aire ENFANT via le layout
 * global — cf. COPY §1/§5, la zone parent a son propre registre neutre ailleurs).
 */

/** Surfaces enfant **calmes** hors `/` (session-gated par `(app)/layout.tsx` — y être ⟹ foyer). */
const CALM_CHILD_SURFACES: ReadonlySet<string> = new Set(["/carte", "/collection"]);

/**
 * L'invite peut-elle apparaître sur la surface courante ? (AC1 « discrète », gating game-design/PO).
 *
 * - `/carte` / `/collection` : surfaces enfant calmes, **déjà derrière la garde de session**
 *   (`(app)/layout.tsx` redirige vers `/` sans session enfant valide → y être implique un foyer +
 *   une session) → toujours éligibles.
 * - `/` : **ambigu** — écran d'onboarding premier-run si `householdExists === false` (à NE PAS
 *   recouvrir, PRODUCT §1.1), sélecteur de profil / retour quotidien si `true` (surface calme
 *   éligible). Le foyer tranche.
 * - tout le reste (`/jouer` partie active, `/parent/*` registre neutre, `/styleguide` outil dev,
 *   routes futures) : **jamais** — allowlist stricte pour rester « discrète » et ne pas fuiter.
 *
 * Pur (aucun accès DOM/réseau) → testable branche par branche, à effet observable.
 */
export function shouldShowInstallPromptOnSurface(
  pathname: string,
  householdExists: boolean,
): boolean {
  if (CALM_CHILD_SURFACES.has(pathname)) return true;
  if (pathname === "/") return householdExists;
  return false;
}

/** Événement `beforeinstallprompt` (Chrome/Android) — non standard, absent de `lib.dom.ts`. */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

/** Garde de type — un `Event` quelconque n'a pas `.prompt()`. */
function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as Partial<BeforeInstallPromptEvent>).prompt === "function";
}

/**
 * Déjà en mode standalone (app installée, lancée depuis l'écran d'accueil) ? (AC3)
 * `display-mode: standalone` = media query spec Web App Manifest (tous navigateurs
 * modernes, y compris Chrome/Android une fois installée). `navigator.standalone` = attribut
 * **legacy iOS Safari** (avant le support de la media query par WebKit) — toujours vérifié en
 * repli, jamais réintroduit d'un des deux seul (couvre Chrome/Android ET iOS Safari installés).
 */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const mediaStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const iosLegacyStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosLegacyStandalone;
}

/**
 * iOS Safari (iPhone/iPad/iPod) — seule famille de navigateurs SANS API
 * `beforeinstallprompt` (WebKit ne l'implémente pas, cf. AC2). Exclut les navigateurs
 * tiers sur iOS (Chrome=`CriOS`, Firefox=`FxiOS`, Edge=`EdgiOS`, Opera=`OPiOS`) : ce sont
 * du WebKit sous le capot mais leur chemin d'installation ne passe pas par le menu
 * « Partager » de Safari — hors scope du hint « Partager → écran d'accueil » (AC2
 * nomme littéralement "iOS Safari", pas "iOS"). Détecte aussi iPadOS 13+, qui se
 * présente en `Macintosh` (mode desktop par défaut) via `maxTouchPoints > 1`
 * (un vrai Mac n'a pas de points de contact tactiles).
 */
export function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/u.test(ua);
  const isIPadOSDesktopUA = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
  const isThirdPartyIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/u.test(ua);
  const isSafariEngine = /Safari/u.test(ua) && !isThirdPartyIOSBrowser;
  return (isIOSDevice || isIPadOSDesktopUA) && isSafariEngine;
}

/** Lit l'état de rejet persisté (AC1 : ne réapparaît pas en boucle). */
export function readInstallPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "1";
  } catch {
    // Stockage indisponible (mode privé strict / quota) — dégradation douce : l'invite peut
    // réapparaître à la prochaine visite plutôt que de planter l'app (cf. PWA online-first,
    // dégradation douce déjà en place pour l'enregistrement du SW).
    return false;
  }
}

/** Persiste le rejet (AC1). Silencieux si `localStorage` indisponible (même dégradation douce). */
export function persistInstallPromptDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "1");
  } catch {
    /* dégradation douce — cf. readInstallPromptDismissed */
  }
}

/**
 * État discriminé (plutôt que 2-3 `useState` séparés) : évite un `deferredEvent`
 * nullable décorrélé du variant affiché, qui forcerait une garde de nullité jamais
 * réellement atteignable au runtime (`variant==="chrome"` et `deferredEvent` sont
 * TOUJOURS posés ensemble) — un tel prédicat serait redondant/non testable (CLAUDE.md,
 * rétro #143 « correct ≠ testable ≠ nécessaire »). Ici le type élimine la garde : accéder
 * à `state.event` n'est possible QUE quand `state.kind === "chrome"`.
 */
type PromptState =
  | { kind: "hidden" }
  | { kind: "ios" }
  | { kind: "chrome"; event: BeforeInstallPromptEvent; installing: boolean };

const HIDDEN_STATE: PromptState = { kind: "hidden" };

// Glyphe décoratif (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const DISMISS_GLYPH = "×"; // ×

/**
 * Enveloppe EN FLUX (aucune `position`) : premier bloc de `<body>`, sa hauteur POUSSE
 * `{children}` vers le bas → réserve un espace réel, jamais un overlay (rétro #170/#190, PO
 * round 2). Centre la carte horizontalement ; padding tokenisé (jamais de valeur en dur).
 */
const bannerContainerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  width: "100%",
  boxSizing: "border-box",
  padding: "var(--space-5) var(--space-4) 0",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-lg)",
  boxShadow: "var(--shadow-md)",
  padding: "var(--space-4) var(--space-5)",
  // Bornée par la largeur du conteneur padé (100%) → jamais de débordement à 375px, tout en
  // restant lisible sur desktop (--max-width-play).
  maxWidth: "min(var(--max-width-play), 100%)",
  width: "max-content",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "var(--space-3)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-primary)",
  lineHeight: "var(--line-height-normal)",
};

const actionsRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const dismissButtonStyle: CSSProperties = {
  minWidth: "var(--tap-target-min)",
  minHeight: "var(--tap-target-min)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background: "transparent",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  color: "var(--color-text-secondary)",
  fontSize: "var(--font-size-lg)",
  lineHeight: 1,
  cursor: "pointer",
};

function installButtonStyle(disabled: boolean): CSSProperties {
  return {
    minHeight: "var(--tap-target-min)",
    padding: "var(--space-2) var(--space-5)",
    borderRadius: "var(--border-radius-full)",
    border: "none",
    backgroundColor: "var(--color-accent-primary)",
    color: "var(--color-text-inverse)",
    fontFamily: "var(--font-family-body)",
    fontSize: "var(--font-size-sm)",
    fontWeight: "var(--font-weight-semibold)",
    // Désactivé (#226/#260) : jamais d'opacity sur un sous-arbre avec du texte — le
    // signal vient de `cursor` + `aria-disabled`, le texte reste plein-alpha.
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

export interface InstallPromptProps {
  /**
   * Le foyer existe-t-il ? (lu côté serveur dans `layout.tsx`, source de vérité). Tranche
   * l'ambiguïté de `/` (onboarding premier-run si `false` vs sélecteur/retour quotidien si
   * `true`) — cf. `shouldShowInstallPromptOnSurface`.
   */
  householdExists: boolean;
}

export function InstallPrompt({ householdExists }: InstallPromptProps) {
  const pathname = usePathname();
  const [state, setState] = useState<PromptState>(HIDDEN_STATE);

  useEffect(() => {
    let cancelled = false;
    let removeListeners: (() => void) | null = null;

    // Différé en microtâche (react-hooks/set-state-in-effect — même pattern que
    // `PlayScreen`/`MapScreen`, LEARNINGS) : la décision part toujours au montage, un
    // microtask plus tard — casse la chaîne d'appel synchrone vue par le lint sans changer
    // le comportement réel (encore avant le 1er paint utilisateur).
    void Promise.resolve().then(() => {
      if (cancelled) return;

      // AC3 : jamais d'invite si déjà installée (standalone).
      if (isStandaloneDisplayMode()) return;
      // AC1 : rejet persisté — ni notre UI ni un nouveau flux ne redémarrent.
      if (readInstallPromptDismissed()) return;

      // AC2 : hint iOS immédiat — WebKit n'a pas d'événement `beforeinstallprompt` à attendre.
      if (isIOSSafari()) {
        setState({ kind: "ios" });
        return;
      }

      function onBeforeInstallPrompt(event: Event) {
        if (!isBeforeInstallPromptEvent(event)) return;
        // Supprime la mini-infobar par défaut du navigateur — l'app affiche SA propre invite.
        event.preventDefault();
        setState({ kind: "chrome", event, installing: false });
      }

      function onAppInstalled() {
        // Installée : persiste (le standalone check prendra de toute façon le relais au
        // prochain lancement, mais idempotent — dégradation douce si détection tardive).
        persistInstallPromptDismissed();
        setState(HIDDEN_STATE);
      }

      window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.addEventListener("appinstalled", onAppInstalled);
      removeListeners = () => {
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.removeEventListener("appinstalled", onAppInstalled);
      };
    });

    return () => {
      cancelled = true;
      removeListeners?.();
    };
  }, []);

  const handleDismiss = useCallback(() => {
    persistInstallPromptDismissed();
    setState(HIDDEN_STATE);
  }, []);

  /**
   * Prend l'événement en PARAMÈTRE (fourni par l'appelant, cf. JSX ci-dessous) plutôt que de
   * relire `state` en interne : le bouton n'est rendu QUE sous `state.kind === "chrome"`, donc
   * un ré-aiguillage interne sur `state.kind` serait une garde jamais atteignable au runtime
   * (même piège que le nullable `deferredEvent` documenté sur `PromptState` ci-dessus).
   */
  const handleInstall = useCallback((event: BeforeInstallPromptEvent) => {
    setState({ kind: "chrome", event, installing: true });
    void event
      .prompt()
      .then(() => event.userChoice)
      .finally(() => {
        // Accepté OU refusé au dialogue natif : notre invite a fait son office — ne pas
        // ranager (AC1 « ne réapparaît pas en boucle »). Si accepté, `isStandaloneDisplayMode`
        // prendra le relais au prochain lancement de toute façon (persistance idempotente).
        persistInstallPromptDismissed();
        setState(HIDDEN_STATE);
      });
  }, []);

  // Rendu gaté (AC1 « discrète ») : l'événement/le hint peut être capturé sur n'importe quelle
  // route, mais l'invite ne s'affiche que sur une surface enfant calme (jamais onboarding
  // premier-run / partie active / espace parent). `usePathname` re-rend au changement de route,
  // donc l'invite apparaît/disparaît en navigant (ex. `/jouer` → `/carte`).
  if (state.kind === "hidden") return null;
  if (!shouldShowInstallPromptOnSurface(pathname, householdExists)) return null;

  return (
    <div style={bannerContainerStyle}>
      <div role="region" aria-label={strings.pwa.install.regionLabel} style={cardStyle}>
        <div style={headerRowStyle}>
          <div>
            <p style={titleStyle}>{strings.pwa.install.title}</p>
            <p style={bodyStyle}>
              {state.kind === "ios" ? strings.pwa.install.iosBody : strings.pwa.install.body}
            </p>
          </div>
          <button
            type="button"
            className="mz-focusable"
            onClick={handleDismiss}
            aria-label={strings.pwa.install.dismissAriaLabel}
            style={dismissButtonStyle}
          >
            <span aria-hidden="true">{DISMISS_GLYPH}</span>
          </button>
        </div>
        {state.kind === "chrome" && (
          <div style={actionsRowStyle}>
            <button
              type="button"
              className="mz-focusable"
              onClick={() => handleInstall(state.event)}
              disabled={state.installing}
              aria-disabled={state.installing}
              style={installButtonStyle(state.installing)}
            >
              {strings.pwa.install.installButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
