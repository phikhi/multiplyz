import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles, sessions } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { hashPin, hashSecret } from "./pin";
import { authenticateParent, guardedAuthenticateParent } from "./parent-login";
import { attemptKey, getAttemptState, recordFailure } from "./pin-attempts";

let db: AppDatabase;

const T0 = new Date("2026-07-01T10:00:00.000Z");
const CHILD_PIN = "1234";
const PARENT_PIN = "9876";

/** Clé de rate-limit parent (cible fixe `parent`) — pinne le scope observable du garde. */
const PARENT_KEY = attemptKey("profile", "parent");

/** Seed le profil **propriétaire** (porte `parent_pin_hash`) + PIN enfant distinct. */
async function seedOwner(childPin = CHILD_PIN, parentPin = PARENT_PIN): Promise<number> {
  const [pinHash, parentPinHash] = await Promise.all([hashPin(childPin), hashSecret(parentPin)]);
  return db
    .insert(profiles)
    .values({ name: "Léa", nameKey: "léa", avatar: "fox", pinHash, parentPinHash })
    .returning({ id: profiles.id })
    .get().id;
}

/** Seed un profil enfant SANS PIN parent (frère/sœur, AUTH §1) — jamais l'owner. */
async function seedChildOnly(name: string, pin: string): Promise<number> {
  const pinHash = await hashPin(pin);
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "rabbit", pinHash })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});

describe("authenticateParent", () => {
  it("PIN parent correct → ouvre une session PARENT (kind='parent', courte)", async () => {
    const id = await seedOwner();
    const created = await authenticateParent(db, PARENT_PIN, T0);

    expect(created).not.toBeNull();
    expect(created?.token.length).toBeGreaterThan(0);
    const stored = db.select().from(sessions).get();
    expect(stored?.profileId).toBe(id);
    // SÉCU : la session ouverte est bien de kind PARENT (jamais child) — échéance courte.
    expect(stored?.kind).toBe("parent");
    const expectedMs = getAuthConfig().parentSessionMs;
    expect(created?.expiresAt.getTime()).toBe(T0.getTime() + expectedMs);
  });

  it("PIN parent faux → null, aucune session (anti-énumération)", async () => {
    await seedOwner();
    expect(await authenticateParent(db, "0000", T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("le PIN ENFANT ne connecte PAS l'espace parent (PIN parent distinct, AUTH §1/§4)", async () => {
    await seedOwner(CHILD_PIN, PARENT_PIN);
    // Le PIN enfant est un secret DIFFÉRENT du PIN parent → refusé côté parent.
    expect(await authenticateParent(db, CHILD_PIN, T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("foyer absent (aucun owner) → null (verify factice, temps constant)", async () => {
    // Base vierge : aucun profil ne porte parent_pin_hash → pas d'owner.
    expect(await authenticateParent(db, PARENT_PIN, T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("profil enfant seul (sans PIN parent) → pas d'owner → null (jamais traité en owner)", async () => {
    await seedChildOnly("Tom", "5678");
    expect(await authenticateParent(db, "5678", T0)).toBeNull();
    expect(await authenticateParent(db, PARENT_PIN, T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("pin non chaîne → null (garde de forme, endpoint public)", async () => {
    await seedOwner();
    expect(await authenticateParent(db, 9876 as unknown as string, T0)).toBeNull();
  });
});

describe("guardedAuthenticateParent — rate-limit + backoff (AUTH §4)", () => {
  const IP = "1.2.3.4";
  const rateLimit = getAuthConfig().rateLimit;

  it("bon PIN, pas de backoff → session + compteurs (parent ET IP) réinitialisés", async () => {
    await seedOwner();
    const created = await guardedAuthenticateParent(db, { pin: PARENT_PIN, ip: IP }, T0);

    expect(created).not.toBeNull();
    expect(getAttemptState(db, PARENT_KEY)).toBeNull();
    expect(getAttemptState(db, attemptKey("ip", IP))).toBeNull();
  });

  it("PIN faux → null + incrémente les compteurs cible-parent ET IP", async () => {
    await seedOwner();
    const result = await guardedAuthenticateParent(db, { pin: "0000", ip: IP }, T0);

    expect(result).toBeNull();
    expect(getAttemptState(db, PARENT_KEY)?.failures).toBe(1);
    expect(getAttemptState(db, attemptKey("ip", IP))?.failures).toBe(1);
  });

  it("cible parent en backoff (≥ seuil) → refus SANS vérifier le PIN (même un bon PIN)", async () => {
    await seedOwner();
    for (let i = 0; i < rateLimit.maxAttemptsPerProfile; i++) recordFailure(db, PARENT_KEY, T0);

    const result = await guardedAuthenticateParent(db, { pin: PARENT_PIN, ip: IP }, T0);

    expect(result).toBeNull(); // bloqué : le bon PIN n'est pas honoré
    // Compteur inchangé : le chemin bloqué retourne avant d'enregistrer un échec.
    expect(getAttemptState(db, PARENT_KEY)?.failures).toBe(rateLimit.maxAttemptsPerProfile);
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("IP en backoff (cible parent saine) → refus aussi", async () => {
    await seedOwner();
    const ipKey = attemptKey("ip", IP);
    for (let i = 0; i < rateLimit.maxAttemptsPerIp; i++) recordFailure(db, ipKey, T0);

    const result = await guardedAuthenticateParent(db, { pin: PARENT_PIN, ip: IP }, T0);
    expect(result).toBeNull();
  });

  it("après le délai de backoff, le bon PIN réussit et réinitialise le compteur", async () => {
    await seedOwner();
    for (let i = 0; i < rateLimit.maxAttemptsPerProfile; i++) recordFailure(db, PARENT_KEY, T0);

    const later = new Date(T0.getTime() + rateLimit.backoffMaxMs + 1000);
    const created = await guardedAuthenticateParent(db, { pin: PARENT_PIN, ip: IP }, later);

    expect(created).not.toBeNull();
    expect(getAttemptState(db, PARENT_KEY)).toBeNull(); // réinitialisé au succès
  });
});
