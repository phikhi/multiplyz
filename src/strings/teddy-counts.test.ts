import { expect, it } from "vitest";
import { companions } from "./companions";
import { eggShop } from "./egg-shop";
import { forest } from "./forest";
import { parent } from "./parent";
it.each([0, 1, 2])("keeps French counters consistent for %s", (n) => {
  const plural = n > 1 ? "s" : "";
  expect(companions.count(n)).toBe(`${n} compagnon${plural} rencontré${plural}`);
  expect(eggShop.paid(n)).toBe(`Ton achat est enregistré. Solde après cet achat : ${n} pièce${plural}.`);
  expect(forest.stars(n)).toBe(`${n} étoile${plural}`);
  expect(parent.seen(n)).toBe(`${n} calcul${plural} rencontré${plural}`);
  expect(parent.minutes(n)).toBe(`${n} min estimée${plural}`);
});
