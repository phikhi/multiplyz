/**
 * Génère les assets audio PLACEHOLDER (story 8.4, #257) — bruitages courts + boucle musicale de
 * fond, en PCM WAV 16-bit mono, SANS aucune dépendance externe (patron `generate-icons.mjs` :
 * uniquement les built-in Node — `fs`/`path`/`url`).
 *
 * **Statut honnête (#155)** : ce sont des tonalités sinus SYNTHÉTIQUES, kid-safe (aucun clic —
 * enveloppes de fondu — et volume doux, pas de fichier téléchargé depuis Internet — jamais de
 * source non-vérifiable pour du contenu enfant), déterministes (même sortie à chaque exécution —
 * prouve le CHEMIN format-réel #189 : un vrai conteneur audio valide, pas une fixture `null`).
 * Le moteur (`engine.ts`) est réel + câblé ; la curation d'un vrai pack de sons libres/CC0
 * kid-safe est un gate OWNER séparé (issue `needs-owner`, cf. corps de PR de la story).
 *
 * Usage : node scripts/generate-sound-placeholders.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../public/sounds");

const SAMPLE_RATE = 22050;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

/**
 * Construit un fichier WAV PCM 16-bit mono à partir d'échantillons `Float32` dans `[-1, 1]`.
 * @param {Float32Array} samples
 * @returns {Buffer}
 */
function encodeWav(samples) {
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = samples.length * 2;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // taille sous-chunk fmt
  buffer.writeUInt16LE(1, 20); // audioFormat = PCM
  buffer.writeUInt16LE(NUM_CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * Enveloppe linéaire fondu-entrée/fondu-sortie (évite tout clic — kid-safe, aucune transitoire
 * brutale). `fadeMs` sur chacun des 2 bords (indépendamment de la durée totale).
 */
function fadeEnvelope(index, totalSamples, fadeSamples) {
  if (index < fadeSamples) return index / fadeSamples;
  const fromEnd = totalSamples - 1 - index;
  if (fromEnd < fadeSamples) return fromEnd / fadeSamples;
  return 1;
}

/** Génère une tonalité sinus pure, amplitude douce, fondue aux 2 bords. */
function sineTone(freqHz, durationMs, amplitude, fadeMs = 12) {
  const totalSamples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const fadeSamples = Math.max(1, Math.round((fadeMs / 1000) * SAMPLE_RATE));
  const out = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = fadeEnvelope(i, totalSamples, fadeSamples);
    out[i] = Math.sin(2 * Math.PI * freqHz * t) * amplitude * envelope;
  }
  return out;
}

/** Concatène plusieurs segments `Float32Array` bout à bout. */
function concatSegments(segments) {
  const total = segments.reduce((sum, seg) => sum + seg.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const seg of segments) {
    out.set(seg, offset);
    offset += seg.length;
  }
  return out;
}

/** Mixe 2 tonalités de MÊME longueur (somme, jamais d'écrêtage — encodeWav clampe déjà). */
function mixTones(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

// --- SFX (kid-safe : amplitude douce ≤ 0.22, aucune transitoire brutale) ---

/** Bonne réponse — 2 notes ascendantes brèves, ping amical. */
const correct = concatSegments([sineTone(523.25, 110, 0.2), sineTone(783.99, 160, 0.2)]);

/** Combo/série — 3 notes ascendantes, un peu plus enjouées (série de bonnes réponses). */
const combo = concatSegments([
  sineTone(523.25, 90, 0.18),
  sineTone(659.25, 90, 0.2),
  sineTone(880.0, 180, 0.22),
]);

/** Résultats de niveau — carillon doux à 2 notes. */
const results = concatSegments([sineTone(392.0, 180, 0.18), sineTone(523.25, 260, 0.2)]);

/** Révélation légendaire (analogue le plus proche d'« ouverture d'œuf », cf. `manifest.ts`) —
 *  carillon 3 notes plus riche (2 fréquences mixées par note) et une traîne plus longue. */
const legendary = concatSegments([
  mixTones(sineTone(392.0, 160, 0.16), sineTone(587.33, 160, 0.12)),
  mixTones(sineTone(523.25, 160, 0.16), sineTone(783.99, 160, 0.12)),
  mixTones(sineTone(659.25, 380, 0.18), sineTone(987.77, 380, 0.13)),
]);

// --- Musique (boucle de fond, très douce — nappe à 2 tons, fondue aux 2 bords pour boucler
//     sans accroc quel que soit le déphasage résiduel). ~4s, amplitude ≤ 0.07 (jamais au premier
//     plan — le SFX doit toujours rester net par-dessus). ---
const MUSIC_LOOP_MS = 4000;
const musicPad = mixTones(
  sineTone(220.0, MUSIC_LOOP_MS, 0.05, 180),
  sineTone(329.63, MUSIC_LOOP_MS, 0.035, 180),
);

mkdirSync(resolve(PUBLIC_DIR, "sfx"), { recursive: true });
mkdirSync(resolve(PUBLIC_DIR, "music"), { recursive: true });

writeFileSync(resolve(PUBLIC_DIR, "sfx/correct.wav"), encodeWav(correct));
writeFileSync(resolve(PUBLIC_DIR, "sfx/combo.wav"), encodeWav(combo));
writeFileSync(resolve(PUBLIC_DIR, "sfx/results.wav"), encodeWav(results));
writeFileSync(resolve(PUBLIC_DIR, "sfx/legendary.wav"), encodeWav(legendary));
writeFileSync(resolve(PUBLIC_DIR, "music/play-loop.wav"), encodeWav(musicPad));

console.log(
  "Sons placeholder générés → public/sounds/sfx/{correct,combo,results,legendary}.wav, public/sounds/music/play-loop.wav",
);
