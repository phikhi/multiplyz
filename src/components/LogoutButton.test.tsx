import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "./LogoutButton";
import { logoutAction } from "@/app/login/actions";
import { strings } from "@/strings";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

const logoutActionMock = vi.mocked(logoutAction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogoutButton", () => {
  it("déconnecte puis renvoie au sélecteur de profil", async () => {
    logoutActionMock.mockResolvedValue();
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: strings.play.logout }));

    await waitFor(() => expect(logoutActionMock).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
