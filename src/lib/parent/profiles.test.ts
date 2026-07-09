import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  attempts,
  characters,
  collection,
  collectionKey,
  ledger,
  mastery,
  masteryKey,
  profiles,
  progress,
  progressKey,
  sessions,
  wallet,
} from "@/lib/db/schema";
import { AVATARS } from "@/config/avatars";
import { createHousehold } from "@/lib/auth/household";
import { verifyPin } from "@/lib/auth/pin";
import {
  deleteProfile,
  listManagedProfiles,
  ProfileManagementError,
  renameProfile,
  resetChildPin,
  type ProfileManagementErrorCode,
} from "./profiles";

let db: AppDatabase;

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});

/**
 * Insère un profil **non-propriétaire** (pas de `parent_pin_hash`) avec un hash placeholder —
 * pas d'argon2 (rapide). Renvoie l'`id` autoincrement.
 */
function insertChild(name: string, avatar = AVATARS[1].id): number {
  const row = db
    .insert(profiles)
    .values({ name, nameKey: name.toLocaleLowerCase("fr-FR"), avatar, pinHash: `hash-${name}` })
    .returning({ id: profiles.id })
    .get();
  return row.id;
}

/** Amorce TOUTES les tables enfant liées à un profil (pour prouver la cascade de purge). */
function seedRelatedData(profileId: number): void {
  db.insert(characters)
    .values({
      id: `legendary:${profileId}`,
      worldIndex: 0,
      speciesKey: `sp_${profileId}`,
      nameDefault: "Bulle",
      rarity: "legendary",
      artRef: "placeholder://c",
    })
    .onConflictDoNothing()
    .run();
  db.insert(mastery)
    .values({ id: masteryKey(profileId, "mult_6x8"), profileId, factId: "mult_6x8", skill: "mult" })
    .run();
  db.insert(attempts)
    .values({ profileId, factId: "mult_6x8", skill: "mult", correct: true, responseMs: 1200 })
    .run();
  db.insert(progress)
    .values({ id: progressKey(profileId, 0, 0), profileId, worldIndex: 0, levelIndex: 0, stars: 2 })
    .run();
  db.insert(wallet).values({ profileId, coins: 40, shards: 10 }).run();
  db.insert(ledger)
    .values({ profileId, direction: "earn", currency: "coins", amount: 20, reason: "level" })
    .run();
  db.insert(collection)
    .values({
      id: collectionKey(profileId, `legendary:${profileId}`),
      profileId,
      characterId: `legendary:${profileId}`,
    })
    .run();
  db.insert(sessions)
    .values({
      token: `tok-${profileId}`,
      profileId,
      kind: "child",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .run();
}

/** Compte les lignes liées à un profil dans toutes les tables enfant (purge = 0 partout). */
function countRelated(profileId: number) {
  const rowsOf = <T extends { profileId: number }>(rows: T[]) =>
    rows.filter((r) => r.profileId === profileId).length;
  return {
    mastery: rowsOf(db.select().from(mastery).all()),
    attempts: rowsOf(db.select().from(attempts).all()),
    progress: rowsOf(db.select().from(progress).all()),
    wallet: rowsOf(db.select().from(wallet).all()),
    ledger: rowsOf(db.select().from(ledger).all()),
    collection: rowsOf(db.select().from(collection).all()),
    sessions: rowsOf(db.select().from(sessions).all()),
  };
}

/** Assertion typée du code d'erreur levé (échoue si aucune erreur / mauvais code). */
async function expectError(
  fn: () => unknown | Promise<unknown>,
  code: ProfileManagementErrorCode,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileManagementError);
    expect((error as ProfileManagementError).code).toBe(code);
    return;
  }
  throw new Error(`attendu ProfileManagementError(${code}), aucune erreur levée`);
}

describe("listManagedProfiles", () => {
  it("marque le propriétaire (parent_pin_hash) et JAMAIS les hash ne sortent", async () => {
    await createHousehold(db, {
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });
    const siblingId = insertChild("Tom");

    const list = listManagedProfiles(db);
    expect(list).toHaveLength(2);
    const lea = list.find((p) => p.name === "Léa")!;
    const tom = list.find((p) => p.name === "Tom")!;
    expect(lea.isOwner).toBe(true); // porte parent_pin_hash
    expect(tom.isOwner).toBe(false); // profil frère/sœur
    expect(tom.id).toBe(siblingId);
    // Projection publique : uniquement id/name/avatar/isOwner, aucun champ *hash*.
    expect(Object.keys(lea).sort()).toEqual(["avatar", "id", "isOwner", "name"]);
    for (const p of list) {
      expect(JSON.stringify(p)).not.toContain("hash");
    }
  });

  it("ordonne par ancienneté (propriétaire en tête)", async () => {
    await createHousehold(db, {
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });
    insertChild("Zoé");
    const list = listManagedProfiles(db);
    expect(list.map((p) => p.name)).toEqual(["Léa", "Zoé"]);
  });
});

describe("renameProfile", () => {
  it("renomme un profil (name + name_key mis à jour)", () => {
    const id = insertChild("Tom");
    renameProfile(db, id, "  Thomas  ");
    const row = db.select().from(profiles).where(eq(profiles.id, id)).get()!;
    expect(row.name).toBe("Thomas"); // trim + espaces compactés
    expect(row.nameKey).toBe("thomas"); // clé NFC + minuscule locale
  });

  it("permet de se renommer avec SA PROPRE valeur (exclusion du profil courant)", () => {
    const id = insertChild("Tom");
    // Pas de NAME_TAKEN contre soi-même — la clé « tom » lui appartient déjà.
    expect(() => renameProfile(db, id, "Tom")).not.toThrow();
  });

  it("refuse un prénom déjà pris par un AUTRE profil (insensible à la casse Unicode)", () => {
    insertChild("Élodie");
    const id = insertChild("Tom");
    // « élodie » = même name_key que « Élodie » (NFC + minuscule locale, ADR 0005).
    return expectError(() => renameProfile(db, id, "élodie"), "NAME_TAKEN");
  });

  it("refuse un prénom vide / trop long / non-string (endpoint public)", async () => {
    const id = insertChild("Tom");
    await expectError(() => renameProfile(db, id, "   "), "NAME_INVALID");
    await expectError(() => renameProfile(db, id, "x".repeat(21)), "NAME_INVALID");
    // Entrée non-string forgée (le typage TS ne protège pas au runtime d'un endpoint public).
    await expectError(() => renameProfile(db, id, 42 as unknown as string), "NAME_INVALID");
  });

  it("profil inexistant → PROFILE_NOT_FOUND (aucune écriture)", () => {
    return expectError(() => renameProfile(db, 999, "Nouveau"), "PROFILE_NOT_FOUND");
  });

  it("GARDE unicité mutation-prouvée : sans le check d'unicité, deux profils partageraient la clé", () => {
    // Ce test rougit si le predicat `NAME_TAKEN` est retiré : renommer Tom en « Léa » DOIT échouer.
    insertChild("Léa");
    const tomId = insertChild("Tom");
    return expectError(() => renameProfile(db, tomId, "Léa"), "NAME_TAKEN").then(() => {
      // Tom reste inchangé (aucune écriture partielle).
      expect(db.select().from(profiles).where(eq(profiles.id, tomId)).get()!.name).toBe("Tom");
    });
  });
});

describe("resetChildPin", () => {
  it("réinitialise le PIN enfant : nouveau hash argon2id vérifiable, ancien PIN ne matche plus", async () => {
    const id = insertChild("Tom");
    const before = db.select().from(profiles).where(eq(profiles.id, id)).get()!.pinHash;

    await resetChildPin(db, id, "5678");

    const after = db.select().from(profiles).where(eq(profiles.id, id)).get()!.pinHash;
    expect(after).not.toBe(before);
    expect(after.startsWith("$argon2id$")).toBe(true); // hashé (jamais en clair)
    expect(after).not.toContain("5678"); // jamais le PIN en clair
    expect(await verifyPin(after, "5678")).toBe(true); // nouveau PIN valide
    expect(await verifyPin(after, "0000")).toBe(false); // un autre PIN ne matche pas
  });

  it("refuse un PIN mal formé (pas 4 chiffres)", async () => {
    const id = insertChild("Tom");
    await expectError(() => resetChildPin(db, id, "12"), "PIN_INVALID");
    await expectError(() => resetChildPin(db, id, "abcd"), "PIN_INVALID");
  });

  it("profil inexistant → PROFILE_NOT_FOUND", () => {
    return expectError(() => resetChildPin(db, 999, "5678"), "PROFILE_NOT_FOUND");
  });

  it("GARDE PIN parent ≠ PIN enfant (propriétaire) : refuse un PIN enfant égal au PIN parent", async () => {
    await createHousehold(db, {
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });
    const owner = listManagedProfiles(db).find((p) => p.isOwner)!;
    // Mutation-preuve : si la garde PARENT_PIN_SAME est retirée, ce reset RÉUSSIRAIT (le PIN
    // enfant deviendrait 9876 = PIN parent, violant AUTH.md §4).
    await expectError(() => resetChildPin(db, owner.id, "9876"), "PARENT_PIN_SAME");
    // Le PIN enfant du propriétaire est resté « 1234 » (aucune écriture).
    const hash = db.select().from(profiles).where(eq(profiles.id, owner.id)).get()!.pinHash;
    expect(await verifyPin(hash, "1234")).toBe(true);
  });

  it("propriétaire : un nouveau PIN enfant DIFFÉRENT du PIN parent est accepté", async () => {
    await createHousehold(db, {
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });
    const owner = listManagedProfiles(db).find((p) => p.isOwner)!;
    await resetChildPin(db, owner.id, "5555");
    const hash = db.select().from(profiles).where(eq(profiles.id, owner.id)).get()!.pinHash;
    expect(await verifyPin(hash, "5555")).toBe(true);
  });
});

describe("deleteProfile — purge RGPD (cascade observable)", () => {
  it("purge TOUTES les tables liées + révoque les sessions, sans toucher un autre profil", () => {
    const victimId = insertChild("Tom");
    const keepId = insertChild("Zoé");
    seedRelatedData(victimId);
    seedRelatedData(keepId);

    // Avant : les deux profils ont des données partout.
    expect(countRelated(victimId)).toEqual({
      mastery: 1,
      attempts: 1,
      progress: 1,
      wallet: 1,
      ledger: 1,
      collection: 1,
      sessions: 1,
    });

    deleteProfile(db, victimId);

    // Le profil est parti + TOUTES ses données liées sont vidées (cascade FK).
    expect(db.select().from(profiles).where(eq(profiles.id, victimId)).get()).toBeUndefined();
    expect(countRelated(victimId)).toEqual({
      mastery: 0,
      attempts: 0,
      progress: 0,
      wallet: 0,
      ledger: 0,
      collection: 0,
      sessions: 0, // session révoquée par la cascade (le token n'ouvre plus rien)
    });
    // L'autre profil est intact (aucune sur-purge).
    expect(db.select().from(profiles).where(eq(profiles.id, keepId)).get()).toBeDefined();
    expect(countRelated(keepId)).toEqual({
      mastery: 1,
      attempts: 1,
      progress: 1,
      wallet: 1,
      ledger: 1,
      collection: 1,
      sessions: 1,
    });
  });

  it("GARDE propriétaire indestructible mutation-prouvée : supprimer l'owner est REFUSÉ", async () => {
    await createHousehold(db, {
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });
    const owner = listManagedProfiles(db).find((p) => p.isOwner)!;
    // Mutation-preuve : si la garde OWNER_UNDELETABLE est retirée, ce DELETE réussirait et
    // détruirait parent_pin_hash + recovery_code_hash (foyer cassé).
    await expectError(() => deleteProfile(db, owner.id), "OWNER_UNDELETABLE");
    // Le propriétaire est toujours là, accès parent préservé.
    const row = db.select().from(profiles).where(eq(profiles.id, owner.id)).get()!;
    expect(row.parentPinHash).not.toBeNull();
    expect(row.recoveryCodeHash).not.toBeNull();
  });

  it("profil inexistant → PROFILE_NOT_FOUND", () => {
    return expectError(() => deleteProfile(db, 999), "PROFILE_NOT_FOUND");
  });
});

describe("garde de forme du profileId (endpoint public)", () => {
  it("profileId non-entier → PROFILE_NOT_FOUND (aucune requête ni écriture)", async () => {
    // `1.5` couvre la branche `!Number.isInteger` ; `"5"` couvre `typeof !== "number"`
    // (le client d'un endpoint public n'est pas contraint par le typage TS au runtime).
    await expectError(() => renameProfile(db, 1.5, "x"), "PROFILE_NOT_FOUND");
    await expectError(
      () => resetChildPin(db, "5" as unknown as number, "1234"),
      "PROFILE_NOT_FOUND",
    );
    await expectError(() => deleteProfile(db, Number.NaN), "PROFILE_NOT_FOUND");
    await expectError(() => deleteProfile(db, "5" as unknown as number), "PROFILE_NOT_FOUND");
  });
});
