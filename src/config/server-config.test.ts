import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_DEFAULTS,
  ConfigError,
  getConfig,
  loadConfig,
  resetConfigCache,
} from "./server-config";

describe("loadConfig — mode", () => {
  it("résout le mode production", () => {
    expect(loadConfig({ NODE_ENV: "production", GEMINI_API_KEY: "k" }).mode).toBe("production");
  });

  it("résout le mode test", () => {
    expect(loadConfig({ NODE_ENV: "test" }).mode).toBe("test");
  });

  it("résout le mode development par défaut", () => {
    expect(loadConfig({ NODE_ENV: undefined }).mode).toBe("development");
    expect(loadConfig({ NODE_ENV: "anything-else" }).mode).toBe("development");
  });
});

describe("loadConfig — fail-fast (clés requises en production)", () => {
  it("lève ConfigError quand GEMINI_API_KEY est absente", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/GEMINI_API_KEY/);
  });

  it("lève ConfigError quand GEMINI_API_KEY est vide (espaces)", () => {
    expect(() => loadConfig({ NODE_ENV: "production", GEMINI_API_KEY: "   " })).toThrow(
      ConfigError,
    );
  });

  it("démarre quand la clé requise est présente", () => {
    const cfg = loadConfig({ NODE_ENV: "production", GEMINI_API_KEY: "real-key" });
    expect(cfg.imageModel.apiKey).toBe("real-key");
  });

  it("ne valide pas les clés requises hors production", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(loadConfig({ NODE_ENV: "development" }).imageModel.apiKey).toBe("");
  });

  it("le message d'erreur référence .env.example", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/\.env\.example/);
  });
});

describe("loadConfig — paramètres ⚙️ et défauts", () => {
  it("applique les défauts quand l'environnement est vide", () => {
    const cfg = loadConfig({ NODE_ENV: "development" });
    expect(cfg.database.path).toBe(CONFIG_DEFAULTS.database.path);
    expect(cfg.database.busyTimeoutMs).toBe(CONFIG_DEFAULTS.database.busyTimeoutMs);
    expect(cfg.database.journalMode).toBe("WAL");
    expect(cfg.imageModel.model).toBe(CONFIG_DEFAULTS.imageModel.model);
  });

  it("surcharge le chemin DB et le modèle via l'environnement", () => {
    const cfg = loadConfig({
      NODE_ENV: "development",
      DATABASE_PATH: "/custom/multiplyz.sqlite",
      IMAGE_MODEL: "custom-image-model",
      GEMINI_API_KEY: "k",
    });
    expect(cfg.database.path).toBe("/custom/multiplyz.sqlite");
    expect(cfg.imageModel.model).toBe("custom-image-model");
    expect(cfg.imageModel.apiKey).toBe("k");
  });

  it("retombe sur les défauts quand chemin/modèle sont vides (espaces)", () => {
    const cfg = loadConfig({ NODE_ENV: "development", DATABASE_PATH: "   ", IMAGE_MODEL: "  " });
    expect(cfg.database.path).toBe(CONFIG_DEFAULTS.database.path);
    expect(cfg.imageModel.model).toBe(CONFIG_DEFAULTS.imageModel.model);
  });
});

describe("loadConfig — busy_timeout ⚙️", () => {
  it("utilise la valeur d'environnement quand elle est un entier positif", () => {
    expect(loadConfig({ SQLITE_BUSY_TIMEOUT_MS: "8000" }).database.busyTimeoutMs).toBe(8000);
  });

  it("retombe sur le défaut quand la valeur est absente", () => {
    expect(loadConfig({}).database.busyTimeoutMs).toBe(CONFIG_DEFAULTS.database.busyTimeoutMs);
  });

  it("retombe sur le défaut quand la valeur n'est pas un nombre", () => {
    expect(loadConfig({ SQLITE_BUSY_TIMEOUT_MS: "oops" }).database.busyTimeoutMs).toBe(
      CONFIG_DEFAULTS.database.busyTimeoutMs,
    );
  });

  it("retombe sur le défaut quand la valeur n'est pas positive", () => {
    expect(loadConfig({ SQLITE_BUSY_TIMEOUT_MS: "0" }).database.busyTimeoutMs).toBe(
      CONFIG_DEFAULTS.database.busyTimeoutMs,
    );
  });
});

describe("getConfig — mémoïsation", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("retourne la même instance entre deux appels", () => {
    const first = getConfig();
    const second = getConfig();
    expect(second).toBe(first);
  });

  it("recharge après resetConfigCache", () => {
    const first = getConfig();
    resetConfigCache();
    const second = getConfig();
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});
