import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { RecoveryError, resetParentPin, verifyRecovery } from "@/lib/auth/recovery";
import { resetParentPinAction, verifyRecoveryCodeAction } from "./actions";

// Adaptateurs minces : on pilote le cœur (recovery, testé isolément), on stubbe
// la DB (non utilisée) et les en-têtes pour vérifier le mapping + l'IP de confiance.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/recovery", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/recovery")>();
  return { ...actual, verifyRecovery: vi.fn(), resetParentPin: vi.fn() };
});

const headersMock = vi.mocked(headers);
const verifyRecoveryMock = vi.mocked(verifyRecovery);
const resetParentPinMock = vi.mocked(resetParentPin);

function stubHeaders(realIp: string | null) {
  headersMock.mockResolvedValue({
    get: (name: string) => (name === "x-real-ip" ? realIp : null),
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubHeaders("203.0.113.7");
});

describe("verifyRecoveryCodeAction", () => {
  it("bon code → { ok: true } ; transmet l'IP de confiance", async () => {
    verifyRecoveryMock.mockResolvedValue(true);
    await expect(verifyRecoveryCodeAction("ABCD2345")).resolves.toEqual({ ok: true });
    expect(verifyRecoveryMock).toHaveBeenCalledWith(
      {},
      "ABCD2345",
      "203.0.113.7",
      expect.any(Date),
    );
  });

  it("code faux/backoff → { ok: false } (générique)", async () => {
    verifyRecoveryMock.mockResolvedValue(false);
    await expect(verifyRecoveryCodeAction("WRONGCOD")).resolves.toEqual({ ok: false });
  });
});

describe("resetParentPinAction", () => {
  it("succès → { ok:true, recoveryCode } (nouveau code à noter)", async () => {
    resetParentPinMock.mockResolvedValue({ recoveryCode: "NEWCODE9" });
    await expect(resetParentPinAction("ABCD2345", "1111")).resolves.toEqual({
      ok: true,
      recoveryCode: "NEWCODE9",
    });
  });

  it("erreur métier → { ok:false, code } (mappable vers strings)", async () => {
    resetParentPinMock.mockRejectedValue(new RecoveryError("PARENT_PIN_SAME"));
    await expect(resetParentPinAction("ABCD2345", "1234")).resolves.toEqual({
      ok: false,
      code: "PARENT_PIN_SAME",
    });
  });

  it("erreur inattendue → propagée (pas avalée)", async () => {
    resetParentPinMock.mockRejectedValue(new Error("db down"));
    await expect(resetParentPinAction("ABCD2345", "1111")).rejects.toThrow("db down");
  });
});
