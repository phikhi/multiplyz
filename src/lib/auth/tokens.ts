import { randomBytes, randomInt } from "node:crypto";
import { hashSecret, verifySecret } from "./pin";

/**
 * Génération des tokens de session opaques et du code de secours (AUTH.md §3,
 * §5). Aléa CSPRNG. Le token de session est stocké tel quel (source de vérité
 * serveur) ; le code de secours n'est stocké que **haché**.
 */

/** Octets d'un token de session opaque (256 bits d'entropie). */
export const OPAQUE_TOKEN_BYTES = 32;

/** Longueur du code de secours (AUTH.md §5 : 8 caractères). */
export const RECOVERY_CODE_LENGTH = 8;

// Alphabet lisible : sans caractères ambigus (0/O, 1/I/L) pour la saisie parent.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Token de session opaque (aléa CSPRNG, base64url). Posé dans le cookie
 * httpOnly et référencé en base — AUTH.md §3.
 */
export function generateOpaqueToken(byteLength: number = OPAQUE_TOKEN_BYTES): string {
  return randomBytes(byteLength).toString("base64url");
}

/**
 * Code de secours à noter par le parent (AUTH.md §5). `randomInt` = tirage
 * CSPRNG **non biaisé** sur l'alphabet lisible (pas de biais de modulo).
 */
export function generateRecoveryCode(): string {
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return code;
}

// Le code de secours est un credential → seul son hash argon2id est persisté.
export const hashRecoveryCode = hashSecret;
export const verifyRecoveryCode = verifySecret;
