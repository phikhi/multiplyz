# Arbélune — corriger l’anatomie de la direction retenue

> Suite : correction exécutée (appel 192), retour utilisateur « ok c’est bon ». [Deux stades extraits et inspection préparée](arbelune-47ba-extraction.md). La commande de génération ci-dessous est désormais consommée.

11 septembre 2026. Accord utilisateur explicite : **« Garder cette direction et corriger l’anatomie »**. Conserver le contraste de l’étude 357ee3a9 : ado bas aux racines fines, adulte haut et massif. L’accord porte sur cette direction ; les anatomies imparfaites de la planche ne deviennent pas des stades approuvés.

## Correction préparée

Une nouvelle planche, avec deux images réellement envoyées au générateur dans cet ordre :

1. L’étude 357ee3a9, image à modifier en préservant les silhouettes, couleurs, visages et disposition.
2. Le bébé approuvé exact, référence d’identité et d’anatomie, absent du dessin produit.

Chaque forme doit retrouver quatre ouvertures naturelles, deux de chaque côté du visage, et six racines distinctes, trois par extrémité de l’arche. Des espaces blancs doivent séparer les racines depuis leurs attaches jusqu’à leurs pieds. Chez l’ado elles restent fines, mais arrondies et lisibles ; chez l’adulte elles deviennent longues, épaisses et légèrement articulées, avec des appuis développés. L’adulte garde sa hauteur et perd ses deux piliers fusionnés. Aucune couronne, accessoire ou branche supplémentaire. Visage expressif visible en vignette, arche ouverte jusqu’au sol, marges blanches dégagées.

Cette passe modifie l’étude à partir de ses pixels ; elle ne repart pas d’une description seule. Sa réussite artistique reste à examiner sur le résultat réel. Aucun détourage, extraction de stades, QA ou remplacement d’art dans cette passe. Les dix-huit arts sources demeurent exacts, notamment le bébé d’Arbélune et Vrillou approuvés.

## Exécution

Dans `app/`, sous Node 22, depuis le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-study-anatomy
```

Plan réel `--arbelune-study-anatomy-plan` vérifié sans API : une image, deux références, zéro inspection, **0,10 € supplémentaire**, cumul prévu **13,10 € / 40 €**. État actuel : **191 appels et 13 € réservés**. Le plafond 40 € est déjà autorisé, aucun nouvel accord requis. L’accès Gemini de l’agent reste bloqué ; aucun nouvel appel réseau ni contournement tenté ici. Aucune planche corrigée encore produite.

Résultat attendu : `study-ready-for-visual-review`, méthode `edit-study-anatomy`, `qaPassed:false`, `growthGenerated:false`, `published:false`. Galerie `preview-arbelune-study-anatomy-<run>.html` ; image et bilan dans `arbelune-study-anatomies/`. Marqueur distinct `arbelune-study-anatomy-started.json`. Conserver tous les fichiers après arrêt, refus ou interruption ; ne relancer aucune ancienne commande ni effacer de marqueur.

## Gardes et vérifications

Accord enregistré dans `arbelune-study-direction-approval.json`, lié à la planche exacte ; recette `arbelune-study-anatomy-plan.json` liée par empreintes à l’accord, à l’étude, au résultat, au marqueur, à la trace et à la recette précédente. La chaîne vérifie aussi les dix-huit arts, les bébés et la lignée de Vrillou approuvés. Catalogue, progression, mois, budget et sources sont revérifiés avant chaque appel. Réservation avant requête, aucun retry, bases en lecture seule ; toute requête d’inspection est bloquée dans le mode étude.

**56 tests ciblés distincts passent** : 55 pour les lignées/reprises/études, 1 pour le suivi CLI. Six nouveaux contrôles couvrent les deux références exactes dans le bon ordre et la conservation des dix-huit arts, les modifications de l’image/accord/résultat sources, la distinction entre accord de direction et validation finale, et le budget avant requête. Typage et lint passent. Plan réel sans API vérifié. Les contrôles artistiques réels restent à faire après génération ; les tests avec réponses simulées ne garantissent pas l’anatomie produite.

Contrôle familial en lecture seule : **26 tables inchangées, intégrité ok**. Aucun seed, migration/restauration, modification de sessions, possessions, stades, reçus, Teddy ou recalibrage. Pas de nouvel essai familial/WebGL. Anciennes couvertures/tests/canari différés.

Suite : examiner l’anatomie corrigée et la différence des âges ; si elles conviennent, préparer les deux stades séparés, contrôler la lignée puis effectuer la QA complète avant publication. Refonte des créatures 0–5 autorisée ensuite, puis stabilisation/mise en service. Estimation initiale avec le socle 0–5 : 33,60 €, hors validations/corrections restantes ; ce n’est pas une garantie de coût final.

## Consigne exacte de génération

```text
Edit IMAGE 1, the two-stage Arbélune study whose growth direction the user has chosen. IMAGE 2 is the unchanged approved BABY, supplied only to anchor species identity and anatomy. Output one corrected two-character study, never redraw or include the baby.
PRESERVE from image 1: the LEFT juvenile with a low supple wooden arch and slender roots, the RIGHT mature creature with a tall elevated arch and massive developed roots. Preserve their markedly different proportions, warm russet bark and cream wood, friendly central faces with two brown eyes and a visible smile, drawing style, poses and left/right order. This is a limited anatomy correction, not a new species or a redesign of the growth direction.
CORRECTION 1 — FOUR NATURAL HOLLOW OPENINGS ON EACH CREATURE: retain the juvenile's four hollows and give the adult the SAME FOUR distinct hollows, exactly TWO to the left of its central face and TWO to its right. Leave white visible through each opening. Keep the large central inverted-U opening below the face OPEN to the ground. Do not merge hollows, replace them with eyes or markings, hide them behind the face, or close the underside with a wooden bar.
CORRECTION 2 — SIX DISTINCT LIVING ROOT LEGS ON EACH CREATURE: exactly THREE separate roots emerge from the left end of each arch and THREE from the right end, matching the baby's body plan. Show all six complete roots and their six feet, with clear white gaps between them. Stagger each trio slightly in a shallow three-quarter front view so no root is hidden behind another. Each root is one unbranched support ending in one rounded foot; no extra twigs, dangling offshoots or duplicate legs.
LEFT JUVENILE: correct the excessive thin twig supports to six slender but softly rounded, tapering woody roots. Each has one gentle bent joint and a small rounded pad. They remain outward-leaning, youthful, flexible and substantially thinner and shorter than the mature roots. Keep the low open arch and conspicuous friendly face. Avoid needle legs or a spidery tangle.
RIGHT MATURE: replace the TWO FUSED PILLARS with SIX long substantial, individually readable woody roots, three per side. Separate them from their attachments just beneath the arch down to their own feet, with visible white space along their lengths. Each has a gentle load-bearing bend, developed bark and a broad soft rounded foot. Keep the tall vault, mature height and thick root proportions from image 1. Do not shorten it into the juvenile silhouette. The mature creature stands on six living limbs and must remain a mobile garden companion, not a fixed doorway or architectural prop.
Maintain the warm expressive faces at a size readable in a 128-pixel thumbnail. Keep clean rounded 2D storybook shapes, warm brown outlines and minimal gentle shading. No crown, accessories, scenery, flowers or added branches.
One square white canvas, juvenile on the left and mature on the right, full bodies separated by a clear white central gap. Keep their contrasting silhouettes while fitting both comfortably with generous white margins around every foot. No labels, letters, numbers, frame, border, ground shadow or watermark.
```
