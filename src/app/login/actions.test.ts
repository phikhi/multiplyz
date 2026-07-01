import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginChild, logoutChild } from "@/lib/auth/current-session";
import { loginAction, logoutAction } from "./actions";

// Adaptateurs minces : on pilote le cœur (current-session, testé isolément) et
// on vérifie le mapping vers une réponse générique.
vi.mock("@/lib/auth/current-session", () => ({
  loginChild: vi.fn(),
  logoutChild: vi.fn(),
}));

const loginChildMock = vi.mocked(loginChild);
const logoutChildMock = vi.mocked(logoutChild);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loginAction", () => {
  it("succès → { ok: true }", async () => {
    loginChildMock.mockResolvedValue(true);
    await expect(loginAction(1, "1234")).resolves.toEqual({ ok: true });
    expect(loginChildMock).toHaveBeenCalledWith(1, "1234");
  });

  it("échec → { ok: false } (générique, aucune fuite)", async () => {
    loginChildMock.mockResolvedValue(false);
    await expect(loginAction(1, "0000")).resolves.toEqual({ ok: false });
  });
});

describe("logoutAction", () => {
  it("délègue la révocation + effacement du cookie", async () => {
    logoutChildMock.mockResolvedValue();
    await logoutAction();
    expect(logoutChildMock).toHaveBeenCalledOnce();
  });
});
