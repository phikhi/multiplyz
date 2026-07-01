import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { loginChild, logoutChild } from "@/lib/auth/current-session";
import { loginAction, logoutAction } from "./actions";

// Adaptateurs minces : on pilote le cœur (current-session, testé isolément) et
// on vérifie le mapping vers une réponse générique + l'extraction d'IP.
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({
  loginChild: vi.fn(),
  logoutChild: vi.fn(),
}));

const headersMock = vi.mocked(headers);
const loginChildMock = vi.mocked(loginChild);
const logoutChildMock = vi.mocked(logoutChild);

/** Stub d'en-têtes résolvant `x-forwarded-for`. */
function stubHeaders(forwardedFor: string | null) {
  headersMock.mockResolvedValue({
    get: (name: string) => (name === "x-forwarded-for" ? forwardedFor : null),
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginAction", () => {
  it("succès → { ok: true } ; transmet l'IP extraite de x-forwarded-for", async () => {
    stubHeaders("1.2.3.4, 10.0.0.1");
    loginChildMock.mockResolvedValue(true);
    await expect(loginAction(1, "1234")).resolves.toEqual({ ok: true });
    expect(loginChildMock).toHaveBeenCalledWith(1, "1234", "1.2.3.4");
  });

  it("échec → { ok: false } (générique, aucune fuite)", async () => {
    stubHeaders(null);
    loginChildMock.mockResolvedValue(false);
    await expect(loginAction(1, "0000")).resolves.toEqual({ ok: false });
    expect(loginChildMock).toHaveBeenCalledWith(1, "0000", "unknown");
  });
});

describe("logoutAction", () => {
  it("délègue la révocation + effacement du cookie", async () => {
    logoutChildMock.mockResolvedValue();
    await logoutAction();
    expect(logoutChildMock).toHaveBeenCalledOnce();
  });
});
