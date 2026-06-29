import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
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
        "src/app/layout.tsx",
        // Page démo de scaffold (#11) et son composant de bascule :
        // visuels purs validés par Playwright (captures light/dark).
        // Seront remplacés par les écrans produit dans les epics suivants.
        "src/app/page.tsx",
        "src/components/ThemeToggle.tsx",
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
