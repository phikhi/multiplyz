# 0009. Style de base « fluffy-kawaii unifié » (révision ART §5)

- **Statut** : accepted
- **Type** : product
- **Portée** : majeure (direction artistique — sign-off owner)
- **Liens** : issue #160 · issue #158 (freeze master Teddy) · issue #150 (6.3 Stage B, consommateur) · spec(s) impactée(s) : `ART.md` §1/§5/§8, `src/config/server-config.ts` (`worldgen.prompts.style`/`.teddy`) · relié à [ADR 0008](0008-confirmer-nano-banana-modele-image.md)

## Contexte
Le freeze du **master Teddy** (#158, WORLDGEN §8) s'est fait par validation visuelle owner. Le style retenu **diverge** du prompt de base verrouillé jusqu'ici (`flat 2D kawaii vector illustration, … gentle minimal shading`) : l'owner a validé un **kawaii doux avec cel-shading léger et poils tuftés légers** (aspect peluche), plus fidèle au vrai Teddy (Steiff mohair).

Le master figé a été généré via `WORLDGEN_PROMPT_STYLE` (override d'exécution, **non committé**). Le défaut committé décrivait donc un **autre** style que les assets réellement figés.

**Force qui pousse à décider** : Stage B (#150) génère les **créatures** en consommant `{base_style}` committé. Si le défaut garde l'ancien style (sans poils tuftés ni cel-shading), les créatures ne matcheraient pas le master → incohérence d'ombrage mascotte↔créatures (exactement la cohérence exigée par WORLDGEN §8 / ART §6). Il faut trancher la DA **avant** 6.3.

## Décision
Le **style de base canonique devient « fluffy-kawaii unifié »** (arbitrage owner, #160) : le **`flat 2D kawaii vector` est CONSERVÉ** et **enrichi** de **cel-shading léger** + **poils tuftés légers** — fidèle au **master validé #158** (le master a été généré avec ces mêmes tokens). Ce n'est **pas un abandon** du flat-vector mais un **enrichissement additif**.

Le style de base committé = **les tokens VERBATIM du master validé**, MOINS deux éléments non-génériques : le **torse crème** (spécifique Teddy → gabarit `teddy`) et `isolated on plain solid white background` (détail d'**exécution Stage A** / cutout, piloté par `WORLDGEN_STAGE_A_*`, pas un contrat de style). **Aucun autre écart** : les qualificatifs du master (`vector`, `gentle minimal cel shading`, `a few`, `smooth`, `or dirty marks`) sont **conservés verbatim** — car au Stage B les **créatures consomment `{base_style}` en TEXTE** (pas d'img2img), donc la fidélité au texte du master = la cohérence mascotte↔créatures visée.

Le style reste **générique et partagé** par `teddy`/`creature`/`background` via `{base_style}` ; les traits **spécifiques Teddy** (torse crème, mohair doré, museau brodé, étiquette vierge) vivent dans le gabarit `teddy`, **jamais** dans le style de base.

Nouveau `worldgen.prompts.style` :
```
flat 2D kawaii vector illustration, soft rounded shapes, cute chibi proportions,
big shiny friendly eyes, gentle minimal cel shading, lightly fluffy fur with a few
soft clean fur tufts along the silhouette edge, tidy smooth even fur, not blotchy,
no random dark spots or dirty marks, soft pastel palette with bright accent highlights,
clean simple background, children's app art, high quality, consistent art style
```

Le prompt de base **reste verrouillé** (CLAUDE.md « prompt de base verrouillé ») — cette révision est **ponctuelle**, actée ici ; un monde ne pose toujours que ses variables (`{world_accessory}`, `{world_palette}`…).

## Alternatives
- **Garder l'ancien style SANS poils** (créatures lisses, Teddy peluche à part) : écarté par l'owner — casse la cohérence d'ombrage mascotte↔créatures voulue (ART §6) et n'honore pas la DA validée en #158.
- **Fluffy plein/réaliste** (mohair painterly) : testé pendant #158, **rejeté** (sort du kawaii, perte d'unité). Le retenu = flat kawaii conservé + poils *légers*.
- **Généraliser/paraphraser le string du master** (`vector`→`character`, simplifier les qualificatifs) : écarté — les créatures consommant `{base_style}` en TEXTE, toute paraphrase non re-validée visuellement risquerait de ré-introduire le drift mascotte↔créatures. On canonise **verbatim** (moins les 2 éléments non-génériques ci-dessus).

## Conséquences
- **(+)** Cohérence mascotte↔créatures : créatures et Teddy partagent le même `{base_style}` = tokens du master figé.
- **(+)** Le défaut committé reprend les **tokens verbatim** du master validé #158 (moins torse crème + fond blanc d'exécution) → fin du drift #160, sans paraphrase non validée.
- **(−)** Léger surcoût visuel (poils sur chaque créature) — borné « tufts légers, propre, pas de taches » pour rester lisible en vignette Pokédex (PRODUCT §2.3).
- **Specs mises à jour** (canoniques) : `ART.md` §1 (Style/Rendu), §5 (STYLE DE BASE + gabarit Teddy avec torse crème + étiquette vierge alignée ADR 0008), §8 (table verrouillée).
- **Config** : `worldgen.prompts.style` (générique) + `worldgen.prompts.teddy` (torse crème). Surcharge `WORLDGEN_PROMPT_STYLE` inchangée (mécanisme intact).
- **Suite 6.3 (#150)** — ancrage à distinguer (une créature n'est **pas** Teddy) :
  - **Teddy par monde** = ancré **img2img sur le master approuvé** (comme les expressions en #158 — c'est ce qui a donné la cohérence du model sheet).
  - **Créatures** = cohérence via `{base_style}` (texte) + une **style-bible de créatures-références** (ART §6), **PAS** le master Teddy (sinon la créature devient un ours-Teddy). Vérif visuelle game-design dès les 1res créatures réelles (note portée depuis rétro spike).
- **Non touché** : ADR 0008 (constat spike historique « flat-vector » laissé tel quel — observation datée, non contrat) ; NEGATIVE inchangé.
