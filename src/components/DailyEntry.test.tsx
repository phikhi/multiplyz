import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PinPad } from "./PinPad";
import { ProfileSelector } from "./ProfileSelector";
import { OnboardingFlow } from "@/app/onboarding/OnboardingFlow";
import { loginAction } from "@/app/login/actions";
import { createHouseholdAction } from "@/app/onboarding/actions";
import { daily } from "@/strings/daily";
import { strings } from "@/strings";
const m = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m }));
vi.mock("@/app/login/actions", () => ({ loginAction: vi.fn() }));
vi.mock("@/app/parent/actions", () => ({ loginParentAction: vi.fn() }));
vi.mock("@/app/onboarding/actions", () => ({ createHouseholdAction: vi.fn() }));
const profile = { id: 2, name: "Nova", avatar: "cat" };
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);
const type = (digits: string) => {
  for (const key of digits) fireEvent.keyDown(window, { key });
};
it("accepts keyboard digits and backspace, masks them and never stores a code", () => {
  function Harness() {
    const [value, set] = useState("");
    return <PinPad value={value} onChange={set} label="Test" />;
  }
  render(<Harness />);
  type("12");
  fireEvent.keyDown(window, { key: "Backspace" });
  type("3456");
  expect(screen.getByRole("img", { name: "Chiffre 4 saisi" })).toBeVisible();
  expect(localStorage.length).toBe(0);
});
it("does not intercept another field or accept input while disabled", () => {
  const change = vi.fn();
  const { rerender } = render(
    <>
      <input aria-label="Nom" />
      <PinPad value="" onChange={change} label="Test" />
    </>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "4" });
  expect(change).not.toHaveBeenCalled();
  rerender(<PinPad value="" onChange={change} label="Test" disabled />);
  type("1");
  fireEvent.click(screen.getByRole("button", { name: "Chiffre 1" }));
  expect(change).not.toHaveBeenCalled();
});
it("shows a return shortcut only for the server-authorized profile", () => {
  const { rerender } = render(<ProfileSelector profiles={[profile]} />);
  expect(screen.queryByRole("link", { name: daily.resume })).toBeNull();
  rerender(<ProfileSelector profiles={[profile]} currentProfile={profile} />);
  expect(screen.getByRole("link", { name: daily.resume })).toHaveAttribute("href", "/reprendre");
});
it("submits one PIN despite rapid extra keys and navigates without cancelling the route", async () => {
  let resolve!: (value: { ok: boolean }) => void;
  vi.mocked(loginAction).mockReturnValue(new Promise((r) => (resolve = r)));
  render(<ProfileSelector profiles={[profile]} />);
  fireEvent.click(screen.getByRole("button", { name: "Jouer avec Nova" }));
  type("71719999");
  expect(loginAction).toHaveBeenCalledTimes(1);
  expect(loginAction).toHaveBeenCalledWith(2, "7171");
  await act(async () => resolve({ ok: true }));
  expect(m.push).toHaveBeenCalledWith("/reprendre");
  expect(m.refresh).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
it("clears a rejected code and keeps the generic message", async () => {
  vi.mocked(loginAction).mockResolvedValue({ ok: false });
  render(<ProfileSelector profiles={[profile]} />);
  fireEvent.click(screen.getByRole("button", { name: "Jouer avec Nova" }));
  type("1111");
  await screen.findByRole("alert");
  expect(screen.getByRole("img", { name: "Chiffre 1 à saisir" })).toBeVisible();
  expect(m.push).not.toHaveBeenCalled();
});
it("confirms both codes and requires the recovery code to be kept before continuing", async () => {
  vi.mocked(createHouseholdAction).mockResolvedValue({ ok: true, recoveryCode: "TESTCODE" });
  render(<OnboardingFlow />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nova" } });
  fireEvent.click(screen.getByRole("button", { name: "Portrait chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  type("7171");
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  type("1111");
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  expect(screen.getByRole("alert")).toHaveTextContent(daily.mismatch);
  expect(createHouseholdAction).not.toHaveBeenCalled();
  type("7171");
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  type("8181");
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  type("8181");
  fireEvent.click(screen.getByRole("button", { name: strings.onboarding.nav.create }));
  await screen.findByText("TESTCODE");
  expect(createHouseholdAction).toHaveBeenCalledWith({
    name: "Nova",
    avatar: "cat",
    childPin: "7171",
    parentPin: "8181",
  });
  const next = screen.getByRole("button", { name: strings.onboarding.recovery.done });
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(next);
  await waitFor(() => expect(screen.queryByText("TESTCODE")).toBeNull());
  expect(localStorage.length).toBe(0);
});
