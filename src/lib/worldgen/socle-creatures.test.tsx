import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, profiles } from "@/lib/db/schema";
import { creatureArtRef } from "@/config/creatures";
import { AssetImage } from "@/components/media/AssetImage";
import { grantLegendaryInTx, legendaryForWorld, loadCollection } from "@/lib/game/collection";
import { assetPublicUrl, isRenderableAssetRef } from "@/lib/game/world-theme";
import type { GenerateImageInput } from "./image-client";
import {
  creatureCharacterId,
  creatureSpeciesKey,
  deriveCreatureSplit,
  WorldGenError,
} from "./generate-world";
import * as referenceAssets from "./reference-assets";
import { regenerateSocleContent, socleSeed } from "./socle";
import { defaultSocleCreatureWriteAsset, generateSocleCreatures } from "./socle-creatures";

/**
 * Tests du **chemin créature-seule du socle** (story R3.1, #378, épic R3 #319), base réelle
 * (SQLite en mémoire + migrations), **client image mocké** (zéro appel réseau — Phase 1, 0 dépense).
 * Prouvent à effet observable :
 * - **PAS de master-gate** : tourne SANS master approuvé (créature ≠ Teddy, ADR 0009) ;
 * - **UNIQUEMENT** des créatures : aucun fond/tuiles/Teddy, aucun ancrage master (refImages) ;
 * - **format-RÉEL (#189)** : refs relatives `socle/creature/<species>.png` rendables (non-null) →
 *   câblées dans `characters` ; **format-FAUTIF** (réf absolue) → rejet LOUD (garde `assertRenderableRef`) ;
 * - **rareté ECONOMY §5** : communes + 1-2 rares + 1 légendaire **hors œufs** ;
 * - **clés consommateur (#180)** : MÊME légendaire que le boss, MÊMES clés d'œuf que le tirage ;
 * - **bout-en-bout (#180)** : une créature socle au vrai artRef se REND en `<img>` dans la Collection.
 */

let db: AppDatabase;
let profileId: number;
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db); // migre + amorce socle_worlds (placeholders). AUCUN master approuvé.
  profileId = db
    .insert(profiles)
    .values({ name: "Nino", nameKey: "nino", avatar: "owl", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
});

/** Générateur d'image mocké : octets factices + enregistre chaque appel (prompt + refImages). */
function recordingGenerate() {
  const calls: GenerateImageInput[] = [];
  const generate = vi.fn(async (input: GenerateImageInput): Promise<Buffer> => {
    calls.push(input);
    return Buffer.from(`img:${input.prompt.slice(0, 12)}`);
  });
  return { calls, generate };
}

/** Lit une ligne `characters` par id (ou undefined). */
function readChar(id: string) {
  return db.select().from(characters).where(eq(characters.id, id)).get();
}

describe("generateSocleCreatures — PAS de master-gate (créature ≠ Teddy, ADR 0009)", () => {
  it("tourne SANS master approuvé (ne lève jamais le gate L353 de generateWorld) + ne consulte jamais le master", async () => {
    // `beforeEach` n'amorce AUCUN master → `generateWorld` lèverait (WorldGenError). Ce chemin NON :
    // il peuple `characters` sans master. Ré-ajouter le gate ici ferait rejeter cet appel → rouge.
    const spy = vi.spyOn(referenceAssets, "getApprovedMaster");
    const creatures = await generateSocleCreatures(db, 0, {
      generate: recordingGenerate().generate,
    });
    expect(creatures.length).toBeGreaterThan(0);
    expect(readChar(legendaryForWorld(0).id)).toBeDefined(); // légendaire câblée en base.
    // Mécanisme : le gate master n'est JAMAIS consulté sur ce chemin.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("generateSocleCreatures — créatures UNIQUEMENT (aucun fond/tuiles/Teddy)", () => {
  it("génère commons+rares+1 légendaire, aucun asset non-créature, aucun refImages (pas d'ancrage master)", async () => {
    const { calls, generate } = recordingGenerate();
    const written: string[] = [];
    const creatures = await generateSocleCreatures(db, 2, {
      generate,
      writeAsset: (_slot, name) => {
        written.push(name);
        return Promise.resolve(`socle/creature/${name}`);
      },
    });
    const split = deriveCreatureSplit(2);
    const expected = split.commons + split.rares + 1; // +1 légendaire, PAS de Teddy/fond/tuiles.
    expect(calls).toHaveLength(expected);
    expect(creatures).toHaveLength(expected);
    // Aucun asset non-créature écrit (background/tiles/teddy sont produits par generateSocleWorldAssets).
    expect(written.some((n) => /background|tiles|teddy/.test(n))).toBe(false);
    // Créature = `{base_style}` en TEXTE : aucun appel ne porte refImages (jamais le master, ADR 0009).
    expect(calls.every((c) => c.refImages === undefined)).toBe(true);
  });
});

describe("generateSocleCreatures — contrat de format artRef (#189)", () => {
  it("chemin format-RÉEL : refs relatives socle/creature/<species>.png RENDABLES (non-null), câblées dans characters (défaut writeAsset)", async () => {
    // Aucun override writeAsset → couvre `?? defaultSocleCreatureWriteAsset` (chemin réel du run owner).
    const creatures = await generateSocleCreatures(db, 3, {
      generate: recordingGenerate().generate,
    });
    for (const c of creatures) {
      expect(c.artRef).toBe(creatureArtRef(c.speciesKey)); // socle/creature/<species>.png
      expect(c.artRef.startsWith("socle/creature/")).toBe(true); // relatif, jamais /generated/…
      expect(isRenderableAssetRef(c.artRef)).toBe(true); // format-réel prouvé NON-NULL (#189).
      expect(readChar(c.id)?.artRef).toBe(c.artRef); // câblé en base.
    }
  });

  it("chemin format-FAUTIF : un writeAsset renvoyant une réf ABSOLUE /generated/… est rejeté LOUD (garde assertRenderableRef #189)", async () => {
    await expect(
      generateSocleCreatures(db, 0, {
        generate: recordingGenerate().generate,
        // Le défaut #189 EXACT : ref absolue → isRenderableAssetRef=false → art dormant SANS la garde.
        writeAsset: (_slot, name) => Promise.resolve(`/generated/socle/creature/${name}`),
      }),
    ).rejects.toBeInstanceOf(WorldGenError);
    // Garde AVANT la transaction → AUCUNE réf dormante persistée en base.
    expect(db.select().from(characters).all()).toHaveLength(0);
  });
});

describe("generateSocleCreatures — rareté + clés consommateur (ECONOMY §5, #180)", () => {
  it("répartition : `commons` premières = communes puis `rares` rares (in_egg_pool=true), +1 légendaire hors œufs", async () => {
    const slot = 1;
    const split = deriveCreatureSplit(slot);
    const creatures = await generateSocleCreatures(db, slot, {
      generate: recordingGenerate().generate,
    });
    const eggs = creatures.slice(0, split.commons + split.rares);
    const legendary = creatures[creatures.length - 1];
    expect(eggs.slice(0, split.commons).every((c) => c.rarity === "common")).toBe(true);
    expect(eggs.slice(split.commons).every((c) => c.rarity === "rare")).toBe(true);
    expect(eggs.every((c) => c.inEggPool === true)).toBe(true);
    // Exactement 1 légendaire, hors œufs (boss only) — câblé en base.
    expect(creatures.filter((c) => c.rarity === "legendary")).toHaveLength(1);
    expect(legendary.inEggPool).toBe(false);
    expect(readChar(legendary.id)?.inEggPool).toBe(false);
    expect(readChar(eggs[0].id)?.inEggPool).toBe(true);
    expect(readChar(eggs[0].id)?.maxStage).toBe(1); // évolution différée (ECONOMY §2).
  });

  it("clés consommateur (#180) : légendaire = MÊME ligne que le boss ; œufs = clés du tirage + world_index=slot", async () => {
    const slot = 4;
    const creatures = await generateSocleCreatures(db, slot, {
      generate: recordingGenerate().generate,
    });
    const legendary = creatures[creatures.length - 1];
    // La légendaire est EXACTEMENT la ligne que le boss câble (grantLegendaryInTx → legendaryForWorld).
    expect(legendary.id).toBe(legendaryForWorld(slot).id);
    expect(legendary.speciesKey).toBe(legendaryForWorld(slot).speciesKey);
    // Œufs : ids/species = contrat du tirage ; world_index = position de carte servie (= slot).
    expect(creatures[0].id).toBe(creatureCharacterId(slot, 0));
    expect(creatures[0].speciesKey).toBe(creatureSpeciesKey(slot, 0));
    expect(readChar(creatures[0].id)?.worldIndex).toBe(slot);
    expect(readChar(legendary.id)?.worldIndex).toBe(slot);
  });
});

describe("generateSocleCreatures — reproductibilité (§7) + idempotence", () => {
  it("même slot ⇒ mêmes créatures ; concept de la légendaire dérivé du thème du socle (buildSocle)", async () => {
    const first = await generateSocleCreatures(db, 5, { generate: recordingGenerate().generate });
    const db2 = createDatabase(":memory:");
    runMigrations(db2);
    const { calls, generate } = recordingGenerate();
    const second = await generateSocleCreatures(db2, 5, { generate });
    expect(second.map((c) => c.artRef)).toEqual(first.map((c) => c.artRef));
    // Le thème dérive du seed du slot (identique à buildSocle) → son concept légendaire est prompté.
    const theme = regenerateSocleContent(socleSeed(5)).theme;
    expect(calls.some((c) => c.prompt.includes(theme.legendaryConcept.concept))).toBe(true);
  });

  it("idempotent : re-run REMPLACE l'art (upsert par PK), aucune ligne dupliquée", async () => {
    const slot = 0;
    const c1 = await generateSocleCreatures(db, slot, { generate: recordingGenerate().generate });
    const count1 = db.select().from(characters).all().length;
    const c2 = await generateSocleCreatures(db, slot, { generate: recordingGenerate().generate });
    expect(db.select().from(characters).all()).toHaveLength(count1); // pas de doublon.
    expect(c2.map((c) => c.id)).toEqual(c1.map((c) => c.id));
    expect(c2.map((c) => c.artRef)).toEqual(c1.map((c) => c.artRef));
  });
});

describe("defaultSocleCreatureWriteAsset — namespace créature relatif", () => {
  it("renvoie socle/creature/<name> (relatif, jamais /generated/ ni world/…)", async () => {
    await expect(defaultSocleCreatureWriteAsset(3, "cloudfox.png")).resolves.toBe(
      "socle/creature/cloudfox.png",
    );
  });
});

describe("bout-en-bout #180 — l'art réel atteint l'enfant en Collection (guardé <AssetImage>)", () => {
  it("une créature socle au vrai artRef relatif se REND en <img> (pas le repli) via le chemin data+renderer réel", async () => {
    const slot = 2;
    // 1. Générer les vraies créatures (art réel câblé dans characters) — client image mocké.
    await generateSocleCreatures(db, slot, { generate: recordingGenerate().generate });
    // 2. Posséder la légendaire via le VRAI chemin boss (grantLegendaryInTx) : l'art réel déjà en base
    //    est préservé (ensureCharacterInTx = onConflictDoNothing, ne réécrit pas le placeholder).
    const now = new Date(Date.UTC(2026, 6, 22, 10, 0, 0));
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, slot, now));
    // 3. Lire par le VRAI chemin data de la Collection (loadCollection → CollectionEntry.artRef).
    const entry = loadCollection(db, profileId).find(
      (e) => e.characterId === legendaryForWorld(slot).id,
    );
    expect(entry?.artRef.startsWith("socle/creature/")).toBe(true);
    expect(isRenderableAssetRef(entry!.artRef)).toBe(true);
    // 4. Rendre par le VRAI renderer de la Collection (<AssetImage> guardé) → vrai <img>, pas le repli.
    const { container } = render(
      <AssetImage
        assetRef={entry!.artRef}
        alt={entry!.displayName}
        decorative
        width="var(--collection-placeholder-size)"
        dataAsset="collection-creature"
        fallback={<span data-testid="fallback" />}
      />,
    );
    const img = container.querySelector<HTMLImageElement>('img[data-asset="collection-creature"]');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("data-asset-state", "rendered"); // vrai <img>, jamais le repli.
    expect(img?.getAttribute("src")).toBe(assetPublicUrl(entry!.artRef)); // /generated/socle/creature/<species>.png
    // Aucun repli rendu (le chemin renderable→img est pris).
    expect(container.querySelector('[data-asset-state="fallback"]')).toBeNull();
  });
});
