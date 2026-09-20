import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentRecoveryFlow } from "./ParentRecoveryFlow";
import { resetParentPinAction, verifyRecoveryCodeAction } from "./actions";
import { parent as p } from "@/strings/parent";
import { strings } from "@/strings";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({ verifyRecoveryCodeAction: vi.fn(), resetParentPinAction: vi.fn() }));
const type = (value: string) => {
  for (const key of value) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", key) }));
  }
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyRecoveryCodeAction).mockResolvedValue({ ok: true });
  vi.mocked(resetParentPinAction).mockResolvedValue({ ok: true, recoveryCode: "TESTCODE" });
});
describe("TEDDy recovery confirmation", () => {
  it("requires a matching second PIN and acknowledgement of the new rescue code", async () => {
    render(<ParentRecoveryFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: strings.recovery.verify }));
    await screen.findByRole("heading", { name: strings.recovery.newPinTitle });
    type("3434");
    fireEvent.click(screen.getByRole("button", { name: p.next }));
    expect(resetParentPinAction).not.toHaveBeenCalled();
    type("3535");
    fireEvent.click(screen.getByRole("button", { name: strings.recovery.submit }));
    await screen.findByText(p.mismatch);
    expect(resetParentPinAction).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "Backspace" });
    type("3434");
    fireEvent.click(screen.getByRole("button", { name: strings.recovery.submit }));
    await screen.findByText("TESTCODE");
    expect(resetParentPinAction).toHaveBeenCalledWith("ABCDEFGH", "3434");
    const done = screen.getByRole("button", { name: strings.recovery.done.cta });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: p.savedRecovery }));
    expect(done).toBeEnabled();
  });
  it("an invalid rescue code stays on the public verification step", async () => {
    vi.mocked(verifyRecoveryCodeAction).mockResolvedValue({ ok: false });
    render(<ParentRecoveryFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: strings.recovery.verify }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(strings.recovery.errors.CODE_INVALID),
    );
    expect(resetParentPinAction).not.toHaveBeenCalled();
  });
});
