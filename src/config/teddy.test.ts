import { describe, it, expect } from "vitest";
import {
  TEDDY_ASSET_DIR,
  TEDDY_EXPRESSION_REF,
  teddyExpressionRef,
  type TeddyExpression,
} from "@/config/teddy";
import { assetPublicUrl, isRenderableAssetRef } from "@/lib/game/world-theme";

const EXPRESSIONS: readonly TeddyExpression[] = [
  "neutre",
  "content",
  "oups",
  "acclame",
  "intrepide",
];

describe("config Teddy — refs d'expression (story R2.2, #360)", () => {
  it("expose les 5 expressions du master (ART §2)", () => {
    expect(Object.keys(TEDDY_EXPRESSION_REF).sort()).toEqual([...EXPRESSIONS].sort());
  });

  it("teddyExpressionRef compose `socle/teddy/<expr>.png`", () => {
    expect(teddyExpressionRef("content")).toBe("socle/teddy/content.png");
    expect(teddyExpressionRef("acclame")).toBe(`${TEDDY_ASSET_DIR}/acclame.png`);
  });

  // ▶▶ Garde de sécurité MUTATION-PROUVÉE ◀◀ : chaque ref du config DOIT passer la garde partagée
  // `isRenderableAssetRef` (même contrat que la carte). Ce test ROUGIT si une ref devenait
  // malformée (`placeholder://…`, schéma, chemin absolu, traversée) — il refuse qu'un ref
  // non-rendable soit servi à `<AssetImage>` (qui le refuserait de toute façon → repli, mais le
  // config resterait mensonger). Effet observable distinct de son absence (CLAUDE.md #60).
  it.each(EXPRESSIONS)("la ref de « %s » est RENDABLE (isRenderableAssetRef ✓)", (expr) => {
    const ref = TEDDY_EXPRESSION_REF[expr];
    expect(isRenderableAssetRef(ref)).toBe(true);
  });

  it("l'URL publique d'un sprite est sous /generated/socle/teddy/ (Nginx)", () => {
    expect(assetPublicUrl(TEDDY_EXPRESSION_REF.neutre)).toBe("/generated/socle/teddy/neutre.png");
  });

  // Le namespace `socle/teddy` ne collisionne JAMAIS avec un slot numérique `socle/0..5` (la
  // sous-clé `teddy` n'est pas un slot) — invariant de conception documenté, prouvé ici.
  it("le dossier des sprites est sous le namespace socle (aucun slot numérique)", () => {
    expect(TEDDY_ASSET_DIR).toBe("socle/teddy");
    expect(TEDDY_ASSET_DIR.startsWith("socle/")).toBe(true);
    expect(Number.isNaN(Number("teddy"))).toBe(true);
  });
});
