import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { loginParent, logoutParent } from "@/lib/auth/current-session";
import { loginParentAction, logoutParentAction } from "./actions";

// Adaptateurs minces : on pilote le cœur (current-session, testé isolément) et on
// vérifie le mapping vers une réponse générique + l'extraction d'IP de confiance.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({
  loginParent: vi.fn(),
  logoutParent: vi.fn(),
}));

const headersMock = vi.mocked(headers);
const loginParentMock = vi.mocked(loginParent);
const logoutParentMock = vi.mocked(logoutParent);

/** Stub d'en-têtes (`x-real-ip` de confiance + `x-forwarded-for` repli). */
function stubHeaders(realIp: string | null, forwardedFor: string | null) {
  headersMock.mockResolvedValue({
    get: (name: string) => {
      if (name === "x-real-ip") return realIp;
      if (name === "x-forwarded-for") return forwardedFor;
      return null;
    },
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginParentAction", () => {
  it("succès → { ok: true } ; transmet l'IP de confiance (X-Real-IP prioritaire)", async () => {
    stubHeaders("203.0.113.7", "1.2.3.4, 10.0.0.1");
    loginParentMock.mockResolvedValue(true);
    await expect(loginParentAction("9876")).resolves.toEqual({ ok: true });
    expect(loginParentMock).toHaveBeenCalledWith("9876", "203.0.113.7");
  });

  it("échec → { ok: false } (générique) ; repli 'unknown' sans en-tête", async () => {
    stubHeaders(null, null);
    loginParentMock.mockResolvedValue(false);
    await expect(loginParentAction("0000")).resolves.toEqual({ ok: false });
    expect(loginParentMock).toHaveBeenCalledWith("0000", "unknown");
  });
});

describe("logoutParentAction", () => {
  it("délègue la révocation + effacement du cookie", async () => {
    logoutParentMock.mockResolvedValue();
    await logoutParentAction();
    expect(logoutParentMock).toHaveBeenCalledOnce();
  });
});
