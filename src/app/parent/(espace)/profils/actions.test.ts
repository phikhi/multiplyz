import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { revalidatePath } from "next/cache";
import {
  deleteProfile,
  renameProfile,
  resetChildPin,
  ProfileManagementError,
} from "@/lib/parent/profiles";
import { deleteProfileAction, renameProfileAction, resetChildPinAction } from "./actions";

// Adaptateurs minces : on pilote la garde (session parent) + la couche métier (mockée), et on
// vérifie le mapping vers un résultat générique. Le vrai `db` n'est jamais touché (getDb mocké).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({ __fakeDb: true })) }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));
vi.mock("@/lib/parent/profiles", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/parent/profiles")>();
  return {
    ...actual, // garde la vraie classe ProfileManagementError (mapping d'erreur)
    renameProfile: vi.fn(),
    resetChildPin: vi.fn(),
    deleteProfile: vi.fn(),
  };
});

const sessionMock = vi.mocked(getCurrentParentSession);
const renameMock = vi.mocked(renameProfile);
const resetMock = vi.mocked(resetChildPin);
const deleteMock = vi.mocked(deleteProfile);
const revalidateMock = vi.mocked(revalidatePath);

/** Simule une session parent valide (source de vérité serveur). */
function withParentSession() {
  sessionMock.mockResolvedValue({
    token: "tok",
    profileId: 1,
    kind: "parent",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

/** Simule l'absence de session parent (aucune session, OU une session enfant filtrée en `null`). */
function withoutParentSession() {
  sessionMock.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renameProfileAction", () => {
  it("session parent → délègue à renameProfile + revalide, { ok: true }", async () => {
    withParentSession();
    await expect(renameProfileAction(5, "Thomas")).resolves.toEqual({ ok: true });
    expect(renameMock).toHaveBeenCalledWith({ __fakeDb: true }, 5, "Thomas");
    expect(revalidateMock).toHaveBeenCalledWith("/parent/profils");
  });

  it("erreur métier NAME_TAKEN → { ok: false, code } (pas de revalidation)", async () => {
    withParentSession();
    renameMock.mockImplementation(() => {
      throw new ProfileManagementError("NAME_TAKEN");
    });
    await expect(renameProfileAction(5, "Léa")).resolves.toEqual({ ok: false, code: "NAME_TAKEN" });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, renameProfile JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(renameProfileAction(5, "Thomas")).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(renameMock).not.toHaveBeenCalled(); // mutation-preuve : garde retirée → renameProfile appelé
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("erreur inattendue (bug réel) → re-levée", async () => {
    withParentSession();
    renameMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(renameProfileAction(5, "Thomas")).rejects.toThrow("boom");
  });
});

describe("resetChildPinAction", () => {
  it("session parent → délègue à resetChildPin, { ok: true }", async () => {
    withParentSession();
    resetMock.mockResolvedValue();
    await expect(resetChildPinAction(5, "5678")).resolves.toEqual({ ok: true });
    expect(resetMock).toHaveBeenCalledWith({ __fakeDb: true }, 5, "5678");
  });

  it("erreur métier PARENT_PIN_SAME → { ok: false, code }", async () => {
    withParentSession();
    resetMock.mockRejectedValue(new ProfileManagementError("PARENT_PIN_SAME"));
    await expect(resetChildPinAction(5, "9876")).resolves.toEqual({
      ok: false,
      code: "PARENT_PIN_SAME",
    });
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, resetChildPin JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(resetChildPinAction(5, "5678")).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(resetMock).not.toHaveBeenCalled(); // mutation-preuve de la garde de séparation
  });

  it("erreur inattendue (bug réel) → re-levée", async () => {
    withParentSession();
    resetMock.mockRejectedValue(new Error("boom"));
    await expect(resetChildPinAction(5, "5678")).rejects.toThrow("boom");
  });
});

describe("deleteProfileAction", () => {
  it("session parent → délègue à deleteProfile + revalide, { ok: true }", async () => {
    withParentSession();
    await expect(deleteProfileAction(5)).resolves.toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledWith({ __fakeDb: true }, 5);
    expect(revalidateMock).toHaveBeenCalledWith("/parent/profils");
  });

  it("erreur métier OWNER_UNDELETABLE → { ok: false, code } (pas de revalidation)", async () => {
    withParentSession();
    deleteMock.mockImplementation(() => {
      throw new ProfileManagementError("OWNER_UNDELETABLE");
    });
    await expect(deleteProfileAction(1)).resolves.toEqual({
      ok: false,
      code: "OWNER_UNDELETABLE",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, deleteProfile JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(deleteProfileAction(5)).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(deleteMock).not.toHaveBeenCalled(); // mutation-preuve : un enfant ne purge jamais
  });
});
