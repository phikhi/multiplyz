import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index";
import { runMigrations } from "./migrate";
import { profiles, sessions } from "./schema";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-auth-schema-"));
let counter = 0;
/** Base fraîche migrée par cas (FK activées via createDatabase). */
function freshDb() {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("schéma profiles", () => {
  it("insère et relit un profil (hash parent/récupération nullable)", () => {
    const db = freshDb();
    db.insert(profiles).values({ name: "Lina", pinHash: "h", avatar: "fox" }).run();

    const row = db.select().from(profiles).get();
    expect(row).toMatchObject({
      name: "Lina",
      pinHash: "h",
      avatar: "fox",
      parentPinHash: null,
      recoveryCodeHash: null,
    });
    expect(row?.id).toBeTypeOf("number");
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("contraint l'unicité du prénom (single-tenant)", () => {
    const db = freshDb();
    db.insert(profiles).values({ name: "Lina", pinHash: "h", avatar: "fox" }).run();
    expect(() =>
      db.insert(profiles).values({ name: "Lina", pinHash: "h2", avatar: "cat" }).run(),
    ).toThrow();
  });
});

describe("schéma sessions (FK ON DELETE CASCADE)", () => {
  it("purge les sessions à la suppression du profil (RGPD — AUTH §6)", () => {
    const db = freshDb();
    db.insert(profiles).values({ id: 1, name: "Lina", pinHash: "h", avatar: "fox" }).run();
    db.insert(sessions)
      .values({ token: "tok-1", profileId: 1, kind: "child", expiresAt: new Date(1_000_000) })
      .run();
    expect(db.select().from(sessions).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("refuse une session orpheline (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(sessions)
        .values({ token: "tok-x", profileId: 999, kind: "parent", expiresAt: new Date(1_000_000) })
        .run(),
    ).toThrow();
  });

  it("référence sessions.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(sessions).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});
