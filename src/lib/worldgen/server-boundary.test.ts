import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde de **frontière serveur** (story 6.1, sécurité) — non-régression : le client image
 * (`image-client.ts`) porte le secret Gemini (`GEMINI_API_KEY`) et l'URL de l'API ; il ne
 * doit **jamais** fuir dans le bundle client.
 *
 * Deux gardes à effet observable :
 * 1. `image-client.ts` **déclare** `import "server-only"` (marqueur : le bundler client
 *    résout ce paquet vers un module qui *throw* à l'import → import client impossible).
 * 2. **Aucun** composant client (`"use client"`) n'importe le client image ni ne référence
 *    le secret/entête d'API — un grep récursif sur tout `src/` (rouge si un futur agent
 *    câble le client image, la clé, ou l'entête `x-goog-api-key` dans un fichier `"use client"`).
 */

const SRC = resolve(__dirname, "../..");
const IMAGE_CLIENT = resolve(__dirname, "./image-client.ts");

/** Liste récursive des fichiers `.ts`/`.tsx` sous `dir` (tests exclus). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Un fichier est-il un composant CLIENT ? (`"use client"` en tête). */
function isClientComponent(content: string): boolean {
  // La directive doit être un littéral de tête (avant tout import) — on cherche la forme exacte.
  return /^\s*(["'])use client\1/m.test(content);
}

describe("frontière serveur du client image (sécurité, story 6.1)", () => {
  it('image-client.ts déclare `import "server-only"` (interdiction d\'import client)', () => {
    const content = readFileSync(IMAGE_CLIENT, "utf-8");
    expect(content).toMatch(/import\s+["']server-only["']/);
  });

  it("AUCUN composant client (`use client`) n'importe le client image (non-régression)", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => isClientComponent(readFileSync(f, "utf-8")))
      .filter((f) => /worldgen\/image-client/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("AUCUN composant client ne référence GEMINI_API_KEY ni l'entête x-goog-api-key", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => isClientComponent(readFileSync(f, "utf-8")))
      .filter((f) => {
        const c = readFileSync(f, "utf-8");
        return c.includes("GEMINI_API_KEY") || c.includes("x-goog-api-key");
      });
    expect(offenders).toEqual([]);
  });

  it("le scanner détecte bien un composant client (garde non vacuous)", () => {
    // Sanity : au moins un `"use client"` existe dans src/ → le filtre n'est pas vide par erreur
    // (sinon les deux gardes ci-dessus passeraient trivialement sur un ensemble vide).
    const clientFiles = sourceFiles(SRC).filter((f) => isClientComponent(readFileSync(f, "utf-8")));
    expect(clientFiles.length).toBeGreaterThan(0);
  });
});
