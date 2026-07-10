import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { revalidatePath } from "next/cache";
import { writeHouseholdSettings, SettingsValidationError } from "@/lib/parent/settings";
import { saveSettingsAction } from "./actions";

// Adaptateur mince : on pilote la garde (session parent) + la couche métier (mockée), et on vérifie
// le mapping vers un résultat générique. Le vrai `db` n'est jamais touché (getDb mocké).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({ __fakeDb: true })) }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));
vi.mock("@/lib/parent/settings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/parent/settings")>();
  return {
    ...actual, // garde la vraie classe SettingsValidationError (mapping d'erreur)
    writeHouseholdSettings: vi.fn(),
  };
});

const sessionMock = vi.mocked(getCurrentParentSession);
const writeMock = vi.mocked(writeHouseholdSettings);
const revalidateMock = vi.mocked(revalidatePath);

function withParentSession() {
  sessionMock.mockResolvedValue({
    token: "tok",
    profileId: 1,
    kind: "parent",
    expiresAt: new Date(Date.now() + 60_000),
  });
}
function withoutParentSession() {
  sessionMock.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveSettingsAction", () => {
  it("session parent → délègue à writeHouseholdSettings + revalide, { ok: true }", async () => {
    withParentSession();
    await expect(saveSettingsAction({ theme: "dark" })).resolves.toEqual({ ok: true });
    expect(writeMock).toHaveBeenCalledWith({ __fakeDb: true }, { theme: "dark" });
    expect(revalidateMock).toHaveBeenCalledWith("/parent/reglages");
  });

  it("erreur de validation (thème invalide) → { ok: false, code } (pas de revalidation)", async () => {
    withParentSession();
    writeMock.mockImplementation(() => {
      throw new SettingsValidationError("THEME_INVALID");
    });
    await expect(saveSettingsAction({ theme: "x" as unknown as "dark" })).resolves.toEqual({
      ok: false,
      code: "THEME_INVALID",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, writeHouseholdSettings JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(saveSettingsAction({ theme: "dark" })).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    // Mutation-preuve de la garde : retirer le `if (!hasParentSession)` → writeHouseholdSettings appelé.
    expect(writeMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("erreur inattendue (bug réel) → re-levée", async () => {
    withParentSession();
    writeMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(saveSettingsAction({ theme: "dark" })).rejects.toThrow("boom");
  });
});
