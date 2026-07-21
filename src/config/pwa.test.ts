import { describe, expect, it } from "vitest";
import {
  APPLE_SPLASH_DEVICES,
  appleSplashMedia,
  appleSplashPixels,
  appleSplashUrl,
  appleStartupImages,
  INSTALL_PROMPT_DISMISSED_KEY,
  PWA_BG_COLOR,
  PWA_THEME_COLOR,
} from "./pwa";

describe("config/pwa", () => {
  it("exporte une theme_color hexadécimale valide (#RRGGBB)", () => {
    expect(PWA_THEME_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("exporte une background_color hexadécimale valide (#RRGGBB)", () => {
    expect(PWA_BG_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("theme_color correspond à l'accent primaire light (violet)", () => {
    expect(PWA_THEME_COLOR).toBe("#7A5AF8");
  });

  it("background_color correspond au fond primaire light (lavande crème)", () => {
    expect(PWA_BG_COLOR).toBe("#FAF7FF");
  });

  it("expose une clé localStorage préfixée mz- pour le rejet de l'invite d'installation (#258)", () => {
    expect(INSTALL_PROMPT_DISMISSED_KEY).toBe("mz-install-prompt-dismissed");
  });
});

describe("config/pwa — écrans de démarrage iOS (#362)", () => {
  it("liste au moins un device et chacun a des dimensions/dpr strictement positifs", () => {
    expect(APPLE_SPLASH_DEVICES.length).toBeGreaterThan(0);
    for (const d of APPLE_SPLASH_DEVICES) {
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      expect(d.dpr).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(d.width); // portrait
    }
  });

  it("appleSplashPixels multiplie points × dpr", () => {
    expect(appleSplashPixels({ width: 430, height: 932, dpr: 3 })).toEqual({
      pxWidth: 1290,
      pxHeight: 2796,
    });
  });

  it("appleSplashUrl DÉRIVE le nom de fichier des pixels (jamais dupliqué)", () => {
    expect(appleSplashUrl({ width: 430, height: 932, dpr: 3 })).toBe(
      "/splash/apple-splash-1290-2796.png",
    );
    expect(appleSplashUrl({ width: 375, height: 667, dpr: 2 })).toBe(
      "/splash/apple-splash-750-1334.png",
    );
  });

  it("appleSplashMedia produit une media query iOS exacte (points + dpr + portrait)", () => {
    expect(appleSplashMedia({ width: 393, height: 852, dpr: 3 })).toBe(
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    );
  });

  it("appleStartupImages associe chaque device à { url, media } cohérents", () => {
    const images = appleStartupImages();
    expect(images).toHaveLength(APPLE_SPLASH_DEVICES.length);
    images.forEach((img, i) => {
      const device = APPLE_SPLASH_DEVICES[i];
      expect(img.url).toBe(appleSplashUrl(device));
      expect(img.media).toBe(appleSplashMedia(device));
    });
    // Aucune URL/media dupliquée (chaque device sélectionne un splash unique).
    expect(new Set(images.map((i) => i.url)).size).toBe(images.length);
    expect(new Set(images.map((i) => i.media)).size).toBe(images.length);
  });
});
