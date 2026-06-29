import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Zéro texte en dur dans l'UI : tout littéral visible passe par `src/strings`.
    // Les fichiers de test (qui assertent contre les constantes) sont exclus.
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.{test,spec}.tsx"],
    rules: {
      "react/jsx-no-literals": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
