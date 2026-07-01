import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentChildSession } from "@/lib/auth/current-session";
import AppLayout from "./layout";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentChildSession: vi.fn() }));

const redirectMock = vi.mocked(redirect);
const getSessionMock = vi.mocked(getCurrentChildSession);

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
});
