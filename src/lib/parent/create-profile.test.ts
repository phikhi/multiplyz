import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles, adventureSessions } from "@/lib/db/schema";
import { createHousehold } from "@/lib/auth/household";
import { createChildProfile } from "./create-profile";
import { startAdventure } from "@/lib/game/adventure";
import { CONFIG_DEFAULTS } from "@/config/server-config";
let db: AppDatabase;
beforeEach(async () => {
  db = createDatabase(":memory:");
  runMigrations(db);
  await createHousehold(db, { name: "Nova", avatar: "cat", childPin: "7171", parentPin: "8181" });
});
afterEach(() => db.$client.close());
describe("TEDDy additional child profile", () => {
  it("creates an empty separate child, hashes the PIN, and preserves the running journey", async () => {
    const owner = db.select().from(profiles).get()!;
    startAdventure(
      db,
      owner.id,
      CONFIG_DEFAULTS.engine,
      CONFIG_DEFAULTS.map,
      Date.UTC(2026, 8, 11),
    );
    const before = db.select().from(adventureSessions).all();
    const id = await createChildProfile(db, { name: "  Éloïse  ", avatar: "fox", pin: "4242" });
    expect(db.select().from(profiles).all()).toHaveLength(2);
    expect(db.select().from(adventureSessions).all()).toEqual(before);
    const child = db
      .select()
      .from(profiles)
      .all()
      .find((p) => p.id === id)!;
    expect(child).toMatchObject({
      name: "Éloïse",
      nameKey: "éloïse",
      parentPinHash: null,
      recoveryCodeHash: null,
    });
    expect(child.pinHash).not.toBe("4242");
  });
  it("concurrent identical requests and later replay create only one child", async () => {
    const input = { name: "Éloïse", avatar: "fox", pin: "4242" };
    const ids = await Promise.all([createChildProfile(db, input), createChildProfile(db, input)]);
    expect(ids[0]).toBe(ids[1]);
    expect(await createChildProfile(db, { ...input, name: "éloïse" })).toBe(ids[0]);
    expect(db.select().from(profiles).all()).toHaveLength(2);
    await expect(createChildProfile(db, { ...input, pin: "4343" })).rejects.toMatchObject({
      code: "NAME_TAKEN",
    });
  });
  it("rejects malformed fields and the parent code without creating a child", async () => {
    for (const input of [
      { name: "", avatar: "cat", pin: "4242" },
      { name: "Test", avatar: "evil", pin: "4242" },
      { name: "Test", avatar: "cat", pin: "nope" },
      { name: "Test", avatar: "cat", pin: "8181" },
    ])
      await expect(createChildProfile(db, input)).rejects.toThrow();
    expect(db.select().from(profiles).all()).toHaveLength(1);
  });
});
