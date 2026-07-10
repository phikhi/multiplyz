import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { revalidatePath } from "next/cache";
import { listManagedProfiles } from "@/lib/parent/profiles";
import { approveWorld, rejectWorld, WorldModerationError } from "@/lib/worldgen/worker";
import { approveWorldAction, rejectWorldAction } from "./actions";

// Adaptateurs minces : on pilote la garde (session parent) + la couche métier (mockée), et on
// vérifie le mapping vers un résultat générique. Le vrai `db` n'est jamais touché (getDb mocké).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({ __fakeDb: true })) }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));
vi.mock("@/lib/parent/profiles", () => ({ listManagedProfiles: vi.fn() }));
vi.mock("@/lib/worldgen/worker", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/worldgen/worker")>();
  return {
    ...actual, // garde la vraie classe WorldModerationError (mapping d'erreur)
    approveWorld: vi.fn(),
    rejectWorld: vi.fn(),
  };
});

const sessionMock = vi.mocked(getCurrentParentSession);
const profilesMock = vi.mocked(listManagedProfiles);
const approveMock = vi.mocked(approveWorld);
const rejectMock = vi.mocked(rejectWorld);
const revalidateMock = vi.mocked(revalidatePath);

/** Simule une session parent valide (source de vérité serveur) — profil propriétaire « Léa ». */
function withParentSession() {
  sessionMock.mockResolvedValue({
    token: "tok",
    profileId: 1,
    kind: "parent",
    expiresAt: new Date(Date.now() + 60_000),
  });
  profilesMock.mockReturnValue([{ id: 1, name: "Léa", avatar: "fox", isOwner: true }]);
}

/** Simule l'absence de session parent (aucune session, OU une session enfant filtrée en `null`). */
function withoutParentSession() {
  sessionMock.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveWorldAction", () => {
  it("session parent → délègue à approveWorld avec l'identité du profil de session + revalide", async () => {
    withParentSession();
    await expect(approveWorldAction("world:5")).resolves.toEqual({ ok: true });
    expect(approveMock).toHaveBeenCalledWith({ __fakeDb: true }, "world:5", "Léa");
    expect(revalidateMock).toHaveBeenCalledWith("/parent/mondes");
  });

  it("WorldModerationError (monde déjà traité — course multi-onglet) → MODERATION_FAILED, pas de revalidation", async () => {
    withParentSession();
    approveMock.mockImplementation(() => {
      throw new WorldModerationError("déjà traité");
    });
    await expect(approveWorldAction("world:5")).resolves.toEqual({
      ok: false,
      code: "MODERATION_FAILED",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, approveWorld JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(approveWorldAction("world:5")).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(approveMock).not.toHaveBeenCalled(); // mutation-preuve : un enfant n'approuve jamais
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("garde de forme : profil de session absent de listManagedProfiles → UNAUTHORIZED (jamais un plantage)", async () => {
    sessionMock.mockResolvedValue({
      token: "tok",
      profileId: 1,
      kind: "parent",
      expiresAt: new Date(Date.now() + 60_000),
    });
    profilesMock.mockReturnValue([]); // course rarissime — profil introuvable (cf. JSDoc `currentParentName`)
    await expect(approveWorldAction("world:5")).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("erreur inattendue (bug réel) → re-levée", async () => {
    withParentSession();
    approveMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(approveWorldAction("world:5")).rejects.toThrow("boom");
  });
});

describe("rejectWorldAction", () => {
  it("session parent → délègue à rejectWorld + revalide, { ok: true }", async () => {
    withParentSession();
    await expect(rejectWorldAction("world:6")).resolves.toEqual({ ok: true });
    expect(rejectMock).toHaveBeenCalledWith({ __fakeDb: true }, "world:6");
    expect(revalidateMock).toHaveBeenCalledWith("/parent/mondes");
  });

  it("WorldModerationError (monde déjà traité) → MODERATION_FAILED, pas de revalidation", async () => {
    withParentSession();
    rejectMock.mockImplementation(() => {
      throw new WorldModerationError("déjà traité");
    });
    await expect(rejectWorldAction("world:6")).resolves.toEqual({
      ok: false,
      code: "MODERATION_FAILED",
    });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("SÉCU : sans session parent → UNAUTHORIZED, rejectWorld JAMAIS appelé", async () => {
    withoutParentSession();
    await expect(rejectWorldAction("world:6")).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(rejectMock).not.toHaveBeenCalled(); // mutation-preuve : un enfant ne rejette jamais
  });

  it("erreur inattendue (bug réel) → re-levée", async () => {
    withParentSession();
    rejectMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(rejectWorldAction("world:6")).rejects.toThrow("boom");
  });
});
