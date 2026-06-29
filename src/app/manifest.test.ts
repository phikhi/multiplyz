import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { BRAND_NAME } from "@/config/brand";
import { PWA_BG_COLOR, PWA_THEME_COLOR } from "@/config/pwa";

describe("manifest (PWA)", () => {
  it("retourne un manifest valide avec le nom de la marque", () => {
    const m = manifest();
    expect(m.name).toBe(BRAND_NAME);
    expect(m.short_name).toBe(BRAND_NAME);
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
    const m = manifest();
    expect(m.start_url).toBe("/");
  });

  it("inclut les deux icônes (192 et 512)", () => {
    const m = manifest();
    const icons = m.icons ?? [];
    expect(icons).toHaveLength(2);
    expect(icons[0]).toMatchObject({ src: "/icon-192.png", sizes: "192x192", type: "image/png" });
    expect(icons[1]).toMatchObject({ src: "/icon-512.png", sizes: "512x512", type: "image/png" });
  });
});
