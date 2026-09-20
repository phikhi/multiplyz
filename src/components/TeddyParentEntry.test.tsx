import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSelector } from "./ProfileSelector";
import { parent as p } from "@/strings/parent";
import { loginParentAction } from "@/app/parent/actions";
import { loginAction } from "@/app/login/actions";
import { strings } from "@/strings";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/parent/actions", () => ({ loginParentAction: vi.fn() }));
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));
describe("TEDDy guarded parent entry", () => {
  it("explains the parent-only gate and sends PIN only to the parent verifier", async () => {
    vi.mocked(loginParentAction).mockResolvedValue({ ok: false });
    render(<ProfileSelector profiles={[{ id: 1, name: "Nova", avatar: "cat" }]} startParent />);
    expect(screen.getByText(p.required)).toBeInTheDocument();
    for (const key of "7171") fireEvent.keyDown(window, { key });
    await waitFor(() => expect(loginParentAction).toHaveBeenCalledWith("7171"));
    expect(loginAction).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.parent.error);
  });
});
