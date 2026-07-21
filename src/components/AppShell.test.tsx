import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { strings } from "@/strings";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const THEMES: Theme[] = ["light", "dark"];

// `LogoutButton` (monté par `AppShell`, 👤) appelle `useRouter()` + `logoutAction` — mêmes mocks
// que `LogoutButton.test.tsx` (patron partagé), pour rendre le VRAI composant ici (preuve du
// câblage, pas un stub) sans dupliquer sa suite dédiée.
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

describe("AppShell — solde pièces/éclats (story R1.1 #337, WIREFRAMES §2)", () => {
  it("rend le chiffre EXACT des soldes (glyphes/chiffres décoratifs, aria-hidden)", () => {
    render(<AppShell coins={120} shards={40} />);
    const coinPill = screen.getByRole("img", { name: "120 pièces" });
    const shardPill = screen.getByRole("img", { name: "40 éclats" });
    expect(coinPill).toHaveAttribute("data-shell-balance-value", "120");
    expect(shardPill).toHaveAttribute("data-shell-balance-value", "40");
    // Chaque enfant (emoji + chiffre) est aria-hidden : l'info complète vit dans le aria-label
    // du conteneur `role="img"` (daltonisme, patron `StarsRow`/`ResultsScreen`).
    for (const child of [...coinPill.children, ...shardPill.children]) {
      expect(child).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("pluriel FR n≤1 → singulier (0 ET 1 « pièce »/« éclat »), n≥2 → pluriel (CLAUDE.md #239)", () => {
    const { rerender } = render(<AppShell coins={0} shards={0} />);
    expect(screen.getByRole("img", { name: "0 pièce" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "0 éclat" })).toBeInTheDocument();

    rerender(<AppShell coins={1} shards={1} />);
    expect(screen.getByRole("img", { name: "1 pièce" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 éclat" })).toBeInTheDocument();

    rerender(<AppShell coins={2} shards={2} />);
    expect(screen.getByRole("img", { name: "2 pièces" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2 éclats" })).toBeInTheDocument();

    rerender(<AppShell coins={120} shards={40} />);
    expect(screen.getByRole("img", { name: "120 pièces" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "40 éclats" })).toBeInTheDocument();
  });

  it.each(THEMES)(
    "%s : chiffre du solde (--color-text-primary) ≥4.5:1 sur le fond du bandeau (--topbar-bg résolu)",
    (theme) => {
      const text = resolveTokenColor(theme, "--color-text-primary");
      const bg = resolveTokenColor(theme, "--topbar-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(THEMES)(
    "%s : chiffre du solde ≥4.5:1 sur le lavis PEINT de la pastille pièces (--topbar-coin-tint composité, jamais le seul token de base)",
    (theme) => {
      // `--color-coin` échoue le contraste sur fond neutre (~1.5:1, rétro #104/#125/#126) — jamais
      // consommé en `color`. Ce test vérifie le fond RÉELLEMENT peint de la pastille (12% de
      // --topbar-coin dilué dans --topbar-bg, cf. tokens.css) contre le texte, pas seulement la
      // paire de tokens de base (4ᵉ axe « résolu ≠ peint », rétro #203).
      const coin = resolveTokenColor(theme, "--topbar-coin");
      const bg = resolveTokenColor(theme, "--topbar-bg");
      const tint = mixSrgb(coin, bg, 0.12); // même formule que --topbar-coin-tint (tokens.css)
      const text = resolveTokenColor(theme, "--color-text-primary");
      expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(THEMES)(
    "%s : chiffre du solde ≥4.5:1 sur le lavis PEINT de la pastille éclats (--topbar-shard-tint composité)",
    (theme) => {
      const shard = resolveTokenColor(theme, "--topbar-shard");
      const bg = resolveTokenColor(theme, "--topbar-bg");
      const tint = mixSrgb(shard, bg, 0.12); // même formule que --topbar-shard-tint (tokens.css)
      const text = resolveTokenColor(theme, "--color-text-primary");
      expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("AppShell — ⚙️ réglages (résolution de l'ambiguïté WIREFRAMES §2)", () => {
  it("lien nu vers le point d'entrée PIN-gaté EXISTANT (`/`, ProfileSelector « 🔒 Parent »), jamais une nouvelle route", () => {
    render(<AppShell coins={0} shards={0} />);
    const link = screen.getByRole("link", { name: strings.shell.settingsLabel });
    expect(link).toHaveAttribute("href", "/");
    expect(link.style.minHeight).toBe("var(--tap-target-min)"); // a11y : cible ≥44px
    expect(link.style.minWidth).toBe("var(--tap-target-min)");
  });

  it("ICÔNE SEULE — aucun libellé visible (nom accessible porté par aria-label uniquement)", () => {
    // Garde à effet observable de la régression réelle rencontrée (story R1.1 #337) : un libellé
    // visible ici fait passer le bandeau à la ligne à 375px (147px de haut mesuré au lieu des
    // 60px déclarés par `--app-shell-height`), ce qui rogne la marge sous la barre d'action fixe
    // de `PlayScreen` (story 8.1 #254). Rougit si un futur ajout réintroduit du texte visible.
    render(<AppShell coins={0} shards={0} />);
    const link = screen.getByRole("link", { name: strings.shell.settingsLabel });
    expect(link.textContent).toBe("⚙️");
  });
});

describe("AppShell — 👤 profil (consolidation des LogoutButton dupliqués, story R1.1 #337)", () => {
  it("monte le VRAI LogoutButton en mode compact (déconnexion + retour au sélecteur)", async () => {
    render(<AppShell coins={0} shards={0} />);
    expect(screen.getByRole("button", { name: strings.play.logout })).toBeInTheDocument();
  });

  it("ICÔNE SEULE — aucun libellé visible (même garde anti-wrap que ⚙️ ci-dessus)", () => {
    render(<AppShell coins={0} shards={0} />);
    const button = screen.getByRole("button", { name: strings.play.logout });
    expect(button.textContent).toBe("👤");
  });
});

describe("AppShell — non-occlusion STRUCTURELLE (CLAUDE.md, extension #170/#190/#278)", () => {
  it("le bandeau est EN FLUX — aucun `position` posé (jamais fixed/absolute/sticky)", () => {
    render(<AppShell coins={0} shards={0} />);
    const header = document.querySelector<HTMLElement>("[data-app-shell]");
    expect(header).not.toBeNull();
    // `position` non posé en style inline → valeur par défaut du navigateur = "" (jsdom), jamais
    // "fixed"/"absolute"/"sticky". Rougit si une future édition ajoute un `position` au bandeau.
    expect(header!.style.position).toBe("");
  });

  it("réserve une hauteur RÉELLE (`--app-shell-height`, jamais 0/absent) — condition de la non-occlusion structurelle", () => {
    render(<AppShell coins={0} shards={0} />);
    const header = document.querySelector<HTMLElement>("[data-app-shell]");
    expect(header!.style.minHeight).toBe("var(--app-shell-height)");
  });
});
