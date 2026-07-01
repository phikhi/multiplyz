import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles, sessions } from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { hashPin } from "./pin";
import { authenticateChild, listProfiles, TIMING_EQUALIZER_HASH } from "./login";

let db: AppDatabase;

const T0 = new Date("2026-07-01T10:00:00.000Z");
const PIN = "1234";

async function seedProfile(name: string, avatar: string, pin: string): Promise<number> {
  const pinHash = await hashPin(pin);
  return db.insert(profiles).values({ name, avatar, pinHash }).returning({ id: profiles.id }).get()
    .id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});

describe("listProfiles — projection publique", () => {
  it("renvoie {id, name, avatar} triés par ancienneté, sans aucun secret", async () => {
    await seedProfile("Léa", "fox", PIN);
    await seedProfile("Tom", "rabbit", "5678");

    const list = listProfiles(db);
    expect(list).toEqual([
      { id: expect.any(Number), name: "Léa", avatar: "fox" },
      { id: expect.any(Number), name: "Tom", avatar: "rabbit" },
    ]);
    // Aucun hash ne doit fuiter (AUTH.md §2).
    expect(list[0]).not.toHaveProperty("pinHash");
    expect(list[0]).not.toHaveProperty("parentPinHash");
  });

  it("liste vide quand aucun profil", () => {
    expect(listProfiles(db)).toEqual([]);
  });
});

describe("authenticateChild", () => {
  it("PIN correct → ouvre une session enfant", async () => {
    const id = await seedProfile("Léa", "fox", PIN);
    const created = await authenticateChild(db, id, PIN, T0);

    expect(created).not.toBeNull();
    expect(created?.token.length).toBeGreaterThan(0);
    const stored = db.select().from(sessions).get();
    expect(stored?.profileId).toBe(id);
    expect(stored?.kind).toBe("child");
  });

  it("PIN faux → null, aucune session (anti-énumération)", async () => {
    const id = await seedProfile("Léa", "fox", PIN);
    expect(await authenticateChild(db, id, "0000", T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("profil inconnu → null (indiscernable d'un PIN faux, verify factice)", async () => {
    await seedProfile("Léa", "fox", PIN);
    expect(await authenticateChild(db, 9999, PIN, T0)).toBeNull();
    expect(db.select().from(sessions).get()).toBeUndefined();
  });

  it("profileId non entier → null (garde de forme, endpoint public)", async () => {
    expect(await authenticateChild(db, 1.5, PIN, T0)).toBeNull();
  });

  it("profileId non numérique → null (garde de forme)", async () => {
    expect(await authenticateChild(db, "1" as unknown as number, PIN, T0)).toBeNull();
  });

  it("pin non chaîne → null (garde de forme)", async () => {
    const id = await seedProfile("Léa", "fox", PIN);
    expect(await authenticateChild(db, id, 1234 as unknown as string, T0)).toBeNull();
  });

  // Garde CI : si les défauts argon2 changent sans regénérer le hash factice,
  // le verify « profil inconnu » divergerait en coût → oracle temporel. Ce test
  // casse alors, forçant la mise à jour (anti-énumération, AUTH §4).
  it("le hash factice partage les paramètres argon2id par défaut", () => {
    const { memoryCost, timeCost, parallelism } = CONFIG_DEFAULTS.auth.argon2;
    expect(TIMING_EQUALIZER_HASH).toContain(`m=${memoryCost},t=${timeCost},p=${parallelism}`);
  });
});
