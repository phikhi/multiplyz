import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildSession } from "@/lib/auth/current-session";
import type { ActiveSession } from "@/lib/auth/session";
import { getCurrentChildProfileId } from "./current-profile";

// Glue mince au-dessus de `getCurrentChildSession` (filtre `kind` testé isolément).
vi.mock("@/lib/auth/current-session", () => ({ getCurrentChildSession: vi.fn() }));

const sessionMock = vi.mocked(getCurrentChildSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentChildProfileId", () => {
  it("renvoie le profileId de la session enfant valide", async () => {
    const session: ActiveSession = {
      token: "t",
      profileId: 42,
      kind: "child",
      expiresAt: new Date(),
    };
    sessionMock.mockResolvedValue(session);
    await expect(getCurrentChildProfileId()).resolves.toBe(42);
  });

  it("renvoie null quand aucune session enfant valide", async () => {
    sessionMock.mockResolvedValue(null);
    await expect(getCurrentChildProfileId()).resolves.toBeNull();
  });
});
