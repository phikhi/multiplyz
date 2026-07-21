/**
 * **Sprites d'expression de Teddy dans la boucle de jeu** (story R2.2, #360, ART §2/§8).
 *
 * ART §2 (« master = aussi les sprites de réaction en jeu ») fige 5 expressions du master
 * Teddy validé (#158, Stage A) : `neutre` / `content` / `oups` / `acclame` / `intrepide`. Cette
 * table mappe chaque expression sur un **ref d'asset RENDABLE** (`socle/teddy/<expr>.png`) que la
 * garde de sécurité **partagée** `isRenderableAssetRef` (`world-theme.ts`) accepte à l'identique —
 * même namespace `socle/` que les assets per-monde, **jamais** une URL arbitraire, jamais un
 * `placeholder://…`. Les octets réels sont servis sous `/generated/socle/teddy/` (fixture
 * committée dé-échantillonnée `test-fixtures/teddy/`, copiée par le seed dev/E2E — même patron que
 * `seed-real-world-fixture.ts` ; production = owner-run). Un ref manquant/non servi retombe sur le
 * repli de `<AssetImage>` (no-fail).
 *
 * **⚙️ mapping expression→ref centralisé** (jamais un chemin en dur éparpillé dans les écrans) : les
 * écrans choisissent l'EXPRESSION par état de jeu (game-design), ce module résout l'expression en
 * ref rendable. Le **mapping expression→écran** (quel sprite sur quel écran) vit dans chaque écran,
 * argumenté ART/COPY — cf. corps de PR #360.
 */

/**
 * Les 5 expressions du master Teddy (#158, ART §2 « expressions neutre/content/oups/acclame/
 * intrépide »). `intrepide` sans accent = clé stable (fichier/ref ASCII), le libellé accentué
 * reste dans la voix de Teddy (strings), jamais dans la clé technique.
 */
export type TeddyExpression = "neutre" | "content" | "oups" | "acclame" | "intrepide";

/**
 * Base du namespace socle des sprites Teddy (⚙️ centralisée) — `socle/teddy/` : sous le namespace
 * `socle` déjà accepté par `isRenderableAssetRef` (aucune modification de la garde de sécurité) et
 * **distinct** des slots numériques `socle/0..5/` (jamais de collision — la sous-clé `teddy` n'est
 * pas un slot). Deux segments (`socle` / `teddy` / `<expr>.png`) → matche la forme rendable exacte.
 */
export const TEDDY_ASSET_DIR = "socle/teddy";

/**
 * Ref rendable (`isRenderableAssetRef` ✓) du sprite d'une expression donnée. Pure. Ne construit
 * JAMAIS une URL : renvoie le **ref relatif** que `<AssetImage>` re-valide puis résout via
 * `assetPublicUrl` — la sécurité du rendu reste portée par la garde partagée, jamais contournée.
 */
export function teddyExpressionRef(expression: TeddyExpression): string {
  return `${TEDDY_ASSET_DIR}/${expression}.png`;
}

/**
 * Table complète expression→ref (les 5 sprites du master). Chaque valeur est un ref rendable
 * (prouvé par `teddy.test.ts` : chacune passe `isRenderableAssetRef`, rougit si une ref devenait
 * malformée/`placeholder://`). Les écrans consomment un sous-ensemble (`content`/`neutre`/`acclame`),
 * `oups`/`intrepide` restent disponibles pour d'autres surfaces (boss, R2.1).
 */
export const TEDDY_EXPRESSION_REF: Record<TeddyExpression, string> = {
  neutre: teddyExpressionRef("neutre"),
  content: teddyExpressionRef("content"),
  oups: teddyExpressionRef("oups"),
  acclame: teddyExpressionRef("acclame"),
  intrepide: teddyExpressionRef("intrepide"),
};
