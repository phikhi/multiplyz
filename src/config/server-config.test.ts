import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SKILLS } from "@/lib/engine/domain";
import {
  CONFIG_DEFAULTS,
  ConfigError,
  getAuthConfig,
  getConfig,
  getEconomyConfig,
  getEngineConfig,
  getMapConfig,
  loadAuthConfig,
  loadConfig,
  loadEconomyConfig,
  loadEngineConfig,
  loadMapConfig,
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

describe("loadAuthConfig — défauts ⚙️", () => {
  it("applique les défauts quand l'environnement est vide", () => {
    const auth = loadAuthConfig({});
    expect(auth).toEqual(CONFIG_DEFAULTS.auth);
  });

  it("session enfant longue, session parent courte (enfant > parent)", () => {
    const auth = loadAuthConfig({});
    expect(auth.childSessionMs).toBeGreaterThan(auth.parentSessionMs);
  });

  it("défauts argon2id alignés OWASP (mémoire ≥ 19 MiB, t ≥ 2)", () => {
    const { argon2 } = loadAuthConfig({});
    expect(argon2.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(argon2.timeCost).toBeGreaterThanOrEqual(2);
    expect(argon2.parallelism).toBeGreaterThanOrEqual(1);
  });
});

describe("loadAuthConfig — surcharges ⚙️", () => {
  it("surcharge les durées de session via l'environnement", () => {
    const auth = loadAuthConfig({ AUTH_CHILD_SESSION_MS: "1000", AUTH_PARENT_SESSION_MS: "500" });
    expect(auth.childSessionMs).toBe(1000);
    expect(auth.parentSessionMs).toBe(500);
  });

  it("surcharge les seuils de rate-limit et le backoff", () => {
    const auth = loadAuthConfig({
      AUTH_MAX_PIN_ATTEMPTS: "3",
      AUTH_IP_MAX_PIN_ATTEMPTS: "9",
      AUTH_BACKOFF_BASE_MS: "2000",
      AUTH_BACKOFF_FACTOR: "1.5",
      AUTH_BACKOFF_MAX_MS: "60000",
    });
    expect(auth.rateLimit).toEqual({
      maxAttemptsPerProfile: 3,
      maxAttemptsPerIp: 9,
      backoffBaseMs: 2000,
      backoffFactor: 1.5,
      backoffMaxMs: 60000,
    });
  });

  it("surcharge les paramètres argon2id", () => {
    const auth = loadAuthConfig({
      AUTH_ARGON2_MEMORY_KIB: "32768",
      AUTH_ARGON2_TIME_COST: "3",
      AUTH_ARGON2_PARALLELISM: "2",
    });
    expect(auth.argon2).toEqual({ memoryCost: 32768, timeCost: 3, parallelism: 2 });
  });

  it("retombe sur les défauts quand les valeurs sont invalides", () => {
    const auth = loadAuthConfig({
      AUTH_MAX_PIN_ATTEMPTS: "oops",
      AUTH_BACKOFF_FACTOR: "-2",
      AUTH_CHILD_SESSION_MS: "0",
    });
    expect(auth.rateLimit.maxAttemptsPerProfile).toBe(
      CONFIG_DEFAULTS.auth.rateLimit.maxAttemptsPerProfile,
    );
    expect(auth.rateLimit.backoffFactor).toBe(CONFIG_DEFAULTS.auth.rateLimit.backoffFactor);
    expect(auth.childSessionMs).toBe(CONFIG_DEFAULTS.auth.childSessionMs);
  });

  it("accepte un facteur de backoff fractionnaire (> 1)", () => {
    expect(loadAuthConfig({ AUTH_BACKOFF_FACTOR: "2.5" }).rateLimit.backoffFactor).toBe(2.5);
  });

  it("GC sessions au login : défaut activé (⚙️ #44)", () => {
    expect(loadAuthConfig({}).gcSessionsOnLogin).toBe(true);
  });

  it("GC sessions au login : bascule à false via AUTH_GC_SESSIONS_ON_LOGIN", () => {
    expect(loadAuthConfig({ AUTH_GC_SESSIONS_ON_LOGIN: "false" }).gcSessionsOnLogin).toBe(false);
    // Insensible à la casse / espaces.
    expect(loadAuthConfig({ AUTH_GC_SESSIONS_ON_LOGIN: " FALSE " }).gcSessionsOnLogin).toBe(false);
  });

  it("GC sessions au login : `true` explicite reste activé", () => {
    expect(loadAuthConfig({ AUTH_GC_SESSIONS_ON_LOGIN: "true" }).gcSessionsOnLogin).toBe(true);
  });

  it("GC sessions au login : valeur booléenne invalide → retombe sur le défaut (true)", () => {
    expect(loadAuthConfig({ AUTH_GC_SESSIONS_ON_LOGIN: "oui" }).gcSessionsOnLogin).toBe(true);
  });
});

describe("getAuthConfig — accès mémoïsé", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("expose le bloc auth de la config applicative", () => {
    expect(getAuthConfig()).toBe(getConfig().auth);
  });
});

describe("loadEngineConfig — défauts ⚙️ (ENGINE §11)", () => {
  it("applique les défauts quand l'environnement est vide", () => {
    const engine = loadEngineConfig({});
    expect(engine).toEqual(CONFIG_DEFAULTS.engine);
  });

  it("délais des boîtes Leitner = [0,1,2,4,9,21] (6 boîtes, ENGINE §2)", () => {
    expect(loadEngineConfig({}).leitnerDelaysDays).toEqual([0, 1, 2, 4, 9, 21]);
  });

  it("seuils de fluence : compléments/add 3 s, sous/mult 4 s (ENGINE §2)", () => {
    const { fluenceThresholdsMs } = loadEngineConfig({});
    expect(fluenceThresholdsMs).toEqual({ comp10: 3000, add: 3000, sub: 4000, mult: 4000 });
  });

  it("couvre les 4 compétences du contrat (aucune oubliée)", () => {
    const { fluenceThresholdsMs } = loadEngineConfig({});
    for (const skill of SKILLS) {
      expect(fluenceThresholdsMs[skill]).toBeGreaterThan(0);
    }
    expect(Object.keys(fluenceThresholdsMs)).toHaveLength(SKILLS.length);
  });

  it("promotion +1 / rétrograde −2, boîte max 5 (ENGINE §2/§11)", () => {
    const engine = loadEngineConfig({});
    expect(engine.promoteBoxes).toBe(1);
    expect(engine.demoteBoxes).toBe(2);
    expect(engine.maxBox).toBe(5);
  });

  it("rythme prudent : 2/niveau, 5/jour, conso 8 à box≤1 (ENGINE §7)", () => {
    const engine = loadEngineConfig({});
    expect(engine.newMaxPerLevel).toBe(2);
    expect(engine.newMaxPerDay).toBe(5);
    expect(engine.consolidationThreshold).toBe(8);
    expect(engine.consolidationMaxBox).toBe(1);
  });

  it("bascule interleaving 40 % à box≥3, tier 85 % à box≥4 (ENGINE §7/§8)", () => {
    const engine = loadEngineConfig({});
    expect(engine.interleaveThresholdRatio).toBe(0.4);
    expect(engine.interleaveMinBox).toBe(3);
    expect(engine.tierUnlockRatio).toBe(0.85);
    expect(engine.tierUnlockMinBox).toBe(4);
  });

  it("étoiles 60/85/100 %, anti-mash 600 ms, diagnostic 18 (ENGINE §5/§9/§3)", () => {
    const engine = loadEngineConfig({});
    expect(engine.starThresholds).toEqual([0.6, 0.85, 1.0]);
    expect(engine.antiMashMs).toBe(600);
    expect(engine.diagnosticSize).toBe(18);
  });

  it("seuil de dette de révision = 12 (MAP §5)", () => {
    expect(loadEngineConfig({}).revisionDebtThreshold).toBe(12);
  });
});

describe("loadEngineConfig — surcharges ⚙️ par env", () => {
  it("surcharge les délais des boîtes (liste d'entiers valides)", () => {
    expect(
      loadEngineConfig({ ENGINE_LEITNER_DELAYS_DAYS: "0,1,3,5,10,30" }).leitnerDelaysDays,
    ).toEqual([0, 1, 3, 5, 10, 30]);
  });

  it("ignore une liste de boîtes de mauvaise longueur → défaut", () => {
    expect(loadEngineConfig({ ENGINE_LEITNER_DELAYS_DAYS: "0,1,2" }).leitnerDelaysDays).toEqual(
      CONFIG_DEFAULTS.engine.leitnerDelaysDays,
    );
  });

  it("ignore une liste de boîtes contenant une valeur invalide → défaut", () => {
    expect(
      loadEngineConfig({ ENGINE_LEITNER_DELAYS_DAYS: "0,1,x,4,9,21" }).leitnerDelaysDays,
    ).toEqual(CONFIG_DEFAULTS.engine.leitnerDelaysDays);
  });

  it("ignore une liste de boîtes avec un négatif → défaut", () => {
    expect(
      loadEngineConfig({ ENGINE_LEITNER_DELAYS_DAYS: "0,1,-2,4,9,21" }).leitnerDelaysDays,
    ).toEqual(CONFIG_DEFAULTS.engine.leitnerDelaysDays);
  });

  it("surcharge le seuil de fluence d'une compétence sans toucher les autres", () => {
    const { fluenceThresholdsMs } = loadEngineConfig({ ENGINE_FLUENCE_MS_MULT: "5000" });
    expect(fluenceThresholdsMs.mult).toBe(5000);
    expect(fluenceThresholdsMs.add).toBe(CONFIG_DEFAULTS.engine.fluenceThresholdsMs.add);
  });

  it("retombe sur le défaut quand un seuil de fluence est invalide", () => {
    expect(loadEngineConfig({ ENGINE_FLUENCE_MS_COMP10: "0" }).fluenceThresholdsMs.comp10).toBe(
      CONFIG_DEFAULTS.engine.fluenceThresholdsMs.comp10,
    );
  });

  it("surcharge promotion / rétrograde / boîte max (entiers ≥ 0)", () => {
    const engine = loadEngineConfig({
      ENGINE_PROMOTE_BOXES: "2",
      ENGINE_DEMOTE_BOXES: "0",
      ENGINE_MAX_BOX: "6",
    });
    expect(engine.promoteBoxes).toBe(2);
    expect(engine.demoteBoxes).toBe(0); // 0 accepté (parseNonNegativeInt)
    expect(engine.maxBox).toBe(6);
  });

  it("retombe sur le défaut quand un entier ≥ 0 est invalide (négatif / non numérique)", () => {
    const engine = loadEngineConfig({ ENGINE_PROMOTE_BOXES: "-1", ENGINE_MAX_BOX: "nope" });
    expect(engine.promoteBoxes).toBe(CONFIG_DEFAULTS.engine.promoteBoxes);
    expect(engine.maxBox).toBe(CONFIG_DEFAULTS.engine.maxBox);
  });

  it("surcharge le rythme et les seuils de consolidation", () => {
    const engine = loadEngineConfig({
      ENGINE_NEW_MAX_PER_LEVEL: "3",
      ENGINE_NEW_MAX_PER_DAY: "7",
      ENGINE_CONSOLIDATION_THRESHOLD: "10",
      ENGINE_CONSOLIDATION_MAX_BOX: "2",
    });
    expect(engine.newMaxPerLevel).toBe(3);
    expect(engine.newMaxPerDay).toBe(7);
    expect(engine.consolidationThreshold).toBe(10);
    expect(engine.consolidationMaxBox).toBe(2);
  });

  it("retombe sur le défaut quand le seuil de consolidation est invalide (positif requis)", () => {
    expect(loadEngineConfig({ ENGINE_CONSOLIDATION_THRESHOLD: "0" }).consolidationThreshold).toBe(
      CONFIG_DEFAULTS.engine.consolidationThreshold,
    );
  });

  it("surcharge les ratios d'interleaving et de tier (bornes ]0,1])", () => {
    const engine = loadEngineConfig({
      ENGINE_INTERLEAVE_THRESHOLD_RATIO: "0.5",
      ENGINE_INTERLEAVE_MIN_BOX: "2",
      ENGINE_TIER_UNLOCK_RATIO: "0.9",
      ENGINE_TIER_UNLOCK_MIN_BOX: "5",
    });
    expect(engine.interleaveThresholdRatio).toBe(0.5);
    expect(engine.interleaveMinBox).toBe(2);
    expect(engine.tierUnlockRatio).toBe(0.9);
    expect(engine.tierUnlockMinBox).toBe(5);
  });

  it("accepte un ratio de 1 (100 %) mais rejette hors ]0,1] → défaut", () => {
    expect(loadEngineConfig({ ENGINE_TIER_UNLOCK_RATIO: "1" }).tierUnlockRatio).toBe(1);
    expect(loadEngineConfig({ ENGINE_TIER_UNLOCK_RATIO: "1.5" }).tierUnlockRatio).toBe(
      CONFIG_DEFAULTS.engine.tierUnlockRatio,
    );
    expect(
      loadEngineConfig({ ENGINE_INTERLEAVE_THRESHOLD_RATIO: "0" }).interleaveThresholdRatio,
    ).toBe(CONFIG_DEFAULTS.engine.interleaveThresholdRatio);
    expect(
      loadEngineConfig({ ENGINE_INTERLEAVE_THRESHOLD_RATIO: "oops" }).interleaveThresholdRatio,
    ).toBe(CONFIG_DEFAULTS.engine.interleaveThresholdRatio);
  });

  it("surcharge les seuils d'étoiles (triplet croissant ]0,1])", () => {
    expect(loadEngineConfig({ ENGINE_STAR_THRESHOLDS: "0.5,0.75,0.95" }).starThresholds).toEqual([
      0.5, 0.75, 0.95,
    ]);
  });

  it("rejette un triplet d'étoiles de mauvaise longueur → défaut", () => {
    expect(loadEngineConfig({ ENGINE_STAR_THRESHOLDS: "0.6,0.85" }).starThresholds).toEqual(
      CONFIG_DEFAULTS.engine.starThresholds,
    );
  });

  it("rejette un triplet d'étoiles non croissant → défaut", () => {
    expect(loadEngineConfig({ ENGINE_STAR_THRESHOLDS: "0.85,0.6,1.0" }).starThresholds).toEqual(
      CONFIG_DEFAULTS.engine.starThresholds,
    );
  });

  it("rejette un triplet d'étoiles hors ]0,1] ou non numérique → défaut", () => {
    expect(loadEngineConfig({ ENGINE_STAR_THRESHOLDS: "0.6,0.85,1.5" }).starThresholds).toEqual(
      CONFIG_DEFAULTS.engine.starThresholds,
    );
    expect(loadEngineConfig({ ENGINE_STAR_THRESHOLDS: "a,b,c" }).starThresholds).toEqual(
      CONFIG_DEFAULTS.engine.starThresholds,
    );
  });

  it("surcharge anti-mash et taille du diagnostic (positifs)", () => {
    const engine = loadEngineConfig({ ENGINE_ANTI_MASH_MS: "800", ENGINE_DIAGNOSTIC_SIZE: "24" });
    expect(engine.antiMashMs).toBe(800);
    expect(engine.diagnosticSize).toBe(24);
  });

  it("surcharge le seuil de dette de révision (entier ≥ 0)", () => {
    expect(loadEngineConfig({ ENGINE_REVISION_DEBT_THRESHOLD: "20" }).revisionDebtThreshold).toBe(
      20,
    );
    // 0 accepté (parseNonNegativeInt) : extrême de calibration légitime.
    expect(loadEngineConfig({ ENGINE_REVISION_DEBT_THRESHOLD: "0" }).revisionDebtThreshold).toBe(0);
  });

  it("retombe sur le défaut quand le seuil de dette est invalide (négatif / non numérique)", () => {
    expect(loadEngineConfig({ ENGINE_REVISION_DEBT_THRESHOLD: "-3" }).revisionDebtThreshold).toBe(
      CONFIG_DEFAULTS.engine.revisionDebtThreshold,
    );
    expect(loadEngineConfig({ ENGINE_REVISION_DEBT_THRESHOLD: "nope" }).revisionDebtThreshold).toBe(
      CONFIG_DEFAULTS.engine.revisionDebtThreshold,
    );
  });
});

describe("loadMapConfig — défauts ⚙️ (MAP §1/§3/§6)", () => {
  it("applique les défauts quand l'environnement est vide", () => {
    expect(loadMapConfig({})).toEqual(CONFIG_DEFAULTS.map);
  });

  it("monde = 10 niveaux + 1 boss, trésor tous les 4, boss ~13 questions", () => {
    const map = loadMapConfig({});
    expect(map.levelsPerWorld).toBe(10);
    expect(map.treasureEvery).toBe(4);
    expect(map.bossQuestionCount).toBe(13);
  });
});

describe("loadMapConfig — surcharges ⚙️ par env", () => {
  it("surcharge les trois paramètres de structure (positifs)", () => {
    const map = loadMapConfig({
      MAP_LEVELS_PER_WORLD: "8",
      MAP_TREASURE_EVERY: "3",
      MAP_BOSS_QUESTION_COUNT: "15",
    });
    expect(map.levelsPerWorld).toBe(8);
    expect(map.treasureEvery).toBe(3);
    expect(map.bossQuestionCount).toBe(15);
  });

  it("retombe sur le défaut quand une valeur est invalide (0 / négatif / non numérique)", () => {
    // parsePositiveInt : ces trois ⚙️ doivent être ≥ 1 (monde, cadence, boss).
    expect(loadMapConfig({ MAP_LEVELS_PER_WORLD: "0" }).levelsPerWorld).toBe(
      CONFIG_DEFAULTS.map.levelsPerWorld,
    );
    expect(loadMapConfig({ MAP_TREASURE_EVERY: "-2" }).treasureEvery).toBe(
      CONFIG_DEFAULTS.map.treasureEvery,
    );
    expect(loadMapConfig({ MAP_BOSS_QUESTION_COUNT: "x" }).bossQuestionCount).toBe(
      CONFIG_DEFAULTS.map.bossQuestionCount,
    );
  });
});

describe("loadEconomyConfig — défauts ⚙️ (ECONOMY §4.1/§5)", () => {
  it("applique les défauts quand l'environnement est vide", () => {
    expect(loadEconomyConfig({})).toEqual(CONFIG_DEFAULTS.economy);
  });

  it("barème = base 10 + 5/étoile + 15 trésor + 50 boss (ECONOMY §5)", () => {
    const eco = loadEconomyConfig({});
    expect(eco.levelBaseCoins).toBe(10);
    expect(eco.starBonusCoins).toBe(5);
    expect(eco.treasureBonusCoins).toBe(15);
    expect(eco.bossBonusCoins).toBe(50);
  });
});

describe("loadEconomyConfig — surcharges ⚙️ par env", () => {
  it("surcharge les quatre paramètres du barème", () => {
    const eco = loadEconomyConfig({
      ECONOMY_LEVEL_BASE_COINS: "20",
      ECONOMY_STAR_BONUS_COINS: "8",
      ECONOMY_TREASURE_BONUS_COINS: "40",
      ECONOMY_BOSS_BONUS_COINS: "120",
    });
    expect(eco.levelBaseCoins).toBe(20);
    expect(eco.starBonusCoins).toBe(8);
    expect(eco.treasureBonusCoins).toBe(40);
    expect(eco.bossBonusCoins).toBe(120);
  });

  it("accepte 0 (barème désactivable) mais retombe sur le défaut si négatif / non numérique", () => {
    // parseNonNegativeInt : 0 est légitime (désactive une source de gain).
    expect(loadEconomyConfig({ ECONOMY_TREASURE_BONUS_COINS: "0" }).treasureBonusCoins).toBe(0);
    expect(loadEconomyConfig({ ECONOMY_BOSS_BONUS_COINS: "0" }).bossBonusCoins).toBe(0);
    // Négatif (aberrant pour un gain) → défaut.
    expect(loadEconomyConfig({ ECONOMY_LEVEL_BASE_COINS: "-5" }).levelBaseCoins).toBe(
      CONFIG_DEFAULTS.economy.levelBaseCoins,
    );
    expect(loadEconomyConfig({ ECONOMY_BOSS_BONUS_COINS: "-9" }).bossBonusCoins).toBe(
      CONFIG_DEFAULTS.economy.bossBonusCoins,
    );
    // Non numérique → défaut.
    expect(loadEconomyConfig({ ECONOMY_STAR_BONUS_COINS: "x" }).starBonusCoins).toBe(
      CONFIG_DEFAULTS.economy.starBonusCoins,
    );
  });
});

describe("loadConfig — bloc engine intégré", () => {
  it("expose le bloc engine dans la config applicative", () => {
    expect(loadConfig({ NODE_ENV: "development" }).engine).toEqual(CONFIG_DEFAULTS.engine);
  });

  it("expose le bloc map dans la config applicative", () => {
    expect(loadConfig({ NODE_ENV: "development" }).map).toEqual(CONFIG_DEFAULTS.map);
  });

  it("expose le bloc economy dans la config applicative", () => {
    expect(loadConfig({ NODE_ENV: "development" }).economy).toEqual(CONFIG_DEFAULTS.economy);
  });
});

describe("getMapConfig — accès mémoïsé", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("expose le bloc map de la config applicative", () => {
    expect(getMapConfig()).toBe(getConfig().map);
  });
});

describe("getEngineConfig — accès mémoïsé", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("expose le bloc engine de la config applicative", () => {
    expect(getEngineConfig()).toBe(getConfig().engine);
  });
});

describe("getEconomyConfig — accès mémoïsé", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("expose le bloc economy de la config applicative", () => {
    expect(getEconomyConfig()).toBe(getConfig().economy);
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
