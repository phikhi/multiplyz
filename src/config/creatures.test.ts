import { describe, it, expect } from "vitest";
import {
  COMMITTED_CREATURE_SPECIES,
  CREATURE_ASSET_DIR,
  DEMO_CREATURE_ART_REF,
  DEMO_CREATURE_SPECIES,
  creatureArtRef,
} from "@/config/creatures";
import { assetPublicUrl, isRenderableAssetRef } from "@/lib/game/world-theme";

describe("config créatures — refs d'illustration (story R2.1, #361)", () => {
  it("creatureArtRef compose `socle/creature/<species>.png`", () => {
    expect(creatureArtRef("cloudfox")).toBe("socle/creature/cloudfox.png");
    expect(creatureArtRef("cloudfox")).toBe(`${CREATURE_ASSET_DIR}/cloudfox.png`);
  });

  it("la créature de démo pointe sur l'espèce du spike (`cloudfox`)", () => {
    expect(DEMO_CREATURE_SPECIES).toBe("cloudfox");
    expect(DEMO_CREATURE_ART_REF).toBe("socle/creature/cloudfox.png");
  });

  // ▶▶ Garde de sécurité MUTATION-PROUVÉE + chemin FORMAT-RÉEL (#60/#189) ◀◀ : la ref de la
  // créature de démo DOIT passer la garde partagée `isRenderableAssetRef` — c'est ce qui prouve que
  // `<AssetImage>` rendra un VRAI <img> (chemin renderable→img non-null), pas seulement le repli.
  // Ce test ROUGIT si la ref devenait malformée (`placeholder://…`, schéma, chemin absolu, `..`) :
  // l'écran Collection retomberait silencieusement au placeholder emoji alors que l'asset existe
  // (défaut format-réel dormant #189). Effet observable distinct de son absence (CLAUDE.md #60).
  it("la ref de la créature de démo est RENDABLE (isRenderableAssetRef ✓ — chemin format-réel #189)", () => {
    expect(isRenderableAssetRef(DEMO_CREATURE_ART_REF)).toBe(true);
  });

  it("l'URL publique de la créature de démo est sous /generated/socle/creature/ (Nginx)", () => {
    expect(assetPublicUrl(DEMO_CREATURE_ART_REF)).toBe("/generated/socle/creature/cloudfox.png");
  });
});

describe("COMMITTED_CREATURE_SPECIES — registre de seed (story R3.1, #378)", () => {
  it("Phase 1 (câblage, 0 dépense) : contient EXACTEMENT la démo cloudfox — défaut inerte (#180)", () => {
    // Le défaut committé ne seede QUE l'art réel qui existe (cloudfox). Ce test rougit si un
    // speciesKey socle est appendé PRÉMATURÉMENT (avant que son vrai PNG soit committé) → régression
    // du seed (copie d'un fichier absent). Le flip Phase 2 (#377) met à jour ce test EN MÊME temps.
    expect(COMMITTED_CREATURE_SPECIES).toEqual([DEMO_CREATURE_SPECIES]);
  });

  it("chaque espèce committée a une ref RENDABLE (isRenderableAssetRef ✓ — contrat de seed #189)", () => {
    // Toute entrée du registre DOIT produire une ref que `<AssetImage>` rendra en vrai <img> — sinon
    // le seed copierait un asset jamais rendu (dormant #189). Rougit si une entrée future est malformée.
    for (const species of COMMITTED_CREATURE_SPECIES) {
      expect(isRenderableAssetRef(creatureArtRef(species))).toBe(true);
    }
  });
});
