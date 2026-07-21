import { describe, it, expect } from "vitest";
import { floodFillTransparency } from "./flood-fill-transparency";

/**
 * Palette des images synthétiques : `W` = fond blanc, `S` = sujet (brun, LOIN du blanc),
 * `L` = îlot clair INTERNE — dans le `fuzz` du blanc mais **enclos** par du sujet. `L` est le
 * pixel discriminant du fix #329 : un white-key GLOBAL le rendrait transparent (il est clair),
 * le flood-fill DEPUIS LES BORDS le garde opaque (il n'est pas connecté au bord).
 */
const PALETTE: Record<string, readonly [number, number, number]> = {
  W: [250, 250, 250],
  S: [150, 100, 50],
  L: [245, 245, 245],
};

function buildImage(rows: readonly string[]): {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
} {
  const height = rows.length;
  const width = rows[0].length;
  const channels = 3;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = PALETTE[rows[y][x]];
      const i = (y * width + x) * channels;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return { data, width, height, channels };
}

const alphaAt = (rgba: Buffer, width: number, x: number, y: number): number =>
  rgba[(y * width + x) * 4 + 3];

describe("floodFillTransparency (#329 — détourage depuis les bords)", () => {
  it("rend transparent le fond connecté au bord ET garde OPAQUE un îlot clair INTERNE (garde anti-white-key)", () => {
    // Îlot clair `L` (dans le fuzz du blanc) totalement enclos par le sujet `S` → le flood ne peut
    // pas l'atteindre depuis le bord. Un white-key GLOBAL le rendrait transparent (régression #329).
    const rows = ["WWWWWWW", "WWWWWWW", "WWSSSWW", "WWSLSWW", "WWSSSWW", "WWWWWWW", "WWWWWWW"];
    const img = buildImage(rows);
    const out = floodFillTransparency({ ...img, fuzz: 40 });

    // Fond connecté au bord → TRANSPARENT (alpha 0).
    expect(alphaAt(out, img.width, 0, 0)).toBe(0); // coin
    expect(alphaAt(out, img.width, 3, 0)).toBe(0); // bord haut, au-dessus de la colonne de l'îlot
    expect(alphaAt(out, img.width, 1, 3)).toBe(0); // blanc atteint par le flood, juste avant l'anneau S

    // ▶▶ LA garde #329 : l'îlot clair INTERNE reste OPAQUE (le flood ne l'atteint pas). ◀◀
    // Rougit si l'algorithme régresse en white-key global (L clair → deviendrait transparent).
    expect(alphaAt(out, img.width, 3, 3)).toBe(255);

    // Sujet (brun, loin du blanc) → OPAQUE.
    expect(alphaAt(out, img.width, 2, 2)).toBe(255);
  });

  it("classe le fond au SEUIL EXACT de fuzz (<=) et exclut juste au-dessus (garde de borne)", () => {
    const width = 5;
    const height = 5;
    const channels = 3;
    const data = new Uint8Array(width * height * channels);
    for (let i = 0; i < data.length; i += 3) {
      data[i] = 250;
      data[i + 1] = 250;
      data[i + 2] = 250;
    }
    const setPx = (x: number, y: number, r: number, g: number, b: number): void => {
      const i = (y * width + x) * channels;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    };
    // bgRef = blanc pur (tout le périmètre est blanc). Deux pixels internes, connectés au bord :
    setPx(2, 2, 210, 250, 250); // distance = 40 EXACTEMENT du blanc
    setPx(1, 3, 209, 250, 250); // distance = 41 (juste au-dessus du seuil)
    const out = floodFillTransparency({ data, width, height, channels, fuzz: 40 });
    const a = (x: number, y: number): number => out[(y * width + x) * 4 + 3];

    // 40 <= 40 → fond → transparent. Muter `<=` en `<` le rendrait opaque → cette ligne rougit.
    expect(a(2, 2)).toBe(0);
    // 41 > 40 → sujet → opaque. Garde le seuil « pas trop lâche » (rougit si le seuil s'élargit).
    expect(a(1, 3)).toBe(255);
    // Coin blanc → transparent (sanity).
    expect(a(0, 0)).toBe(0);
  });
});
