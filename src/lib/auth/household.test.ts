import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import { AVATARS } from "@/config/avatars";
import { verifyPin, verifySecret } from "./pin";
import { verifyRecoveryCode } from "./tokens";
import {
  createHousehold,
  householdExists,
  OnboardingError,
  type CreateHouseholdInput,
} from "./household";

const VALID: CreateHouseholdInput = {
  name: "Léa",
  avatar: AVATARS[0].id,
  childPin: "1234",
  parentPin: "9876",
};

let db: AppDatabase;

// Argon2id à mémoire OWASP (~19 MiB) : hash volontairement lent → marge de temps.
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});

function ownerRow() {
  return db.select().from(profiles).all();
}

describe("householdExists", () => {
  it("false quand aucun profil, false quand un profil non-propriétaire seul", () => {
    expect(householdExists(db)).toBe(false);
    // Profil sans parent_pin_hash (frère/sœur potentiel) → pas un propriétaire.
    db.insert(profiles).values({ name: "Tom", avatar: AVATARS[1].id, pinHash: "h" }).run();
    expect(householdExists(db)).toBe(false);
  });

  it("true dès qu'un profil propriétaire (parent_pin_hash) existe", async () => {
    await createHousehold(db, VALID);
    expect(householdExists(db)).toBe(true);
  });
});

describe("createHousehold — succès", () => {
  it("crée le propriétaire, renvoie un code de secours en clair une fois", async () => {
    const result = await createHousehold(db, VALID);
    expect(result.created).toBe(true);
    if (!result.created) throw new Error("attendu created:true");
    expect(result.recoveryCode).toMatch(/^[A-Z0-9]{8}$/);

    const rows = ownerRow();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Léa");
    expect(rows[0].avatar).toBe(AVATARS[0].id);
  });

  it("persiste UNIQUEMENT des hash argon2id (aucun secret en clair)", async () => {
    const result = await createHousehold(db, VALID);
    if (!result.created) throw new Error("attendu created:true");
    const [row] = ownerRow();

    // Jamais le PIN/le code en clair.
    expect(row.pinHash).not.toBe(VALID.childPin);
    expect(row.parentPinHash).not.toBe(VALID.parentPin);
    expect(row.pinHash.startsWith("$argon2id$")).toBe(true);
    expect(row.parentPinHash?.startsWith("$argon2id$")).toBe(true);
    expect(row.recoveryCodeHash?.startsWith("$argon2id$")).toBe(true);

    // Les hash vérifient bien les secrets d'origine.
    expect(await verifyPin(row.pinHash, VALID.childPin)).toBe(true);
    expect(await verifySecret(row.parentPinHash!, VALID.parentPin)).toBe(true);
    expect(await verifyRecoveryCode(row.recoveryCodeHash!, result.recoveryCode)).toBe(true);
  });

  it("normalise le prénom (trim + espaces compactés) avant insertion", async () => {
    await createHousehold(db, { ...VALID, name: "  Lé a  " });
    expect(ownerRow()[0].name).toBe("Lé a");
  });
});

describe("createHousehold — idempotence (AUTH.md §2)", () => {
  it("rejeu sur un foyer existant = no-op, pas de doublon, aucun secret", async () => {
    await createHousehold(db, VALID);
    const replay = await createHousehold(db, { ...VALID, name: "Autre", childPin: "1111" });

    expect(replay.created).toBe(false);
    expect(ownerRow()).toHaveLength(1); // toujours un seul profil
    expect(ownerRow()[0].name).toBe("Léa"); // inchangé
  });
});

describe("createHousehold — validation serveur (rien n'est créé)", () => {
  it("prénom hors bornes → NAME_INVALID", async () => {
    await expect(createHousehold(db, { ...VALID, name: "   " })).rejects.toMatchObject({
      code: "NAME_INVALID",
    });
    expect(ownerRow()).toHaveLength(0);
  });

  it("avatar inconnu → AVATAR_INVALID", async () => {
    await expect(createHousehold(db, { ...VALID, avatar: "dragon" })).rejects.toMatchObject({
      code: "AVATAR_INVALID",
    });
    expect(ownerRow()).toHaveLength(0);
  });

  it("PIN non 4 chiffres (enfant ou parent) → PIN_INVALID", async () => {
    await expect(createHousehold(db, { ...VALID, childPin: "12" })).rejects.toMatchObject({
      code: "PIN_INVALID",
    });
    await expect(createHousehold(db, { ...VALID, parentPin: "abcd" })).rejects.toMatchObject({
      code: "PIN_INVALID",
    });
    expect(ownerRow()).toHaveLength(0);
  });

  it("PIN parent égal au PIN enfant → PARENT_PIN_SAME", async () => {
    await expect(
      createHousehold(db, { ...VALID, childPin: "4321", parentPin: "4321" }),
    ).rejects.toMatchObject({ code: "PARENT_PIN_SAME" });
    expect(ownerRow()).toHaveLength(0);
  });

  it("prénom déjà pris (insensible à la casse) → NAME_TAKEN", async () => {
    // Frère/sœur préexistant, pas encore de propriétaire → la garde d'unicité
    // (pas l'idempotence) doit se déclencher.
    db.insert(profiles).values({ name: "Léa", avatar: AVATARS[1].id, pinHash: "h" }).run();
    await expect(createHousehold(db, { ...VALID, name: "léa" })).rejects.toMatchObject({
      code: "NAME_TAKEN",
    });
    expect(ownerRow()).toHaveLength(1); // rien ajouté
  });

  it("OnboardingError porte bien le code (type d'erreur)", async () => {
    await expect(createHousehold(db, { ...VALID, childPin: "1" })).rejects.toBeInstanceOf(
      OnboardingError,
    );
  });
});
