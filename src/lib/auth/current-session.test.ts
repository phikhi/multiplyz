import { beforeEach, describe, expect, it, vi } from "vitest";
import { getValidSession, purgeExpiredSessions, revokeSession } from "./session";
import { guardedAuthenticateChild } from "./login";
import { guardedAuthenticateParent } from "./parent-login";
import { getAuthConfig } from "@/config/server-config";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie";
import {
  getCurrentChildSession,
  getCurrentParentSession,
  loginChild,
  loginParent,
  logoutChild,
  logoutParent,
} from "./current-session";

vi.mock("@/lib/db", () => ({ getDb: () => ({ tag: "db" }) }));
vi.mock("@/config/server-config", () => ({ getAuthConfig: vi.fn() }));
vi.mock("./session", () => ({
  getValidSession: vi.fn(),
  revokeSession: vi.fn(),
  purgeExpiredSessions: vi.fn(),
}));
vi.mock("./login", () => ({ guardedAuthenticateChild: vi.fn() }));
vi.mock("./parent-login", () => ({ guardedAuthenticateParent: vi.fn() }));
vi.mock("./session-cookie", () => ({
  readSessionToken: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

const getValidSessionMock = vi.mocked(getValidSession);
const revokeSessionMock = vi.mocked(revokeSession);
const purgeExpiredSessionsMock = vi.mocked(purgeExpiredSessions);
const guardedAuthenticateChildMock = vi.mocked(guardedAuthenticateChild);
const guardedAuthenticateParentMock = vi.mocked(guardedAuthenticateParent);
const getAuthConfigMock = vi.mocked(getAuthConfig);
const readSessionTokenMock = vi.mocked(readSessionToken);
const setSessionCookieMock = vi.mocked(setSessionCookie);
const clearSessionCookieMock = vi.mocked(clearSessionCookie);

/** Config auth minimale pour les tests (seul `gcSessionsOnLogin` est lu ici). */
function authConfig(gcSessionsOnLogin: boolean) {
  return { gcSessionsOnLogin } as ReturnType<typeof getAuthConfig>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthConfigMock.mockReturnValue(authConfig(true));
});

describe("getCurrentChildSession", () => {
  it("null si aucun cookie (getValidSession non appelé)", async () => {
    readSessionTokenMock.mockResolvedValue(null);
    await expect(getCurrentChildSession()).resolves.toBeNull();
    expect(getValidSessionMock).not.toHaveBeenCalled();
  });

  it("résout la session enfant valide quand un token est présent", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    const active = { token: "tok", profileId: 1, kind: "child" as const, expiresAt: new Date() };
    getValidSessionMock.mockReturnValue(active);
    await expect(getCurrentChildSession()).resolves.toBe(active);
    expect(getValidSessionMock).toHaveBeenCalledWith({ tag: "db" }, "tok", expect.any(Date));
  });

  it("null si le token est présent mais la session invalide/expirée", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    getValidSessionMock.mockReturnValue(null);
    await expect(getCurrentChildSession()).resolves.toBeNull();
  });

  it("null si la session est de kind parent (ne doit pas ouvrir le jeu enfant, #7)", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    getValidSessionMock.mockReturnValue({
      token: "tok",
      profileId: 1,
      kind: "parent",
      expiresAt: new Date(),
    });
    await expect(getCurrentChildSession()).resolves.toBeNull();
  });
});

describe("loginChild", () => {
  it("succès → pose le cookie et renvoie true ; passe l'IP au garde rate-limit", async () => {
    guardedAuthenticateChildMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await expect(loginChild(1, "1234", "1.2.3.4")).resolves.toBe(true);
    expect(guardedAuthenticateChildMock).toHaveBeenCalledWith(
      { tag: "db" },
      { profileId: 1, pin: "1234", ip: "1.2.3.4" },
      expect.any(Date),
    );
    expect(setSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("succès + GC activé (défaut) → purge les sessions expirées au passage (#44)", async () => {
    getAuthConfigMock.mockReturnValue(authConfig(true));
    guardedAuthenticateChildMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await loginChild(1, "1234", "1.2.3.4");
    expect(purgeExpiredSessionsMock).toHaveBeenCalledOnce();
    // GC borné à la même horloge que l'auth (déterministe).
    expect(purgeExpiredSessionsMock).toHaveBeenCalledWith({ tag: "db" }, expect.any(Date));
  });

  it("succès + GC désactivé (⚙️ off) → NE purge PAS (délégué à un cron futur)", async () => {
    getAuthConfigMock.mockReturnValue(authConfig(false));
    guardedAuthenticateChildMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await loginChild(1, "1234", "1.2.3.4");
    expect(purgeExpiredSessionsMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).toHaveBeenCalledOnce(); // le login réussit quand même
  });

  it("échec (PIN faux ou backoff) → aucun cookie, aucun GC, renvoie false (générique)", async () => {
    guardedAuthenticateChildMock.mockResolvedValue(null);
    await expect(loginChild(1, "0000", "1.2.3.4")).resolves.toBe(false);
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    // Pas de connexion → pas de GC (le GC est opportuniste sur login RÉUSSI).
    expect(purgeExpiredSessionsMock).not.toHaveBeenCalled();
  });
});

describe("logoutChild", () => {
  it("token présent → révoque la session serveur puis efface le cookie", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    await logoutChild();
    expect(revokeSessionMock).toHaveBeenCalledWith({ tag: "db" }, "tok");
    expect(clearSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("aucun token → n'appelle pas revoke, efface quand même le cookie", async () => {
    readSessionTokenMock.mockResolvedValue(null);
    await logoutChild();
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(clearSessionCookieMock).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Espace parent (story 7.1) — mêmes patrons, filtre `kind === "parent"`.
// ============================================================================

describe("getCurrentParentSession", () => {
  it("null si aucun cookie (getValidSession non appelé)", async () => {
    readSessionTokenMock.mockResolvedValue(null);
    await expect(getCurrentParentSession()).resolves.toBeNull();
    expect(getValidSessionMock).not.toHaveBeenCalled();
  });

  it("résout la session parent valide quand un token est présent", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    const active = { token: "tok", profileId: 1, kind: "parent" as const, expiresAt: new Date() };
    getValidSessionMock.mockReturnValue(active);
    await expect(getCurrentParentSession()).resolves.toBe(active);
    expect(getValidSessionMock).toHaveBeenCalledWith({ tag: "db" }, "tok", expect.any(Date));
  });

  it("null si le token est présent mais la session invalide/expirée", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    getValidSessionMock.mockReturnValue(null);
    await expect(getCurrentParentSession()).resolves.toBeNull();
  });

  // SÉCU séparation stricte (AC3) : muter le filtre `kind === "parent"` (ex. → `"child"`)
  // fait échouer CE test nommé — une session enfant n'ouvre JAMAIS /parent.
  it("null si la session est de kind enfant (ne doit pas ouvrir /parent)", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    getValidSessionMock.mockReturnValue({
      token: "tok",
      profileId: 1,
      kind: "child",
      expiresAt: new Date(),
    });
    await expect(getCurrentParentSession()).resolves.toBeNull();
  });
});

describe("loginParent", () => {
  it("succès → pose le cookie et renvoie true ; passe l'IP au garde rate-limit", async () => {
    guardedAuthenticateParentMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await expect(loginParent("9876", "1.2.3.4")).resolves.toBe(true);
    expect(guardedAuthenticateParentMock).toHaveBeenCalledWith(
      { tag: "db" },
      { pin: "9876", ip: "1.2.3.4" },
      expect.any(Date),
    );
    expect(setSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("succès + GC activé (défaut) → purge les sessions expirées au passage (#44)", async () => {
    getAuthConfigMock.mockReturnValue(authConfig(true));
    guardedAuthenticateParentMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await loginParent("9876", "1.2.3.4");
    expect(purgeExpiredSessionsMock).toHaveBeenCalledOnce();
    expect(purgeExpiredSessionsMock).toHaveBeenCalledWith({ tag: "db" }, expect.any(Date));
  });

  it("succès + GC désactivé (⚙️ off) → NE purge PAS (délégué à un cron futur)", async () => {
    getAuthConfigMock.mockReturnValue(authConfig(false));
    guardedAuthenticateParentMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await loginParent("9876", "1.2.3.4");
    expect(purgeExpiredSessionsMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("échec (PIN faux ou backoff) → aucun cookie, aucun GC, renvoie false (générique)", async () => {
    guardedAuthenticateParentMock.mockResolvedValue(null);
    await expect(loginParent("0000", "1.2.3.4")).resolves.toBe(false);
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    expect(purgeExpiredSessionsMock).not.toHaveBeenCalled();
  });
});

describe("logoutParent", () => {
  it("token présent → révoque la session serveur puis efface le cookie", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    await logoutParent();
    expect(revokeSessionMock).toHaveBeenCalledWith({ tag: "db" }, "tok");
    expect(clearSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("aucun token → n'appelle pas revoke, efface quand même le cookie", async () => {
    readSessionTokenMock.mockResolvedValue(null);
    await logoutParent();
    expect(revokeSessionMock).not.toHaveBeenCalled();
    expect(clearSessionCookieMock).toHaveBeenCalledOnce();
  });
});
