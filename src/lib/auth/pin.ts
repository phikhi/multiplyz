import { hash, verify } from "@node-rs/argon2";
import { getAuthConfig } from "@/config/server-config";

/**
 * Couche de hachage des secrets d'auth (PIN enfant/parent, code de secours).
 * argon2id (variante par défaut de `@node-rs/argon2` — vérifiée par le préfixe
 * `$argon2id$` en test), paramètres ⚙️ depuis la config centrale (AUTH.md §3).
 * SERVER-ONLY : jamais importé côté client, jamais de secret en clair persisté.
 */

/** Hash argon2id d'un secret. Sel aléatoire intégré → deux hash diffèrent. */
export async function hashSecret(secret: string): Promise<string> {
  const { argon2 } = getAuthConfig();
  return hash(secret, {
    memoryCost: argon2.memoryCost,
    timeCost: argon2.timeCost,
    parallelism: argon2.parallelism,
  });
}

/**
 * Vérifie un secret contre son hash argon2id. Renvoie `false` (jamais throw) si
 * le hash est absent/malformé → l'appelant traite tout comme « incorrect »
 * (anti-énumération, AUTH.md §4).
 */
export async function verifySecret(hashStr: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashStr, secret);
  } catch {
    return false;
  }
}

// Alias de domaine (lisibilité) — un PIN est un secret comme un autre.
export const hashPin = hashSecret;
export const verifyPin = verifySecret;
