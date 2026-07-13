import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { MUSIC_MANIFEST, SFX_MANIFEST } from "./manifest";

/**
 * Chemin FORMAT-RÉEL (#189, extension #180/#184) — prouve que les assets COMMITTÉS référencés
 * par `manifest.ts` sont de VRAIS conteneurs audio valides (magic bytes RIFF/WAVE), pas
 * seulement une fixture `null`/placeholder de test. Lit directement les fichiers sous
 * `public/sounds/**` (générés par `scripts/generate-sound-placeholders.mjs`, committés) —
 * complète la preuve navigateur réel (`e2e/sound-assets.spec.ts`, décodage `AudioContext` en
 * Chromium) par une preuve rapide/déterministe côté Node (magic bytes + gabarit RIFF).
 */

const PUBLIC_DIR = resolve(__dirname, "../../../public");

function readAsset(publicPath: string): Buffer {
  return readFileSync(resolve(PUBLIC_DIR, `.${publicPath}`));
}

describe("Assets audio committés (story 8.4, #257) — chemin format-réel #189", () => {
  const allAssetPaths = [...Object.values(SFX_MANIFEST), ...Object.values(MUSIC_MANIFEST)];

  it.each(allAssetPaths)(
    "%s existe et est un WAV PCM valide (RIFF/WAVE, taille raisonnable)",
    (assetPath) => {
      const buffer = readAsset(assetPath);
      // Magic bytes RIFF....WAVE — filet #189 : un fichier corrompu/mal-formé romprait ici,
      // PAS seulement au moment (invisible en CI) où un navigateur tenterait de le décoder.
      expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(buffer.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(buffer.subarray(12, 16).toString("ascii")).toBe("fmt ");
      // PCM (audioFormat=1) — kid-safe : pas de codec compressé exotique, décodage universel.
      expect(buffer.readUInt16LE(20)).toBe(1);

      const stats = statSync(resolve(PUBLIC_DIR, `.${assetPath}`));
      // ⚙️ Poids raisonnable (AC #5) : chaque SFX/musique reste sous 300 Ko (tonalités synthétiques
      // courtes, jamais un enregistrement lourd) — rougit si un asset dérive massivement.
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.size).toBeLessThan(300_000);
    },
  );

  it("le manifeste SFX référence exactement 4 clés (correct/combo/results/legendary)", () => {
    expect(Object.keys(SFX_MANIFEST).sort()).toEqual(
      ["combo", "correct", "legendary", "results"].sort(),
    );
  });

  it("le manifeste musique référence exactement 1 clé (play)", () => {
    expect(Object.keys(MUSIC_MANIFEST)).toEqual(["play"]);
  });
});
