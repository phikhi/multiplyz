import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { getConfig } from "@/config/server-config";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  readSessionToken,
  sessionCookieOptions,
  setSessionCookie,
} from "./session-cookie";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/config/server-config", () => ({ getConfig: vi.fn() }));

const cookiesMock = vi.mocked(cookies);
const getConfigMock = vi.mocked(getConfig);

function stubStore() {
  const store = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
  // `cookies()` est asynchrone (Next 15+) → on résout le store espion.
  cookiesMock.mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  return store;
}

const EXPIRES = new Date("2026-08-01T00:00:00.000Z");

beforeEach(() => {
  cookiesMock.mockReset();
  getConfigMock.mockReset();
});

describe("sessionCookieOptions", () => {
  it("attributs durcis ; Secure suit le drapeau (prod=true)", () => {
    expect(sessionCookieOptions(EXPIRES, true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: EXPIRES,
    });
  });

  it("Secure=false hors production (localhost http)", () => {
    expect(sessionCookieOptions(EXPIRES, false).secure).toBe(false);
  });
});

describe("setSessionCookie", () => {
  it("pose le cookie httpOnly/Secure en production", async () => {
    const store = stubStore();
    getConfigMock.mockReturnValue({ mode: "production" } as ReturnType<typeof getConfig>);

    await setSessionCookie("tok123", EXPIRES);

    expect(store.set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, "tok123", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: EXPIRES,
    });
  });

  it("Secure=false en développement", async () => {
    const store = stubStore();
    getConfigMock.mockReturnValue({ mode: "development" } as ReturnType<typeof getConfig>);

    await setSessionCookie("tok123", EXPIRES);

    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      "tok123",
      expect.objectContaining({ secure: false }),
    );
  });
});

describe("clearSessionCookie", () => {
  it("efface le cookie de session", async () => {
    const store = stubStore();
    await clearSessionCookie();
    expect(store.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
  });
});

describe("readSessionToken", () => {
  it("renvoie la valeur du cookie s'il est présent", async () => {
    const store = stubStore();
    store.get.mockReturnValue({ value: "tok123" });
    await expect(readSessionToken()).resolves.toBe("tok123");
    expect(store.get).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
  });

  it("renvoie null si le cookie est absent", async () => {
    const store = stubStore();
    store.get.mockReturnValue(undefined);
    await expect(readSessionToken()).resolves.toBeNull();
  });
});
