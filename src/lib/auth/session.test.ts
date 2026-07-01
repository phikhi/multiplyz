import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles, sessions } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { createSession, getValidSession, revokeSession } from "./session";

let db: AppDatabase;
let profileId: number;

const T0 = new Date("2026-07-01T10:00:00.000Z");

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  // Un profil est requis (FK sessions.profile_id → profiles.id, ON activé).
  const row = db
    .insert(profiles)
    .values({ name: "Léa", avatar: "fox", pinHash: "h" })
    .returning({ id: profiles.id })
    .get();
  profileId = row.id;
});

describe("createSession", () => {
  it("ouvre une session enfant : token opaque + échéance = now + durée enfant", () => {
    const { childSessionMs } = getAuthConfig();
    const { token, expiresAt } = createSession(db, profileId, "child", T0);

    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt.getTime()).toBe(T0.getTime() + childSessionMs);

    const stored = db.select().from(sessions).get();
    expect(stored?.token).toBe(token);
    expect(stored?.profileId).toBe(profileId);
    expect(stored?.kind).toBe("child");
  });

  it("session parent = durée courte (≠ enfant)", () => {
    const { parentSessionMs } = getAuthConfig();
    const { expiresAt } = createSession(db, profileId, "parent", T0);
    expect(expiresAt.getTime()).toBe(T0.getTime() + parentSessionMs);
  });
});

describe("getValidSession", () => {
  it("renvoie la session tant qu'elle n'est pas expirée", () => {
    const { token } = createSession(db, profileId, "child", T0);
    const found = getValidSession(db, token, new Date(T0.getTime() + 1000));
    expect(found?.token).toBe(token);
    expect(found?.profileId).toBe(profileId);
    expect(found?.kind).toBe("child");
  });

  it("null si la session est expirée (indiscernable d'un token inconnu)", () => {
    const { parentSessionMs } = getAuthConfig();
    const { token } = createSession(db, profileId, "parent", T0);
    const after = new Date(T0.getTime() + parentSessionMs + 1000);
    expect(getValidSession(db, token, after)).toBeNull();
  });

  it("null si le token n'existe pas", () => {
    expect(getValidSession(db, "inconnu", T0)).toBeNull();
  });
});

describe("revokeSession", () => {
  it("supprime la session ciblée", () => {
    const { token } = createSession(db, profileId, "child", T0);
    revokeSession(db, token);
    expect(getValidSession(db, token, new Date(T0.getTime() + 1000))).toBeNull();
  });

  it("no-op silencieux sur un token absent (idempotent)", () => {
    expect(() => revokeSession(db, "jamais-posé")).not.toThrow();
  });
});
