/**
 * **Suppression de fond par flood-fill DEPUIS LES BORDS** (fix #329, story #338) — jamais un
 * white-key global (`couleur ≈ blanc → transparent` appliqué à TOUTE l'image), qui mangerait
 * les zones claires **internes** au sujet (ex. le torse/museau crème de Teddy, ART.md §2 « Steiff
 * 80s », CLAUDE.md : « golden-mohair… CREAM/white torso »).
 *
 * Algorithme (magic-wand « contiguous », 4-connexe) :
 * 1. Référence de fond = moyenne des pixels du **périmètre** de l'image (tolère le bruit JPEG).
 * 2. BFS depuis CHAQUE pixel du périmètre : un pixel voisin rejoint le fond seulement s'il est à
 *    une distance euclidienne RGB ≤ `fuzz` de cette référence — donc seule la région de fond
 *    **connectée au bord** devient transparente ; toute zone claire interne (non connectée au
 *    bord par une chaîne de pixels proches du blanc) reste opaque, quelle que soit sa couleur.
 * 3. Alpha binaire (0 ou 255, jamais de dégradé) : un cutout dur évite le halo blanc semi-transparent
 *    d'un feathering mal maîtrisé (CLAUDE.md « pas de fond blanc lourd sur les bords ») ; à la
 *    résolution de rendu réelle (avatar carte ~40px, `--map-node-teddy-size`), l'aliasing pixel du
 *    cutout dur n'est pas perceptible.
 *
 * Pure (aucun I/O) — `fuzz` en distance euclidienne RGB (0..~441). Calibré à 40 pour Teddy socle
 * (marge large : le fond JPEG bruite jusqu'à ~14 de son point moyen, la fourrure crème la plus
 * proche du blanc en est à ~80 — cf. rétro build #338).
 */

export interface FloodFillInput {
  /** Buffer RGB (ou RGBA, seuls les 3 premiers canaux comptent) entrelacé, `channels` par pixel. */
  readonly data: Uint8Array | Buffer;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  /** Distance euclidienne RGB max au fond de référence pour qu'un pixel soit classé "fond". */
  readonly fuzz: number;
}

/**
 * Retourne un buffer **RGBA** (4 canaux) : couleur d'origine inchangée, alpha=0 pour tout pixel
 * classé "fond" (connecté au bord, proche de la référence), alpha=255 sinon (sujet préservé tel
 * quel — jamais de mélange de couleur, cf. commentaire de tête).
 */
export function floodFillTransparency({
  data,
  width,
  height,
  channels,
  fuzz,
}: FloodFillInput): Buffer {
  function colorAt(x: number, y: number): readonly [number, number, number] {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  }

  // Référence de fond = moyenne de TOUS les pixels du périmètre (tolère le bruit de compression JPEG
  // sans dépendre d'un seul coin, qui pourrait être un pixel de bruit atypique).
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let perimeterCount = 0;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const [r, g, b] = colorAt(x, y);
      sumR += r;
      sumG += g;
      sumB += b;
      perimeterCount++;
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const [r, g, b] = colorAt(x, y);
      sumR += r;
      sumG += g;
      sumB += b;
      perimeterCount++;
    }
  }
  const bgRef: readonly [number, number, number] = [
    sumR / perimeterCount,
    sumG / perimeterCount,
    sumB / perimeterCount,
  ];

  function distance2(c: readonly [number, number, number]): number {
    const dr = c[0] - bgRef[0];
    const dg = c[1] - bgRef[1];
    const db = c[2] - bgRef[2];
    return dr * dr + dg * dg + db * db;
  }
  const fuzz2 = fuzz * fuzz;

  const isBackground = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  // BFS explicite (pas de récursion — évite tout risque de dépassement de pile sur une grande image).
  const queue = new Int32Array(width * height);
  let queueTail = 0;

  function tryVisit(x: number, y: number): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const p = y * width + x;
    if (visited[p] === 1) return;
    visited[p] = 1;
    if (distance2(colorAt(x, y)) <= fuzz2) {
      isBackground[p] = 1;
      queue[queueTail++] = p;
    }
  }

  for (let x = 0; x < width; x++) {
    tryVisit(x, 0);
    tryVisit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryVisit(0, y);
    tryVisit(width - 1, y);
  }

  let queueHead = 0;
  while (queueHead < queueTail) {
    const p = queue[queueHead];
    queueHead++;
    const x = p % width;
    const y = Math.floor(p / width);
    tryVisit(x + 1, y);
    tryVisit(x - 1, y);
    tryVisit(x, y + 1);
    tryVisit(x, y - 1);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const srcI = p * channels;
      const dstI = p * 4;
      rgba[dstI] = data[srcI];
      rgba[dstI + 1] = data[srcI + 1];
      rgba[dstI + 2] = data[srcI + 2];
      rgba[dstI + 3] = isBackground[p] === 1 ? 0 : 255;
    }
  }
  return rgba;
}
