/**
 * Service worker personnalisé multiplyz — coquille online-first.
 *
 * Stratégie :
 *  - Install   : précache la coquille (root + icônes).
 *  - Activate  : purge les anciens caches.
 *  - /api/*    : JAMAIS mis en cache (online-first strict, serveur = source de vérité).
 *  - /_next/static/* : réseau d'abord, cache en repli hors-ligne. (Cache-first
 *    cassait le dev : les chunks Turbopack ne sont PAS immuables — même URL après
 *    édition → un chunk périmé était servi. Réseau d'abord = toujours frais en ligne.)
 *  - Navigation (HTML) : réseau d'abord ; si hors-ligne, fallback vers le « / » en cache.
 *
 * NE PAS utiliser next-pwa : incompatible Next 16 + Turbopack (cf. STACK.md §Frontend).
 * SW custom = choix sanctionné par la spec.
 *
 * Ce fichier est exclu de la couverture Vitest : contexte ServiceWorker (global `self`),
 * non émulable par jsdom. La logique est volontairement minimale pour rester testable
 * indirectement via les tests d'enregistrement et E2E.
 */

// v2 : bascule des assets /_next/static en réseau-d'abord. Le bump purge le
// cache v1 (chunks dev périmés) au moment de l'activate.
const CACHE_NAME = "mz-shell-v2";

/** URLs précachées à l'installation (coquille statique uniquement). */
const SHELL_URLS = ["/", "/icon-192.png", "/icon-512.png"];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { method } = event.request;

  // Ignorer les non-GET (POST, etc.)
  if (method !== "GET") return;

  const url = new URL(event.request.url);

  // /api/* → toujours réseau, jamais de cache (données de jeu, online-first)
  if (url.pathname.startsWith("/api/")) return;

  // Assets statiques Next.js : réseau d'abord (frais en ligne, dev inclus),
  // cache en repli hors-ligne uniquement.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Ne cache que les réponses valides (évite de cacher un 404/5xx)
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  // Navigation HTML : réseau d'abord, fallback coquille si hors-ligne
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/").then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }
});
