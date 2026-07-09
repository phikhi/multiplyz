import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import ParentLayout from "./layout";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));

const redirectMock = vi.mocked(redirect);
const getSessionMock = vi.mocked(getCurrentParentSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParentLayout — garde de l'espace parent", () => {
  it("session parent valide → rend les enfants (pas de redirection)", async () => {
    getSessionMock.mockResolvedValue({
      token: "tok",
      profileId: 1,
      kind: "parent",
      expiresAt: new Date(),
    });
    const ui = await ParentLayout({ children: <div data-testid="protected" /> });
    render(ui);
    expect(screen.getByTestId("protected")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // SÉCU (AC3) : sans session parent (null renvoyé par le filtre `kind === "parent"`, y compris
  // pour une session ENFANT), on redirige vers le sélecteur — une session enfant n'ouvre pas /parent.
  it("sans session parent → redirige vers le sélecteur (/)", async () => {
    getSessionMock.mockResolvedValue(null);
    await ParentLayout({ children: <div data-testid="protected" /> });
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
