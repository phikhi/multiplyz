import { describe, expect, it } from "vitest";
import { AVATARS, isValidAvatarId } from "./avatars";

describe("avatars (portraits de profil)", () => {
  it("propose plusieurs portraits avec id stable + emoji", () => {
    expect(AVATARS.length).toBeGreaterThan(1);
    for (const avatar of AVATARS) {
      expect(avatar.id).toMatch(/^[a-z]+$/);
      expect(avatar.emoji.length).toBeGreaterThan(0);
    }
  });

  it("garantit des ids uniques (pas de doublon)", () => {
    const ids = AVATARS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("valide un id connu", () => {
    expect(isValidAvatarId(AVATARS[0].id)).toBe(true);
  });

  it("rejette un id inconnu ou vide", () => {
    expect(isValidAvatarId("dragon")).toBe(false);
    expect(isValidAvatarId("")).toBe(false);
  });
});
