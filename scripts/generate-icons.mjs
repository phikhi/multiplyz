/**
 * Génère les icônes PWA (192×192 et 512×512) en PNG solide couleur primaire.
 * Couleur : #7A5AF8 (--color-accent-primary light, cf. tokens.css).
 * Aucune dépendance externe — utilise uniquement Node.js built-in (zlib, fs, path).
 *
 * Usage : node scripts/generate-icons.mjs
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public");

/**
 * CRC32 — requis par la spécification PNG pour chaque chunk.
 * @param {Uint8Array} buf
 * @returns {number}
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Crée un chunk PNG (longueur + type + données + CRC).
 * @param {string} type  4 caractères ASCII
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * Génère un PNG RVB couleur unie sans dépendance externe.
 * @param {number} width
 * @param {number} height
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {Buffer}
 */
function makeSolidPng(width, height, r, g, b) {
  // Signature PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR : 13 octets (width, height, bit-depth=8, color-type=2=RGB, compression=0, filter=0, interlace=0)
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Données brutes : filtre 0 (None) en tête de chaque ligne + pixels RGB
  const rowSize = 1 + width * 3;
  const raw = Buffer.allocUnsafe(height * rowSize);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    raw[base] = 0; // filtre None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Violet primaire — --color-accent-primary light (tokens.css)
const R = 0x7a;
const G = 0x5a;
const B = 0xf8;

mkdirSync(PUBLIC_DIR, { recursive: true });

writeFileSync(resolve(PUBLIC_DIR, "icon-192.png"), makeSolidPng(192, 192, R, G, B));
writeFileSync(resolve(PUBLIC_DIR, "icon-512.png"), makeSolidPng(512, 512, R, G, B));

console.log("PWA icons generated → public/icon-192.png, public/icon-512.png");
