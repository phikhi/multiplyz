import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSelector } from "./ProfileSelector";
import { loginAction } from "@/app/login/actions";
import { loginParentAction } from "@/app/parent/actions";
import { strings } from "@/strings";
import { BRAND_NAME } from "@/config/brand";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import type { PublicProfile } from "@/lib/auth/login";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));
vi.mock("@/app/parent/actions", () => ({ loginParentAction: vi.fn() }));

const loginActionMock = vi.mocked(loginAction);
const loginParentActionMock = vi.mocked(loginParentAction);

// Tom a un avatar hors catalogue → exerce le repli `avatarEmoji` (?? "").
const PROFILES: PublicProfile[] = [
  { id: 1, name: "Léa", avatar: "fox" },
  { id: 2, name: "Tom", avatar: "avatar-inconnu" },
];

const profileLabel = (name: string) => strings.login.profileOption.replace("{prénom}", name);
const pinTitle = (name: string) => strings.login.pinTitle.replace("{prénom}", name);

function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileSelector — sélection + connexion", () => {
  it("affiche les profils servis (prénoms) puis le pavé PIN au choix", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.login.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tom")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: profileLabel("Léa") }));
    expect(screen.getByRole("heading", { level: 1, name: pinTitle("Léa") })).toBeInTheDocument();
  });

  it("PIN complet + succès → session posée, redirection vers le jeu", async () => {
    loginActionMock.mockResolvedValue({ ok: true });
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: profileLabel("Léa") }));
    pressDigits("1234");

    await waitFor(() => expect(loginActionMock).toHaveBeenCalledWith(1, "1234"));
    expect(push).toHaveBeenCalledWith("/jouer");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("PIN faux → message générique no-shame + pavé réinitialisé, pas de redirection", async () => {
    loginActionMock.mockResolvedValue({ ok: false });
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: profileLabel("Léa") }));
    pressDigits("0000");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(strings.login.error));
    expect(push).not.toHaveBeenCalled();
    // Pavé réinitialisé : les 4 pastilles sont « à saisir ».
    expect(screen.getAllByRole("img", { name: /à saisir/ }).length).toBe(4);
  });

  it("erreur réseau (action rejette) → même message générique", async () => {
    loginActionMock.mockRejectedValue(new Error("réseau"));
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: profileLabel("Léa") }));
    pressDigits("1234");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(strings.login.error));
    expect(push).not.toHaveBeenCalled();
  });

  it("« choisir un autre profil » revient à la liste", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    fireEvent.click(screen.getByRole("button", { name: profileLabel("Léa") }));
    fireEvent.click(screen.getByRole("button", { name: strings.login.back }));
    expect(
      screen.getByRole("heading", { level: 1, name: strings.login.title }),
    ).toBeInTheDocument();
  });
});

describe("ProfileSelector — en-tête de marque + entrée espace parent (story 7.1)", () => {
  it("affiche l'en-tête de marque « multiplyz 🧸 » au-dessus de « Qui joue aujourd'hui ? »", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    // Le wordmark de marque est rendu (BRAND_NAME) + le titre h1 du sélecteur.
    expect(screen.getByText(BRAND_NAME)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: strings.login.title }),
    ).toBeInTheDocument();
  });

  it("l'entrée « 🔒 Parent » (nom accessible neutre) ouvre le pavé PIN parent", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    // Vue pavé PIN parent : titre neutre + consigne (vouvoiement).
    expect(
      screen.getByRole("heading", { level: 1, name: strings.parent.pinTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.parent.pinHint)).toBeInTheDocument();
    // Le pavé enfant n'est PAS présent (pas de profil sélectionné).
    expect(screen.queryByText(BRAND_NAME)).not.toBeInTheDocument();
  });

  it("PIN parent complet + succès → session parent + redirection vers /parent", async () => {
    loginParentActionMock.mockResolvedValue({ ok: true });
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    pressDigits("9876");

    await waitFor(() => expect(loginParentActionMock).toHaveBeenCalledWith("9876"));
    expect(push).toHaveBeenCalledWith("/parent");
    expect(refresh).toHaveBeenCalledOnce();
    // Ne redirige JAMAIS vers le jeu enfant depuis le flux parent (séparation).
    expect(push).not.toHaveBeenCalledWith("/jouer");
  });

  it("PIN parent faux → message générique neutre + pavé réinitialisé, pas de redirection", async () => {
    loginParentActionMock.mockResolvedValue({ ok: false });
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    pressDigits("0000");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(strings.parent.error));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("img", { name: /à saisir/ }).length).toBe(4);
  });

  it("erreur réseau (action parent rejette) → même message générique neutre", async () => {
    loginParentActionMock.mockRejectedValue(new Error("réseau"));
    render(<ProfileSelector profiles={PROFILES} />);

    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    pressDigits("9876");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(strings.parent.error));
    expect(push).not.toHaveBeenCalled();
  });

  it("« code parent oublié » mène à la récupération (/parent/recuperation)", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    fireEvent.click(screen.getByRole("button", { name: strings.parent.forgot }));
    expect(push).toHaveBeenCalledWith("/parent/recuperation");
  });

  it("« Retour » depuis le pavé parent revient au sélecteur (en-tête de marque)", () => {
    render(<ProfileSelector profiles={PROFILES} />);
    fireEvent.click(screen.getByRole("button", { name: strings.parent.entryLabel }));
    fireEvent.click(screen.getByRole("button", { name: strings.parent.back }));
    expect(
      screen.getByRole("heading", { level: 1, name: strings.login.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(BRAND_NAME)).toBeInTheDocument();
  });
});

// Contraste WCAG **résolu** (tokens.css, `var()` résolus) des glyphes/texte rendus par la
// story 7.1 — pas seulement le NOM du token (rétro #104/#126). Deux glyphes distincts sur le
// même fond `--card-bg` = deux tests, en light ET dark (le fond DOM réellement empilé = la
// carte). L'occlusion/visibilité pixel est couverte par l'E2E (jsdom ne fait pas de layout).
describe("ProfileSelector — contraste WCAG résolu (story 7.1)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it.each(THEMES)(
    "en-tête de marque « multiplyz » : color-text-primary ≥ 4.5:1 sur card-bg (%s)",
    (theme) => {
      const text = resolveTokenColor(theme, "color-text-primary");
      const bg = resolveTokenColor(theme, "card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(THEMES)(
    "entrée « 🔒 Parent » : color-text-secondary ≥ 4.5:1 sur card-bg (%s)",
    (theme) => {
      const text = resolveTokenColor(theme, "color-text-secondary");
      const bg = resolveTokenColor(theme, "card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Bannière d'erreur (`errorStyle`) réutilisée pour `strings.parent.error` sur ce sélecteur
  // retouché (⚠️ + texte). Le token de texte de statut `--color-on-warning` est CONSTANT (ne
  // s'inverse jamais par thème, a11y CLAUDE.md) → contraste résolu ≥ 4.5:1 sur le fond
  // `--color-status-warning` en light ET dark (rétro #126 : auditer tout glyphe rendu).
  it.each(THEMES)(
    "bannière d'erreur : color-on-warning ≥ 4.5:1 sur color-status-warning (%s)",
    (theme) => {
      const text = resolveTokenColor(theme, "color-on-warning");
      const bg = resolveTokenColor(theme, "color-status-warning");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
