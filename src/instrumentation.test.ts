import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
import { resetConfigCache } from "@/config/server-config";

describe("register (validation au boot)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it("ne valide pas pendant la phase de build (`next build`)", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", undefined);
    resetConfigCache();
    expect(() => register()).not.toThrow();
  });

  it("démarre quand la configuration est valide", () => {
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "development");
    resetConfigCache();
    expect(() => register()).not.toThrow();
  });

  it("échoue vite (fail-fast) si une clé requise manque en production", () => {
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", undefined);
    resetConfigCache();
    expect(() => register()).toThrow(/GEMINI_API_KEY/);
  });
});
