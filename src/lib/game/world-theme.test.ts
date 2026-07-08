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

  // GAP #180 — LA couverture qui manquait (et a laissé passer le défaut #189) : un `assetRefs`
  // SOCLE valide (`socle/<slot>/…`, exactement la forme que le pipeline socle stocke) doit produire
  // un `background` NON-NULL (URL publique). Sans cette garde, le chemin `background !== null`
  // restait dormant. Rougit si la regex/le contrat de ref régresse (ex. namespace `socle` retiré).
  it("assetRefs SOCLE valide (socle/<slot>/background.png) → background NON-NULL = URL publique Nginx (comble le gap #180)", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          background: "socle/0/background.png",
          tiles: "socle/0/tiles.png",
          teddy: "socle/0/teddy.png",
        }),
      }),
    );
    expect(theme.background).not.toBeNull();
    expect(theme.background).toBe(`${WORLD_ASSET_BASE}socle/0/background.png`);
  });

  // CAUSE-RACINE du défaut #189 : un ref stocké en chemin ABSOLU (`/generated/socle/…`, ce que la DB
  // locale contenait à tort) est REFUSÉ par le contrat (préfixe absolu hors namespace `world|socle`)
  // → `background: null` → chemin fond-image DORMANT. Rougit si le contrat se met à accepter l'absolu.
  it("assetRefs en chemin ABSOLU (/generated/socle/0/background.png) → background null (cause-racine du défaut #189)", () => {
    const theme = buildWorldTheme(
      input({ assetRefs: JSON.stringify({ background: "/generated/socle/0/background.png" }) }),
    );
    expect(theme.background).toBeNull();
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

describe("buildWorldTheme — tuiles + Teddy per-monde (story #190, WORLDGEN §4)", () => {
  // GAP FORMAT-RÉEL (extension #189, promue CLAUDE.md) : les DEUX nouvelles refs (`tiles`/`teddy`)
  // exercées avec une entrée au FORMAT RÉEL socle valide → sortie NON-NULL (URL publique). Sans cette
  // garde, le chemin de rendu réel des tuiles/Teddy resterait DORMANT (le piège #189 exactement,
  // rejoué pour les nouvelles refs). Rougit si le contrat de ref régresse (ex. namespace retiré).
  it("assetRefs SOCLE valide → tiles + teddy NON-NULL = URL publique Nginx (chemin format-réel prouvé, extension #189)", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          background: "socle/0/background.png",
          tiles: "socle/0/tiles.png",
          teddy: "socle/0/teddy.png",
        }),
      }),
    );
    expect(theme.tiles).toBe(`${WORLD_ASSET_BASE}socle/0/tiles.png`);
    expect(theme.teddy).toBe(`${WORLD_ASSET_BASE}socle/0/teddy.png`);
  });

  it("assetRefs monde GÉNÉRÉ valide (world/<i>/…) → tiles + teddy NON-NULL = URL publique Nginx", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          tiles: "world/3/tiles.webp",
          teddy: "world/3/teddy.jpg",
        }),
      }),
    );
    expect(theme.tiles).toBe(`${WORLD_ASSET_BASE}world/3/tiles.webp`);
    expect(theme.teddy).toBe(`${WORLD_ASSET_BASE}world/3/teddy.jpg`);
  });

  // CAUSE-RACINE du défaut #189 REJOUÉE pour tiles/teddy : un ref stocké en chemin ABSOLU est REFUSÉ
  // par le contrat (hors namespace `world|socle`) → null → chemin DORMANT. Rougit si l'absolu passe.
  it("tiles/teddy en chemin ABSOLU (/generated/…) → null (cause-racine #189, rejouée par asset)", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          tiles: "/generated/socle/0/tiles.png",
          teddy: "/generated/socle/0/teddy.png",
        }),
      }),
    );
    expect(theme.tiles).toBeNull();
    expect(theme.teddy).toBeNull();
  });

  // GARDE sécurité (mutation-prouvée) : un placeholder (gate owner) n'est JAMAIS rendu → null. Muter
  // `isRenderableAssetRef` pour tout accepter ferait passer tiles/teddy à une URL `placeholder://…`.
  it("tiles/teddy placeholder (gate owner) → null (jamais de fetch d'asset non réel)", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          tiles: "placeholder://socle/0/tiles",
          teddy: "placeholder://socle/0/teddy",
        }),
      }),
    );
    expect(theme.tiles).toBeNull();
    expect(theme.teddy).toBeNull();
  });

  // GARDE sécurité (mutation-prouvée) : une traversée de chemin sur tiles/teddy → null (anti path-traversal).
  it("tiles/teddy avec traversée de chemin → null (anti path-traversal, même garde que le fond)", () => {
    const theme = buildWorldTheme(
      input({
        assetRefs: JSON.stringify({
          tiles: "world/0/../../secret.png",
          teddy: "socle/0/../../etc/teddy.png",
        }),
      }),
    );
    expect(theme.tiles).toBeNull();
    expect(theme.teddy).toBeNull();
  });

  // Effet observable : chaque ref est INDÉPENDANTE — un fond valide n'entraîne pas des tuiles/Teddy
  // présents, et réciproquement. Rougit si `buildWorldTheme` liait à tort les 3 clés (ex. une seule lue).
  it("refs INDÉPENDANTES : fond valide mais tiles/teddy absents → background non-null, tiles/teddy null", () => {
    const theme = buildWorldTheme(
      input({ assetRefs: JSON.stringify({ background: "socle/0/background.png" }) }),
    );
    expect(theme.background).not.toBeNull();
    expect(theme.tiles).toBeNull();
    expect(theme.teddy).toBeNull();
  });

  it.each([
    ["json illisible", "{pas du json"],
    ["json null", "null"],
    ["tiles/teddy absents", "{}"],
    ["tiles/teddy non-string", '{"tiles":42,"teddy":true}'],
  ])("assetRefs %s → tiles + teddy null (tolérant, no-fail)", (_label, assetRefs) => {
    const theme = buildWorldTheme(input({ assetRefs }));
    expect(theme.tiles).toBeNull();
    expect(theme.teddy).toBeNull();
  });
});
