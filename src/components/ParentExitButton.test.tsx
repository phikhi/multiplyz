import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentExitButton } from "./ParentExitButton";
import { logoutParentAction } from "@/app/parent/actions";
import { strings } from "@/strings";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/parent/actions", () => ({ logoutParentAction: vi.fn() }));

const logoutParentActionMock = vi.mocked(logoutParentAction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParentExitButton", () => {
  it("clic → révoque la session parent (action) puis retourne au sélecteur", async () => {
    logoutParentActionMock.mockResolvedValue();
    render(<ParentExitButton />);

    fireEvent.click(screen.getByRole("button", { name: strings.parent.dashboard.exit }));

    await waitFor(() => expect(logoutParentActionMock).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
