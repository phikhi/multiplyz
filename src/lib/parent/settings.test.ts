import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { HOUSEHOLD_SETTINGS_ID, householdSettings } from "@/lib/db/schema";
import {
  resetConfigCache,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  type ParentControlsConfig,
} from "@/config/server-config";
import {
  dataThemeAttr,
  presetOptionsInRange,
  readHouseholdSettings,
  resolveSettingsDefaults,
  SettingsValidationError,
  SCREEN_TIME_HARD_LOCK_PRESETS,
  SCREEN_TIME_NUDGE_PRESETS,
  SOUND_VOLUME_PRESETS,
  writeHouseholdSettings,
  type HouseholdSettings,
} from "./settings";

/**
 * Tests des **réglages du foyer** (story 7.3, DETAILS §3 ; son/musique/volume story 8.3, DETAILS
 * §22). Base réelle (SQLite `:memory:` + migrations). Source de vérité serveur : lecture (défauts
 * si absent) / écriture (validation + upsert singleton). Chaque garde de validation est
 * **mutation-prouvée** (test nommé qui rougit si la borne / l'enum est retirée). `dataThemeAttr`
 * (consommé par `layout.tsx`, exclu du coverage) est testé ici en fonction pure.
 */

let db: AppDatabase;

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});
afterEach(() => resetConfigCache());

/** Bornes ⚙️ explicites (déterministes, indépendantes de la config globale) pour les tests d'écriture. */
const CONTROLS: ParentControlsConfig = {
  screenTimeNudgeDefaultMinutes: 20,
  screenTimeNudgeMinMinutes: 5,
  screenTimeNudgeMaxMinutes: 60,
  screenTimeHardLockDefaultMinutes: 45,
  screenTimeHardLockMinMinutes: 10,
  screenTimeHardLockMaxMinutes: 240,
};

/** Défauts explicites (déterministes) pour prouver le repli « ligne absente → défauts ». */
const DEFAULTS: HouseholdSettings = {
  theme: "system",
  parentWorldValidation: false,
  screenTimeNudgeMinutes: 20,
  screenTimeHardLockEnabled: false,
  screenTimeHardLockMinutes: 45,
  soundEnabled: true,
  musicEnabled: true,
  volume: 70,
};

// ───────────────────────────── resolveSettingsDefaults (composés depuis la config ⚙️) ─────────────────────────────

describe("resolveSettingsDefaults — défauts composés depuis la config", () => {
  it("défauts globaux : theme system, validation off, temps d'écran + son = CONFIG_DEFAULTS", () => {
    expect(resolveSettingsDefaults()).toEqual({
      theme: "system",
      parentWorldValidation: false,
      screenTimeNudgeMinutes: 20,
      screenTimeHardLockEnabled: false,
      screenTimeHardLockMinutes: 45,
      soundEnabled: true,
      musicEnabled: true,
      volume: 70,
    });
  });

  it("lit la config ⚙️ : env AGIT sur les défauts (nudge + défaut de validation d'amorçage)", () => {
    process.env.WORLDGEN_QA_PARENT_VALIDATION = "true";
    process.env.PARENT_SCREEN_TIME_NUDGE_DEFAULT_MIN = "30";
    resetConfigCache();
    try {
      const d = resolveSettingsDefaults();
      expect(d.parentWorldValidation).toBe(true);
      expect(d.screenTimeNudgeMinutes).toBe(30);
    } finally {
      delete process.env.WORLDGEN_QA_PARENT_VALIDATION;
      delete process.env.PARENT_SCREEN_TIME_NUDGE_DEFAULT_MIN;
      resetConfigCache();
    }
  });

  it("lit la config ⚙️ son (story 8.3) : env AGIT sur les défauts son/musique/volume", () => {
    process.env.SOUND_ENABLED_DEFAULT = "false";
    process.env.MUSIC_ENABLED_DEFAULT = "false";
    process.env.SOUND_VOLUME_DEFAULT = "40";
    resetConfigCache();
    try {
      const d = resolveSettingsDefaults();
      expect(d.soundEnabled).toBe(false);
      expect(d.musicEnabled).toBe(false);
      expect(d.volume).toBe(40);
    } finally {
      delete process.env.SOUND_ENABLED_DEFAULT;
      delete process.env.MUSIC_ENABLED_DEFAULT;
      delete process.env.SOUND_VOLUME_DEFAULT;
      resetConfigCache();
    }
  });
});

// ───────────────────────────── readHouseholdSettings ─────────────────────────────

describe("readHouseholdSettings — ligne absente → défauts, présente → valeurs persistées", () => {
  it("foyer neuf (aucune ligne) ⇒ défauts injectés", () => {
    expect(readHouseholdSettings(db, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("foyer neuf sans défauts explicites ⇒ défauts de config (couvre le param par défaut)", () => {
    expect(readHouseholdSettings(db)).toEqual(resolveSettingsDefaults());
  });

  it("après écriture ⇒ renvoie les valeurs persistées (pas les défauts)", () => {
    writeHouseholdSettings(
      db,
      { theme: "dark", parentWorldValidation: true, screenTimeNudgeMinutes: 30 },
      CONTROLS,
    );
    expect(readHouseholdSettings(db, DEFAULTS)).toEqual({
      theme: "dark",
      parentWorldValidation: true,
      screenTimeNudgeMinutes: 30,
      screenTimeHardLockEnabled: false,
      screenTimeHardLockMinutes: 45,
      soundEnabled: true,
      musicEnabled: true,
      volume: 70,
    });
  });

  it("après écriture du son ⇒ renvoie les valeurs son persistées (story 8.3)", () => {
    writeHouseholdSettings(db, { soundEnabled: false, musicEnabled: false, volume: 30 }, CONTROLS);
    const read = readHouseholdSettings(db, DEFAULTS);
    expect(read.soundEnabled).toBe(false);
    expect(read.musicEnabled).toBe(false);
    expect(read.volume).toBe(30);
  });
});

// ───────────────────────────── writeHouseholdSettings (merge + validation + upsert) ─────────────────────────────

describe("writeHouseholdSettings — merge patch + upsert singleton idempotent", () => {
  it("écrit une seule ligne (PK singleton) et la renvoie", () => {
    const result = writeHouseholdSettings(db, { theme: "light" }, CONTROLS);
    expect(result.theme).toBe("light");
    const rows = db.select().from(householdSettings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(HOUSEHOLD_SETTINGS_ID);
  });

  it("patch partiel : préserve les champs NON touchés (merge sur les valeurs courantes)", () => {
    writeHouseholdSettings(
      db,
      {
        theme: "dark",
        parentWorldValidation: true,
        screenTimeNudgeMinutes: 45,
        screenTimeHardLockEnabled: true,
        screenTimeHardLockMinutes: 90,
        soundEnabled: false,
        musicEnabled: false,
        volume: 25,
      },
      CONTROLS,
    );
    // Deuxième écriture (patch d'un seul champ) : les autres restent inchangés.
    const merged = writeHouseholdSettings(db, { theme: "light" }, CONTROLS);
    expect(merged).toEqual({
      theme: "light",
      parentWorldValidation: true,
      screenTimeNudgeMinutes: 45,
      screenTimeHardLockEnabled: true,
      screenTimeHardLockMinutes: 90,
      soundEnabled: false,
      musicEnabled: false,
      volume: 25,
    });
    // Toujours une seule ligne (upsert, pas d'insertion en double).
    expect(db.select().from(householdSettings).all()).toHaveLength(1);
  });

  it("booléens : `false` préservé (jamais écrasé par défaut) ET valeur non-booléenne coercée", () => {
    writeHouseholdSettings(db, { parentWorldValidation: true }, CONTROLS);
    // `false` explicite doit rester `false` (le `??`/coercion ne le remplace pas par le courant).
    expect(writeHouseholdSettings(db, { parentWorldValidation: false }, CONTROLS)).toMatchObject({
      parentWorldValidation: false,
    });
    // Garde de forme (#99) : une valeur non-booléenne hostile est coercée à `false` (jamais écrite telle quelle).
    const coerced = writeHouseholdSettings(
      db,
      { screenTimeHardLockEnabled: 1 as unknown as boolean },
      CONTROLS,
    );
    expect(coerced.screenTimeHardLockEnabled).toBe(false);
    expect(db.select().from(householdSettings).get()?.screenTimeHardLockEnabled).toBe(false);
  });

  it("son/musique : `false` préservé ET valeur non-booléenne coercée (story 8.3, même patron #99)", () => {
    writeHouseholdSettings(db, { soundEnabled: true, musicEnabled: true }, CONTROLS);
    // `false` explicite doit rester `false` (le `??`/coercion ne le remplace pas par le courant).
    expect(
      writeHouseholdSettings(db, { soundEnabled: false, musicEnabled: false }, CONTROLS),
    ).toMatchObject({ soundEnabled: false, musicEnabled: false });
    // Garde de forme (#99) : une valeur non-booléenne hostile est coercée à `false`.
    const coerced = writeHouseholdSettings(
      db,
      { soundEnabled: "yes" as unknown as boolean, musicEnabled: 1 as unknown as boolean },
      CONTROLS,
    );
    expect(coerced.soundEnabled).toBe(false);
    expect(coerced.musicEnabled).toBe(false);
    const row = db.select().from(householdSettings).get();
    expect(row?.soundEnabled).toBe(false);
    expect(row?.musicEnabled).toBe(false);
  });

  it("patch vide ⇒ ré-écrit les valeurs courantes (couvre les branches `undefined → courant`)", () => {
    writeHouseholdSettings(
      db,
      { theme: "dark", screenTimeHardLockEnabled: true, soundEnabled: false, volume: 55 },
      CONTROLS,
    );
    expect(writeHouseholdSettings(db, {}, CONTROLS)).toEqual({
      theme: "dark",
      parentWorldValidation: false,
      screenTimeNudgeMinutes: 20,
      screenTimeHardLockEnabled: true,
      screenTimeHardLockMinutes: 45,
      soundEnabled: false,
      musicEnabled: true,
      volume: 55,
    });
  });

  it("sans `controls` explicite ⇒ utilise les bornes ⚙️ de la config (couvre le param par défaut)", () => {
    expect(writeHouseholdSettings(db, { screenTimeNudgeMinutes: 20 }).screenTimeNudgeMinutes).toBe(
      20,
    );
  });
});

describe("writeHouseholdSettings — validation (chaque garde mutation-prouvée, aucune écriture si invalide)", () => {
  it("MUTATION-PROUVÉ THEME_INVALID : un thème hors enum ⇒ rejet nommé, aucune ligne écrite", () => {
    expect(() =>
      writeHouseholdSettings(db, { theme: "midnight" as unknown as "dark" }, CONTROLS),
    ).toThrow(SettingsValidationError);
    try {
      writeHouseholdSettings(db, { theme: "midnight" as unknown as "dark" }, CONTROLS);
    } catch (error) {
      expect((error as SettingsValidationError).code).toBe("THEME_INVALID");
    }
    // Aucune écriture (rejet AVANT l'upsert) : la table reste vide.
    expect(db.select().from(householdSettings).all()).toHaveLength(0);
  });

  it("MUTATION-PROUVÉ NUDGE_OUT_OF_RANGE : sous la borne min ⇒ rejet (retirer la borne min → vert)", () => {
    expect(() => writeHouseholdSettings(db, { screenTimeNudgeMinutes: 4 }, CONTROLS)).toThrowError(
      new SettingsValidationError("NUDGE_OUT_OF_RANGE"),
    );
  });

  it("MUTATION-PROUVÉ NUDGE_OUT_OF_RANGE : au-dessus de la borne max ⇒ rejet (retirer la borne max → vert)", () => {
    expect(() => writeHouseholdSettings(db, { screenTimeNudgeMinutes: 61 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
  });

  it("NUDGE_OUT_OF_RANGE : valeur non-entière ⇒ rejet (garde `Number.isInteger`)", () => {
    expect(() => writeHouseholdSettings(db, { screenTimeNudgeMinutes: 20.5 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
  });

  it("MUTATION-PROUVÉ HARD_LOCK_OUT_OF_RANGE : hors bornes du verrou dur ⇒ rejet nommé", () => {
    expect(() => writeHouseholdSettings(db, { screenTimeHardLockMinutes: 9 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
    expect(() => writeHouseholdSettings(db, { screenTimeHardLockMinutes: 241 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
    try {
      writeHouseholdSettings(db, { screenTimeHardLockMinutes: 9 }, CONTROLS);
    } catch (error) {
      expect((error as SettingsValidationError).code).toBe("HARD_LOCK_OUT_OF_RANGE");
    }
  });

  it("valeurs aux bornes exactes (min/max) ⇒ acceptées (borne inclusive testée à la frontière)", () => {
    expect(
      writeHouseholdSettings(db, { screenTimeNudgeMinutes: 5 }, CONTROLS).screenTimeNudgeMinutes,
    ).toBe(5);
    expect(
      writeHouseholdSettings(db, { screenTimeNudgeMinutes: 60 }, CONTROLS).screenTimeNudgeMinutes,
    ).toBe(60);
    expect(
      writeHouseholdSettings(db, { screenTimeHardLockMinutes: 10 }, CONTROLS)
        .screenTimeHardLockMinutes,
    ).toBe(10);
    expect(
      writeHouseholdSettings(db, { screenTimeHardLockMinutes: 240 }, CONTROLS)
        .screenTimeHardLockMinutes,
    ).toBe(240);
  });

  it("MUTATION-PROUVÉ VOLUME_OUT_OF_RANGE : sous la borne min ⇒ rejet nommé, aucune ligne écrite (story 8.3)", () => {
    expect(() => writeHouseholdSettings(db, { volume: SOUND_VOLUME_MIN - 1 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
    try {
      writeHouseholdSettings(db, { volume: SOUND_VOLUME_MIN - 1 }, CONTROLS);
    } catch (error) {
      expect((error as SettingsValidationError).code).toBe("VOLUME_OUT_OF_RANGE");
    }
    expect(db.select().from(householdSettings).all()).toHaveLength(0);
  });

  it("MUTATION-PROUVÉ VOLUME_OUT_OF_RANGE : au-dessus de la borne max ⇒ rejet (retirer la borne max → vert)", () => {
    expect(() => writeHouseholdSettings(db, { volume: SOUND_VOLUME_MAX + 1 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
  });

  it("VOLUME_OUT_OF_RANGE : valeur non-entière ⇒ rejet (garde `Number.isInteger`)", () => {
    expect(() => writeHouseholdSettings(db, { volume: 50.5 }, CONTROLS)).toThrow(
      SettingsValidationError,
    );
  });

  it("volume aux bornes exactes (0/100) ⇒ accepté (borne inclusive testée à la frontière)", () => {
    expect(writeHouseholdSettings(db, { volume: SOUND_VOLUME_MIN }, CONTROLS).volume).toBe(
      SOUND_VOLUME_MIN,
    );
    expect(writeHouseholdSettings(db, { volume: SOUND_VOLUME_MAX }, CONTROLS).volume).toBe(
      SOUND_VOLUME_MAX,
    );
  });
});

// ───────────────────────────── dataThemeAttr (pure, consommée par layout.tsx) ─────────────────────────────

describe("dataThemeAttr — préférence → attribut data-theme", () => {
  it("system ⇒ undefined (aucun attribut → média-query système décide)", () => {
    expect(dataThemeAttr("system")).toBeUndefined();
  });
  it("light ⇒ 'light' (force clair, bloque l'auto-sombre système)", () => {
    expect(dataThemeAttr("light")).toBe("light");
  });
  it("dark ⇒ 'dark' (force sombre)", () => {
    expect(dataThemeAttr("dark")).toBe("dark");
  });
});

// ───────────────────────────── presetOptionsInRange (options du <select>) ─────────────────────────────

describe("presetOptionsInRange — présets dans les bornes + valeur courante, dédupliqué + trié", () => {
  it("présets nudge filtrés aux bornes, valeur courante déjà un préset ⇒ liste des présets", () => {
    expect(presetOptionsInRange(SCREEN_TIME_NUDGE_PRESETS, 20, 5, 60)).toEqual([
      15, 20, 30, 45, 60,
    ]);
  });

  it("valeur courante hors préset MAIS dans les bornes ⇒ insérée + triée (reste sélectionnable)", () => {
    expect(presetOptionsInRange(SCREEN_TIME_HARD_LOCK_PRESETS, 75, 10, 240)).toEqual([
      30, 45, 60, 75, 90, 120,
    ]);
  });

  it("borne resserrée ⇒ présets hors bornes exclus ; valeur courante hors bornes non ajoutée", () => {
    // Bornes 40..100 : présets 30/120 exclus ; valeur courante 200 hors bornes → non ajoutée.
    expect(presetOptionsInRange(SCREEN_TIME_HARD_LOCK_PRESETS, 200, 40, 100)).toEqual([45, 60, 90]);
  });

  it("valeur courante = un préset dans les bornes ⇒ pas de doublon (dédup)", () => {
    expect(presetOptionsInRange(SCREEN_TIME_NUDGE_PRESETS, 30, 5, 60)).toEqual([
      15, 20, 30, 45, 60,
    ]);
  });

  it("présets volume (story 8.3) filtrés aux bornes fixes [0,100], valeur courante hors préset insérée", () => {
    expect(
      presetOptionsInRange(SOUND_VOLUME_PRESETS, 90, SOUND_VOLUME_MIN, SOUND_VOLUME_MAX),
    ).toEqual([0, 25, 50, 75, 90, 100]);
  });
});
