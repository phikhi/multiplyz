import { describe, expect, it } from "vitest";
import { PaletteError, serializePalette } from "@/lib/worldgen/palette";
import {
  assetPublicUrl,
  buildWorldTheme,
  isRenderableAssetRef,
  WORLD_ASSET_BASE,
  type ResolvedWorldThemeInput,
} from "./world-theme";

/**
 * Tests du **thème per-monde câblé à la carte** (story 6.7, WORLDGEN §4/§7, DESIGN_TOKENS
 * §per-monde). Deux gardes à effet observable :
 * - **sécurité** (`isRenderableAssetRef`) : un ref non conforme (placeholder, schéma, hôte,
 *   traversée `..`) ne devient JAMAIS une URL rendable → `background: null` (fond teinté).
 *   Muter le validateur (accepter tout) rougit les tests « placeholder » / « traversée ».
 * - **forme** (`buildWorldTheme` → `deserializePalette`) : palette mal formée → `PaletteError`.
 */

const OCEAN_PALETTE = serializePalette({ slug: "ocean", accent: "#2BB7E6" });

function input(overrides: Partial<ResolvedWorldThemeInput> = {}): ResolvedWorldThemeInput {
  return {
    theme: "Océan scintillant",
    palette: OCEAN_PALETTE,
    assetRefs: JSON.stringify({
      background: "socle/0/background.png",
      tiles: "socle/0/tiles.png",
      teddy: "socle/0/teddy.png",
    }),
    ...overrides,
  };
}

describe("isRenderableAssetRef (garde sécurité — rendu d'asset)", () => {
  it.each([
    "world/0/background.png",
    "socle/3/background.png",
    "world/12/tiles.jpg",
    "socle/0/teddy.jpeg",
    "world/1/bg.webp",
  ])("accepte un chemin Nginx relatif conforme : %s", (ref) => {
    expect(isRenderableAssetRef(ref)).toBe(true);
  });

  it.each([
    ["placeholder (gate owner, pas un asset réel)", "placeholder://socle/0/background"],
    ["schéma http (hôte externe)", "http://evil.example/x.png"],
    ["protocole-relatif (hôte externe)", "//evil.example/x.png"],
    ["schéma javascript (XSS)", "javascript:alert(1)"],
    ["chemin absolu (hors namespace)", "/etc/passwd"],
    ["namespace inconnu", "secret/0/background.png"],
    ["traversée de chemin", "world/0/../../etc/secret.png"],
    ["traversée simple", "world/../secret.png"],
    ["extension non-image", "world/0/background.svg"],
    ["sans extension", "world/0/background"],
    ["backslash windows", "world\\0\\background.png"],
    ["chaîne vide", ""],
  ])("refuse %s", (_label, ref) => {
    expect(isRenderableAssetRef(ref)).toBe(false);
  });
});

describe("assetPublicUrl (préfixe base Nginx)", () => {
  it("préfixe le ref relatif par la base publique WORLD_ASSET_BASE", () => {
    expect(assetPublicUrl("socle/0/background.png")).toBe(
      `${WORLD_ASSET_BASE}socle/0/background.png`,
    );
  });
});

describe("buildWorldTheme (assemblage validé — palette + fond)", () => {
  it("dérive slug/accent/label depuis la palette + le thème", () => {
    const theme = buildWorldTheme(input());
    expect(theme.slug).toBe("ocean");
    expect(theme.accent).toBe("#2BB7E6");
    expect(theme.label).toBe("Océan scintillant");
  });

  it("fond réel validé → URL publique Nginx (asset rendable)", () => {
    const theme = buildWorldTheme(
      input({ assetRefs: JSON.stringify({ background: "world/2/background.png" }) }),
    );
    expect(theme.background).toBe(`${WORLD_ASSET_BASE}world/2/background.png`);
  });

  // GARDE sécurité (mutation-prouvée) : un placeholder (gate owner) n'est JAMAIS rendu → null.
  // Muter `isRenderableAssetRef` pour accepter tout ferait passer `background` à une URL
  // `placeholder://…` → ce test rougirait.
  it("fond placeholder (gate owner) → background null (fond teinté, jamais de fetch)", () => {
    const theme = buildWorldTheme(
      input({ assetRefs: JSON.stringify({ background: "placeholder://socle/0/background" }) }),
    );
    expect(theme.background).toBeNull();
  });

  // GARDE sécurité (mutation-prouvée) : une traversée de chemin → null (jamais fetchée).
  it("fond avec traversée de chemin → background null (anti path-traversal)", () => {
    const theme = buildWorldTheme(
      input({ assetRefs: JSON.stringify({ background: "world/0/../../secret.png" }) }),
    );
    expect(theme.background).toBeNull();
  });

  it.each([
    ["json illisible", "{pas du json"],
    ["json null", "null"],
    ["json string (pas un objet)", '"socle/0/background.png"'],
    ["background absent", "{}"],
    ["background non-string", '{"background":42}'],
  ])("assetRefs %s → background null (tolérant, no-fail)", (_label, assetRefs) => {
    expect(buildWorldTheme(input({ assetRefs })).background).toBeNull();
  });

  it("palette mal formée → PaletteError (défense en profondeur DB)", () => {
    expect(() => buildWorldTheme(input({ palette: '{"slug":"x","accent":"pasHex"}' }))).toThrow(
      PaletteError,
    );
  });
});
