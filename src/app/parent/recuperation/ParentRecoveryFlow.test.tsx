import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentRecoveryFlow } from "./ParentRecoveryFlow";
import { resetParentPinAction, verifyRecoveryCodeAction } from "./actions";
import { strings } from "@/strings";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({
  verifyRecoveryCodeAction: vi.fn(),
  resetParentPinAction: vi.fn(),
}));

const verifyMock = vi.mocked(verifyRecoveryCodeAction);
const resetMock = vi.mocked(resetParentPinAction);

const CODE = "ABCD2345"; // format valide (alphabet lisible, 8 car.)
const r = strings.recovery;

function enterCode(code: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: code } });
}
function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
  }
}
async function reachNewPinStep() {
  verifyMock.mockResolvedValue({ ok: true });
  enterCode(CODE);
  fireEvent.click(screen.getByRole("button", { name: r.verify }));
  await screen.findByRole("heading", { level: 1, name: r.newPinTitle });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParentRecoveryFlow — étape code", () => {
  it("« Vérifier » désactivé tant que le code n'a pas le bon format", () => {
    render(<ParentRecoveryFlow />);
    const verify = () => screen.getByRole("button", { name: r.verify });
    expect(verify()).toBeDisabled();
    enterCode("ABC"); // trop court
    expect(verify()).toBeDisabled();
    enterCode(CODE);
    expect(verify()).toBeEnabled();
  });

  it("code faux/backoff → message générique, reste sur l'étape code", async () => {
    verifyMock.mockResolvedValue({ ok: false });
    render(<ParentRecoveryFlow />);
    enterCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: r.verify }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(r.errors.CODE_INVALID));
    expect(screen.getByRole("heading", { level: 1, name: r.title })).toBeInTheDocument();
  });

  it("erreur réseau à la vérif → message générique", async () => {
    verifyMock.mockRejectedValue(new Error("net"));
    render(<ParentRecoveryFlow />);
    enterCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: r.verify }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(r.errors.GENERIC));
  });
});

describe("ParentRecoveryFlow — étape nouveau PIN", () => {
  it("« Enregistrer » désactivé tant que le PIN n'a pas 4 chiffres", async () => {
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    expect(screen.getByRole("button", { name: r.submit })).toBeDisabled();
    pressDigits("11");
    expect(screen.getByRole("button", { name: r.submit })).toBeDisabled();
    pressDigits("11");
    expect(screen.getByRole("button", { name: r.submit })).toBeEnabled();
  });

  it("succès → écran final avec le nouveau code de secours ; CTA → accueil", async () => {
    resetMock.mockResolvedValue({ ok: true, recoveryCode: "NEWCODE9" });
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    pressDigits("1111");
    fireEvent.click(screen.getByRole("button", { name: r.submit }));

    await screen.findByRole("heading", { level: 1, name: r.done.title });
    expect(screen.getByText("NEWCODE9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: r.done.cta }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("PIN refusé (= enfant) → erreur, reste sur l'étape PIN", async () => {
    resetMock.mockResolvedValue({ ok: false, code: "PARENT_PIN_SAME" });
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    pressDigits("1234");
    fireEvent.click(screen.getByRole("button", { name: r.submit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(r.errors.PARENT_PIN_SAME),
    );
    expect(screen.getByRole("heading", { level: 1, name: r.newPinTitle })).toBeInTheDocument();
  });

  it("code invalidé entre-temps (rate-limit) → retour à l'étape code", async () => {
    resetMock.mockResolvedValue({ ok: false, code: "CODE_INVALID" });
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    pressDigits("1111");
    fireEvent.click(screen.getByRole("button", { name: r.submit }));

    await screen.findByRole("heading", { level: 1, name: r.title }); // revenu à l'étape code
    expect(screen.getByRole("alert")).toHaveTextContent(r.errors.CODE_INVALID);
  });

  it("erreur réseau au reset → message générique", async () => {
    resetMock.mockRejectedValue(new Error("net"));
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    pressDigits("1111");
    fireEvent.click(screen.getByRole("button", { name: r.submit }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(r.errors.GENERIC));
  });

  it("« Retour » ramène à l'étape code", async () => {
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    fireEvent.click(screen.getByRole("button", { name: r.back }));
    expect(screen.getByRole("heading", { level: 1, name: r.title })).toBeInTheDocument();
  });
});

// STACK-TRAP #222 (rétro 7.1/7.5/7.9) : titre focus-managé (`ref` + `tabIndex={-1}` + `.focus()`
// au montage) → `outline:"none"` documenté, sûr car hors ordre clavier. ROUGIT si l'anneau UA
// natif réapparaît (outline retiré du style) OU si le focus cesse de suivre l'étape.
describe("ParentRecoveryFlow — a11y titre focus-managé (rétro 7.1/7.9 #222)", () => {
  it("le titre reçoit le focus au montage SANS anneau UA (outline:none documenté)", () => {
    render(<ParentRecoveryFlow />);
    const heading = screen.getByRole("heading", { level: 1, name: r.title });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });

  it("le focus suit la transition d'étape (code → nouveau PIN), toujours sans anneau UA", async () => {
    render(<ParentRecoveryFlow />);
    await reachNewPinStep();
    const heading = screen.getByRole("heading", { level: 1, name: r.newPinTitle });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });
});
