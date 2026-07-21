import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentChildSession } from "@/lib/auth/current-session";
import { getDb } from "@/lib/db";
import { loadWallet } from "@/lib/game/wallet";
import AppLayout from "./layout";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentChildSession: vi.fn() }));
// `getDb`/`loadWallet` mockés (patron `jouer/page.test.tsx`) : cette route ne fait que
// lire le solde SERVEUR et le projeter à `AppShell` (story R1.1 #337) — la logique de
// portefeuille elle-même est testée isolément dans `wallet.test.ts`.
const FAKE_DB = { __fakeDb: true };
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/lib/game/wallet", () => ({ loadWallet: vi.fn() }));
vi.mock("@/components/AppShell", () => ({
  AppShell: (props: { coins: number; shards: number }) => (
    <div data-testid="app-shell-stub" data-coins={props.coins} data-shards={props.shards} />
  ),
}));

const redirectMock = vi.mocked(redirect);
const getSessionMock = vi.mocked(getCurrentChildSession);
const getDbMock = vi.mocked(getDb);
const loadWalletMock = vi.mocked(loadWallet);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppLayout — garde de route", () => {
  it("session valide → rend les enfants (pas de redirection)", async () => {
    getSessionMock.mockResolvedValue({
      token: "tok",
      profileId: 1,
      kind: "child",
      expiresAt: new Date(),
    });
    loadWalletMock.mockReturnValue({ coins: 0, shards: 0 });
    const ui = await AppLayout({ children: <div data-testid="protected" /> });
    render(ui);
    expect(screen.getByTestId("protected")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sans session → redirige vers le sélecteur (/)", async () => {
    getSessionMock.mockResolvedValue(null);
    await AppLayout({ children: <div data-testid="protected" /> });
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("sans session → ne lit JAMAIS le portefeuille (aucune fuite avant la garde)", async () => {
    getSessionMock.mockResolvedValue(null);
    await AppLayout({ children: <div /> });
    expect(loadWalletMock).not.toHaveBeenCalled();
  });
});

describe("AppLayout — shell persistant (story R1.1 #337, WIREFRAMES §2)", () => {
  it("monte AppShell AVANT les enfants (premier EN FLUX, non-occlusion structurelle)", async () => {
    getSessionMock.mockResolvedValue({
      token: "tok",
      profileId: 7,
      kind: "child",
      expiresAt: new Date(),
    });
    loadWalletMock.mockReturnValue({ coins: 120, shards: 40 });
    const ui = await AppLayout({ children: <div data-testid="protected" /> });
    render(ui);
    const shell = screen.getByTestId("app-shell-stub");
    const protectedNode = screen.getByTestId("protected");
    // `compareDocumentPosition` : le shell précède le contenu enfant dans le DOM (flux).
    expect(
      shell.compareDocumentPosition(protectedNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lit le solde du profil de la session COURANTE (`session.profileId`, jamais un autre)", async () => {
    getSessionMock.mockResolvedValue({
      token: "tok",
      profileId: 42,
      kind: "child",
      expiresAt: new Date(),
    });
    loadWalletMock.mockReturnValue({ coins: 5, shards: 2 });
    const ui = await AppLayout({ children: <div /> });
    render(ui);
    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(loadWalletMock).toHaveBeenCalledWith(FAKE_DB, 42);
  });

  it("projette le solde EXACT (coins/shards) vers AppShell, y compris à 0 (état initial)", async () => {
    getSessionMock.mockResolvedValue({
      token: "tok",
      profileId: 1,
      kind: "child",
      expiresAt: new Date(),
    });
    loadWalletMock.mockReturnValue({ coins: 0, shards: 0 });
    const ui = await AppLayout({ children: <div /> });
    render(ui);
    const shell = screen.getByTestId("app-shell-stub");
    expect(shell.getAttribute("data-coins")).toBe("0");
    expect(shell.getAttribute("data-shards")).toBe("0");
  });
});
