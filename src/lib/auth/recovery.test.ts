import { beforeEach, describe, expect, it } from "vitest";
import { isNotNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { AVATARS } from "@/config/avatars";
import { createHousehold } from "./household";
import { verifyPin } from "./pin";
import { attemptKey, recordFailure } from "./pin-attempts";
import { guardedVerifyRecovery, RecoveryError, resetParentPin, verifyRecovery } from "./recovery";

let db: AppDatabase;
let recoveryCode: string;

const IP = "1.2.3.4";
const T0 = new Date("2026-07-01T10:00:00.000Z");
const CHILD_PIN = "1234";
const PARENT_PIN = "9876";
const rateLimit = getAuthConfig().rateLimit;

beforeEach(async () => {
  db = createDatabase(":memory:");
  runMigrations(db);
  const result = await createHousehold(db, {
    name: "Léa",
    avatar: AVATARS[0].id,
    childPin: CHILD_PIN,
    parentPin: PARENT_PIN,
  });
  if (!result.created) throw new Error("seed foyer attendu");
  recoveryCode = result.recoveryCode;
});

function ownerParentHash(): string {
  const row = db
    .select({ parentPinHash: profiles.parentPinHash })
    .from(profiles)
    .where(isNotNull(profiles.parentPinHash))
    .get();
  return row?.parentPinHash ?? "";
}

describe("guardedVerifyRecovery", () => {
  it("bon code → renvoie le propriétaire + réinitialise les compteurs", async () => {
    const owner = await guardedVerifyRecovery(db, recoveryCode, IP, T0);
    expect(owner).not.toBeNull();
    expect(owner?.id).toBeTypeOf("number");
  });

  it("code insensible à la casse/espaces via sanitisation en amont (verifyRecovery)", async () => {
    // verifyRecovery sanitise ; ici on vérifie que le code brut (déjà normalisé) marche.
    expect(await verifyRecovery(db, `  ${recoveryCode.toLowerCase()} `, IP, T0)).toBe(true);
  });

  it("mauvais code → null (générique)", async () => {
    expect(await guardedVerifyRecovery(db, "WRONGCOD", IP, T0)).toBeNull();
  });

  it("foyer absent → null (verify factice à temps constant, pas de crash)", async () => {
    const empty = createDatabase(":memory:");
    runMigrations(empty);
    expect(await guardedVerifyRecovery(empty, recoveryCode, IP, T0)).toBeNull();
  });

  it("récupération en backoff → null même avec le bon code (sans vérifier)", async () => {
    const recKey = attemptKey("recovery", "owner");
    for (let i = 0; i < rateLimit.maxAttemptsPerProfile; i++) recordFailure(db, recKey, T0);
    expect(await guardedVerifyRecovery(db, recoveryCode, IP, T0)).toBeNull();
  });

  it("IP en backoff (récupération saine) → null aussi", async () => {
    const ipKey = attemptKey("ip", IP);
    for (let i = 0; i < rateLimit.maxAttemptsPerIp; i++) recordFailure(db, ipKey, T0);
    expect(await guardedVerifyRecovery(db, recoveryCode, IP, T0)).toBeNull();
  });
});

describe("verifyRecovery (étape 1)", () => {
  it("bon code → true", async () => {
    expect(await verifyRecovery(db, recoveryCode, IP, T0)).toBe(true);
  });

  it("code non chaîne → false (garde de forme)", async () => {
    expect(await verifyRecovery(db, 12345678 as unknown as string, IP, T0)).toBe(false);
  });
});

describe("resetParentPin", () => {
  it("bon code → pose le nouveau PIN parent + régénère un code de secours", async () => {
    const before = ownerParentHash();
    const { recoveryCode: fresh } = await resetParentPin(
      db,
      { code: recoveryCode, newParentPin: "1111", ip: IP },
      T0,
    );

    expect(fresh).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(fresh).not.toBe(recoveryCode); // ancien code consommé

    const after = ownerParentHash();
    expect(after).not.toBe(before); // le PIN parent a changé
    expect(await verifyPin(after, "1111")).toBe(true);
    expect(await verifyPin(after, PARENT_PIN)).toBe(false); // ancien PIN ne marche plus
  });

  it("l'ancien code de secours ne fonctionne plus après reset ; le nouveau si", async () => {
    const { recoveryCode: fresh } = await resetParentPin(
      db,
      { code: recoveryCode, newParentPin: "1111", ip: IP },
      T0,
    );
    expect(await verifyRecovery(db, recoveryCode, IP, T0)).toBe(false); // ancien
    expect(await verifyRecovery(db, fresh, IP, T0)).toBe(true); // nouveau
  });

  it("mauvais code → CODE_INVALID (générique), aucun reset", async () => {
    const before = ownerParentHash();
    await expect(
      resetParentPin(db, { code: "WRONGCOD", newParentPin: "1111", ip: IP }, T0),
    ).rejects.toThrow(RecoveryError);
    expect(ownerParentHash()).toBe(before);
  });

  it("nouveau PIN non conforme (pas 4 chiffres) → PIN_INVALID", async () => {
    await expect(
      resetParentPin(db, { code: recoveryCode, newParentPin: "12", ip: IP }, T0),
    ).rejects.toMatchObject({ code: "PIN_INVALID" });
  });

  it("nouveau PIN parent = PIN enfant → PARENT_PIN_SAME", async () => {
    await expect(
      resetParentPin(db, { code: recoveryCode, newParentPin: CHILD_PIN, ip: IP }, T0),
    ).rejects.toMatchObject({ code: "PARENT_PIN_SAME" });
  });

  it("PIN non chaîne → CODE_INVALID (garde de forme)", async () => {
    await expect(
      resetParentPin(
        db,
        { code: recoveryCode, newParentPin: 1111 as unknown as string, ip: IP },
        T0,
      ),
    ).rejects.toMatchObject({ code: "CODE_INVALID" });
  });

  it("code non chaîne → CODE_INVALID (garde de forme)", async () => {
    await expect(
      resetParentPin(db, { code: null as unknown as string, newParentPin: "1111", ip: IP }, T0),
    ).rejects.toMatchObject({ code: "CODE_INVALID" });
  });

  it("récupération en backoff → CODE_INVALID (générique)", async () => {
    const recKey = attemptKey("recovery", "owner");
    for (let i = 0; i < rateLimit.maxAttemptsPerProfile; i++) recordFailure(db, recKey, T0);
    await expect(
      resetParentPin(db, { code: recoveryCode, newParentPin: "1111", ip: IP }, T0),
    ).rejects.toMatchObject({ code: "CODE_INVALID" });
  });
});
