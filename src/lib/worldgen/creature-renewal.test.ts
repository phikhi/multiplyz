import { expect, it } from "vitest";
import { assertRenewalRows } from "./creature-renewal";
import type { characters } from "@/lib/db/schema";
const row = {
  id: "saved",
  worldIndex: 0,
  speciesKey: "original",
  rarity: "rare",
  inEggPool: true,
  nameDefault: "Existing",
  artRef: "original.png",
} as typeof characters.$inferSelect;
it("requires the exact saved catalogue identity, count, rarity and art before renewal", () => {
  expect(() => assertRenewalRows([{ id: row.id, before: row }], [row])).not.toThrow();
  for (const changed of [
    { ...row, id: "other" },
    { ...row, rarity: "common" as const },
    { ...row, artRef: "replacement.png" },
    { ...row, nameDefault: "Renamed" },
  ])
    expect(() => assertRenewalRows([{ id: row.id, before: row }], [changed])).toThrow(
      /Catalogue familial modifié/,
    );
  expect(() => assertRenewalRows([{ id: row.id, before: row }], [])).toThrow();
});
