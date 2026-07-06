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
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        // layout.tsx = boilerplate framework (rend <html>/<body>, non testable via RTL).
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
