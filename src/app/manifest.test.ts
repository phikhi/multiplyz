import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { BRAND_NAME } from "@/config/brand";
import { PWA_BG_COLOR, PWA_THEME_COLOR } from "@/config/pwa";
import { strings } from "@/strings";

describe("manifest (PWA)", () => {
  it("retourne un manifest valide avec le nom de la marque", () => {
    const m = manifest();
    expect(m.name).toBe(BRAND_NAME);
    expect(m.short_name).toBe(BRAND_NAME);
  });

  it("définit un id stable /", () => {
    expect(manifest().id).toBe("/");
  });

  it("la description est sourcée depuis strings.meta.description (pas de littéral)", () => {
    expect(manifest().description).toBe(strings.meta.description);
  });

  it("définit display standalone et lang fr", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("fr");
  });

  it("utilise les couleurs depuis les constantes PWA (pas de magic number)", () => {
    const m = manifest();
    expect(m.theme_color).toBe(PWA_THEME_COLOR);
    expect(m.background_color).toBe(PWA_BG_COLOR);
  });

  it("définit start_url /", () => {
    expect(manifest().start_url).toBe("/");
  });

  it("inclut les icônes 192×192 et 512×512 purpose:any", () => {
    const icons = manifest().icons ?? [];
    expect(icons).toContainEqual(
      expect.objectContaining({
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", purpose: "any" }),
    );
  });

  it("inclut des FICHIERS maskable séparés (192 + 512) — jamais le même fichier que any (#362)", () => {
    const icons = manifest().icons ?? [];
    expect(icons).toContainEqual(
      expect.objectContaining({
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        purpose: "maskable",
      }),
    );
    expect(icons).toContainEqual(
      expect.objectContaining({
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        purpose: "maskable",
      }),
    );
    // Le fichier `any` ne doit JAMAIS être réutilisé en `maskable` (zones de sécurité distinctes).
    const maskable = icons.filter((i) => i.purpose === "maskable");
    for (const icon of maskable) expect(icon.src).toMatch(/-maskable\.png$/u);
  });
});
