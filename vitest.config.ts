import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // `import "server-only"` est un MARQUEUR de frontière serveur (Next le résout via
      // la condition `react-server` → un module vide `empty.js` ; le bundle client le
      // résout vers `index.js` qui THROW à l'import → fuite impossible côté client). Vitest
      // (Node, sans condition `react-server`) résoudrait `index.js` et casserait le test des
      // modules server-only. On le mappe donc vers `empty.js` (no-op) — même résolution que
      // le serveur Next, la garde anti-fuite restant portée par le bundler client.
      "server-only": resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Restaure tous les `vi.spyOn` à leur implémentation d'origine **avant chaque test** (#193) :
    // règle la classe entière des fuites de spy inter-tests (un `spy.mockRestore()` non gardé posé
    // après une assertion qui lève ne s'exécute jamais → le spy fuit dans le test suivant et DÉPLACE
    // l'échec observé — rétro #186). Avec ce filet global, l'échec d'une mutation atterrit toujours à
    // l'assertion nommée, sans `try/finally` manuel autour de chaque `spyOn`.
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        // layout.tsx = boilerplate framework (rend <html>/<body>, non testable via RTL) ;
        // la seule logique (lecture settings + calcul du thème) est déléguée à `dataThemeAttr`
        // (pure, couverte à 100 %) et le câblage `data-theme` est couvert bout-en-bout par l'E2E.
        "src/app/layout.tsx",
      ],
      // Gate armé : 100 % sur le périmètre couvert. La logique critique
      // (moteur #3 / éco / serveur) reste à 100 % ; l'UI pourra ajuster
      // des seuils par chemin si pragmatique (cf. WORKFLOW §5).
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
