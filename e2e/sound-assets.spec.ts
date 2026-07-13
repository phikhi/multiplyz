import { expect, test } from "@playwright/test";

/**
 * Preuve NAVIGATEUR RÉEL du chemin format-réel (#189, story 8.4 #257 AC #5) — complète
 * `src/lib/sound/assets.test.ts` (magic bytes RIFF/WAVE côté Node) par un décodage RÉEL en
 * Chromium (`AudioContext.decodeAudioData`) : un WAV corrompu/mal-formé romprait le décodage
 * même si les octets de tête ressemblaient à un RIFF valide. Fichier standalone (pas de session
 * requise — assets `public/**` servis sans garde d'auth, aucune dépendance à l'état single-tenant
 * partagé de `auth.spec.ts`).
 */
const SOUND_ASSETS = [
  "/sounds/sfx/correct.wav",
  "/sounds/sfx/combo.wav",
  "/sounds/sfx/results.wav",
  "/sounds/sfx/legendary.wav",
  "/sounds/music/play-loop.wav",
];

for (const assetPath of SOUND_ASSETS) {
  test(`${assetPath} — servi (200, Content-Type audio) et DÉCODABLE par un vrai navigateur (#189)`, async ({
    page,
    request,
  }) => {
    const res = await request.get(assetPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/^audio\//u);

    await page.goto("/");
    const decoded = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const AudioContextCtor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor!();
      try {
        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        return { ok: true, durationMs: Math.round(decodedBuffer.duration * 1000) };
      } finally {
        await ctx.close();
      }
    }, assetPath);

    expect(decoded.ok).toBe(true);
    // Durée strictement positive — un décodage "réussi" sur un buffer vide/corrompu produirait
    // une durée nulle ou lèverait déjà dans `decodeAudioData` (capté par `decoded.ok`).
    expect(decoded.durationMs).toBeGreaterThan(0);
  });
}
