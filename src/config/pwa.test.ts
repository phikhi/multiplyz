import { describe, expect, it } from "vitest";
import { INSTALL_PROMPT_DISMISSED_KEY, PWA_BG_COLOR, PWA_THEME_COLOR } from "./pwa";

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
