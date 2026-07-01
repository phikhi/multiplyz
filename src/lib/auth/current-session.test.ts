import { beforeEach, describe, expect, it, vi } from "vitest";
import { getValidSession, revokeSession } from "./session";
import { authenticateChild } from "./login";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie";
import { getCurrentChildSession, loginChild, logoutChild } from "./current-session";

vi.mock("@/lib/db", () => ({ getDb: () => ({ tag: "db" }) }));
vi.mock("./session", () => ({ getValidSession: vi.fn(), revokeSession: vi.fn() }));
vi.mock("./login", () => ({ authenticateChild: vi.fn() }));
vi.mock("./session-cookie", () => ({
  readSessionToken: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

const getValidSessionMock = vi.mocked(getValidSession);
const revokeSessionMock = vi.mocked(revokeSession);
const authenticateChildMock = vi.mocked(authenticateChild);
const readSessionTokenMock = vi.mocked(readSessionToken);
const setSessionCookieMock = vi.mocked(setSessionCookie);
const clearSessionCookieMock = vi.mocked(clearSessionCookie);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentChildSession", () => {
  it("null si aucun cookie (getValidSession non appelé)", async () => {
    readSessionTokenMock.mockResolvedValue(null);
    await expect(getCurrentChildSession()).resolves.toBeNull();
    expect(getValidSessionMock).not.toHaveBeenCalled();
  });

  it("résout la session valide quand un token est présent", async () => {
    readSessionTokenMock.mockResolvedValue("tok");
    const active = { token: "tok", profileId: 1, kind: "child" as const, expiresAt: new Date() };
    getValidSessionMock.mockReturnValue(active);
    await expect(getCurrentChildSession()).resolves.toBe(active);
    expect(getValidSessionMock).toHaveBeenCalledWith({ tag: "db" }, "tok", expect.any(Date));
  });
});

describe("loginChild", () => {
  it("succès → pose le cookie et renvoie true", async () => {
    authenticateChildMock.mockResolvedValue({ token: "tok", expiresAt: new Date() });
    await expect(loginChild(1, "1234")).resolves.toBe(true);
    expect(setSessionCookieMock).toHaveBeenCalledOnce();
  });

  it("échec → aucun cookie, renvoie false (générique)", async () => {
    authenticateChildMock.mockResolvedValue(null);
    await expect(loginChild(1, "0000")).resolves.toBe(false);
    expect(setSessionCookieMock).not.toHaveBeenCalled();
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
