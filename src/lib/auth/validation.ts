/**
 * Validations d'auth réutilisables (AUTH.md §1, §4). Pures, sans I/O — partagées
 * par l'onboarding (#2.2), la connexion (#2.3) et la récupération (#2.5).
 */

/** Longueur verrouillée du PIN (AUTH.md §1 : « PIN 4 chiffres »). */
export const PIN_LENGTH = 4;

/** Longueur du code de secours (AUTH.md §5 : 8 caractères). */
export const RECOVERY_CODE_LENGTH = 8;

// Alphabet lisible du code de secours : sans caractères ambigus (0/O, 1/I/L)
// pour la saisie parent. Source unique (consommée par `tokens.generateRecoveryCode`
// et la validation de la récupération #2.5). Sûr en classe de caractères regex.
export const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Bornes du prénom de profil (single-tenant : unicité gérée en base). */
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 20;

const PIN_PATTERN = /^\d{4}$/;

/** `true` si le PIN est exactement 4 chiffres (AUTH.md §1). */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * Règle verrouillée AUTH.md §4 : le PIN parent doit différer du PIN enfant.
 * Comparaison sur les PIN en clair, AVANT hash (au moment de les poser).
 */
export function parentPinDiffersFromChild(childPin: string, parentPin: string): boolean {
  return childPin !== parentPin;
}

/** Normalise un prénom saisi : trim + espaces internes compactés. */
export function sanitizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Normalise un code de secours saisi (AUTH.md §5) : majuscules + retrait de tout
 * caractère hors alphabet (espaces, tirets de mise en forme) → le parent peut le
 * taper avec sa casse/espacement au hasard.
 */
export function sanitizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `true` si le code **normalisé** a la bonne longueur et un alphabet lisible valide. */
export function isValidRecoveryCodeFormat(raw: string): boolean {
  const code = sanitizeRecoveryCode(raw);
  return (
    code.length === RECOVERY_CODE_LENGTH && [...code].every((c) => RECOVERY_ALPHABET.includes(c))
  );
}

/** `true` si le prénom normalisé respecte les bornes de longueur. */
export function isValidName(raw: string): boolean {
  const name = sanitizeName(raw);
  return name.length >= NAME_MIN_LENGTH && name.length <= NAME_MAX_LENGTH;
}
