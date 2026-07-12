"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { strings } from "@/strings";
import { INSTALL_PROMPT_DISMISSED_KEY } from "@/config/pwa";

/**
 * Invite d'installation PWA (story 8.5, #258 — cf. PLAN.md §Vérification "installable").
 * Le manifest (`src/app/manifest.ts`), le service worker (`public/sw.js`) et son
 * enregistrement (`ServiceWorkerRegistration`) existent déjà (épic 8, story 8.1) — CE
 * composant complète la couche **UX d'installation** : invite Chrome/Android
 * (`beforeinstallprompt`), hint manuel iOS Safari, jamais si déjà installée.
 *
 * **Élément superposé/positionné** (`position:fixed`, AC #170) — voir garde de
 * non-occlusion E2E (`e2e/pwa.spec.ts`, `boundingClientRect`) + captures Playwright
 * pixel-lookées (état affiché + état rejeté). Positionné en HAUT du viewport
 * (`OfflineBanner` occupe déjà le bas ET `ActionBar` passe en `position:fixed` bas sur
 * téléphone pendant le jeu, cf. `ActionBar.tsx`) — zone haute libre, aucun frère fixe
 * connu à cette position (grep effectué avant de coder, story-start).
 *
 * Registre : voix de Teddy, tutoiement (invite montée dans l'aire ENFANT via le layout
 * global — cf. COPY §1/§5, la zone parent a son propre registre neutre ailleurs).
 */

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

const bannerStyle: CSSProperties = {
  position: "fixed",
  top: "var(--space-5)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-lg)",
  boxShadow: "var(--shadow-md)",
  padding: "var(--space-4) var(--space-5)",
  maxWidth: "min(var(--max-width-play), calc(100vw - var(--space-8)))",
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

export function InstallPrompt() {
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

  if (state.kind === "hidden") return null;

  return (
    <div role="region" aria-label={strings.pwa.install.regionLabel} style={bannerStyle}>
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
  );
}
