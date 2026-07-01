/**
 * Portraits de profil (choix à la création — PRODUCT.md §1.1 « choix d'avatar »).
 *
 * Cosmétique pur, **zéro avantage de jeu** (PRODUCT.md §Personnalisation). On
 * stocke l'`id` **stable** en base (`profiles.avatar`), jamais l'emoji : l'emoji
 * n'est qu'une représentation d'affichage, remplaçable par un vrai visuel IA
 * plus tard (ART) sans migration de données.
 *
 * Placeholder emoji ⚙️ : jeu à figer au playtest / à remplacer par les portraits
 * définitifs (ART) — l'`id` reste le contrat.
 */
export interface AvatarOption {
  /** Identifiant stable persisté (`profiles.avatar`). */
  readonly id: string;
  /** Représentation d'affichage (emoji placeholder). */
  readonly emoji: string;
}

/** Jeu de portraits proposés au 1er usage. Kid-safe, neutres. */
export const AVATARS: readonly AvatarOption[] = [
  { id: "fox", emoji: "🦊" },
  { id: "rabbit", emoji: "🐰" },
  { id: "panda", emoji: "🐼" },
  { id: "cat", emoji: "🐱" },
  { id: "frog", emoji: "🐸" },
  { id: "owl", emoji: "🦉" },
  { id: "penguin", emoji: "🐧" },
  { id: "unicorn", emoji: "🦄" },
] as const;

/** `true` si `id` correspond à un portrait proposé (sanitisation serveur). */
export function isValidAvatarId(id: string): boolean {
  return AVATARS.some((avatar) => avatar.id === id);
}
