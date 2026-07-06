# 0008. Confirmer Nano Banana (Gemini 2.5 Flash Image) comme modèle d'image

- **Statut** : accepted
- **Type** : deps
- **Portée** : majeure (dans le contrat — HOW dans le WHAT ; acceptée en autonomie par l'orchestrateur, ADR 0003/0004)
- **Liens** : issue #6 (épic) · #146 (blocage levé) · PR #147 · specs : `WORLDGEN.md` §5/§9, `ART.md` §5

## Contexte

WORLDGEN §5/§9 verrouille **Nano Banana (Gemini 2.5 Flash Image)** comme candidat principal du
pipeline de génération de mondes, « **à confirmer par spike** (qualité kawaii flat-vector / coût /
latence / sur-censure) ⚙️ ». Rien de l'épic #6 (worker, buffer, Stage A/B, QA, fallback) ne peut
être figé avant de savoir que le modèle tient la charte de style, la **consistance de personnage**
(le cœur du pipeline 2-stages Teddy, WORLDGEN §8) et le budget ⚙️ ~20 €/mois.

Le propriétaire a fourni les 3 inputs (clé Gemini dans `.env`, photos Teddy dans `docs/teddy/`,
go spike) et levé le blocage #146. Spike exécuté le 2026-07-06 — cf.
[`docs/spike/nano-banana/`](../spike/nano-banana/README.md).

## Décision

**Confirmer `gemini-2.5-flash-image` comme modèle d'image de l'épic #6.** Le spike valide les
4 axes : qualité **excellente**, **consistance Stage A→B excellente**, coût **~0,039 $/image**
(~0,45 $/monde ; ~45 mondes/mois sous le plafond 20 €/mois), **aucune sur-censure** sur le
périmètre kid-safe. La valeur par défaut de `server-config.ts` (`imageModel.model`) reste
`gemini-2.5-flash-image` ; l'override `IMAGE_MODEL` (env) autorise un swap sans code si besoin.

Contraintes de build actées par le spike (à câbler dans les stories 6.x) :

1. **Retry transitoire** obligatoire (HTTP 500/503/429 → backoff, jusqu'à N essais) — observé 1/5.
2. **Étiquette vierge** : variables de prompt Teddy = « blank ear tag, no text » (Nano Banana rend
   du texte parasite sinon).
3. **Pas d'alpha fiable** (fond blanc plein) → détourage post OU personnages sur cartes pleines
   (⚙️ tranché à la story Stage A/B, pas ici).
4. **Ombrage** : base prompt calibrable ⚙️ (variance mascotte/créature) — playtest.

## Alternatives

- **`gemini-3-pro-image` (« Nano Banana Pro ») / `gemini-3.1-flash-image`** (dispo sur la clé) :
  qualité potentiellement supérieure mais **coût supérieur** et **hors du choix nommé** par la spec.
  2.5-flash **atteint déjà** la qualité kid-safe visée → écartés pour le coût. Chemin d'upgrade
  ouvert (1 ligne de config) si le besoin qualité monte.
- **Imagen 4** (`predict`, pas `generateContent`) : pas d'img2img multi-référence aussi direct →
  moins adapté à la **consistance Teddy** (le critère décisif). Écarté.
- **SDK `@google/genai`** vs REST direct : le spike a utilisé REST (zéro dépendance). Le build
  tranchera SDK vs REST à la story client (détail d'implémentation, hors ADR).

## Conséquences

- **+** Le pipeline WORLDGEN est **débloqué** : abstraction worker/génération peut être figée sur un
  modèle validé. Coût **prévisible** et **très sous le plafond**.
- **+** Pipeline 2-stages Teddy (WORLDGEN §8) **prouvé** techniquement (consistance A→B).
- **−** Le modèle **rend du texte parasite** et **ne garantit pas l'alpha** → deux contraintes de
  pipeline (prompt « no text » + stratégie de fond) portées par les stories 6.x.
- **Specs à mettre à jour** : `WORLDGEN.md` §5/§9 → « confirmé par spike (ADR 0008, 2026-07-06) ».
- **Gate de validation manuelle** : le **master Teddy Stage A « validé à la main »** (WORLDGEN §8)
  reste un **sign-off propriétaire** — le build produit des candidats, le figeage du Teddy canonique
  n'est **pas** autonome (checkpoint owner à la story Stage A).
- **Suites** : découpe de l'épic #6 en stories 6.x (fondation `worlds`/`jobs` + `WorldGenConfig`
  budget ⚙️ + client image → Stage A → Stage B → worker/buffer → QA kid-safe → fallback socle).
