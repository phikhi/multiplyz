import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSelector } from "./ProfileSelector";
import { loginAction } from "@/app/login/actions";
import { strings } from "@/strings";
import type { PublicProfile } from "@/lib/auth/login";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));

const loginActionMock = vi.mocked(loginAction);

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
