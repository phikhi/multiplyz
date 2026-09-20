# Arbélune : sortir des copies d’âge par une étude conjointe

> Mise à jour : l’étude a été exécutée (appel 191, 13 € cumulés). [Résultat et examen des silhouettes](arbelune-study-357ee-review.md). La commande de préparation décrite ci-dessous est désormais consommée.

11 septembre 2026. Retour utilisateur : **« l'ado = l'adulte. c'est pas bon »**. Résultat `arbelune-adolescents/ee150fe7-9638-4cab-b1dc-7e07fc207048-result.json` : **rejected**, ado identité/croissance fausses ; adulte identité vraie mais croissance fausse face au nouvel ado. Visage lisible aux trois âges. Les seize autres images passent la QA. **190 appels / 12,90 € réservés / plafond cumulé 40 € déjà autorisé**, aucune publication.

## Constats établis

Le nouvel ado a été ouvert, puis [la comparaison réelle des trois âges](arbelune-ee150-comparison.jpg). Il reprend presque toute la silhouette de l’adulte : corps arqué, position de la tête et des ouvertures, longueurs/angles des racines. Le changement de petite courbure ne crée pas un âge. L’adulte n’a pas changé de pixels ; sa croissance devient insuffisante **par rapport au nouvel ado**, ce qui explique son nouveau refus. Son ancien oui ne vaut donc pas validation de cette paire.

La trace 172 a été vérifiée : le prompt est bien celui de la recette et les deux empreintes d’images transmises correspondent exactement au bébé puis à l’adulte. Ce n’est pas un oubli des références dans le client. L’essai à deux références a conservé l’arche mais n’a pas produit un âge intermédiaire distinct. Ne pas relancer ce prompt ni passer outre les refus.

Rejet utilisateur conservé séparément dans `arbelune-ee150-user-review.json`, lié aux deux PNG et au run ; résultats, images et réservations antérieurs intacts. Les corrections successives ont traité un âge à la fois et déclenché trop tôt les dix-huit QA du groupe. La prochaine étape redevient une conception des **deux** formes ensemble.

## Étude préparée, hors du catalogue

Nouvelle commande **`--arbelune-study`** : une seule image d’étude contenant ado à gauche, adulte à droite. Une seule référence de génération : le bébé exact, déjà approuvé. L’ancien adulte n’est pas envoyé, pour ne pas imposer sa silhouette aux deux formes.

Différences proposées, à évaluer sur la future planche :

- **Ado bas et souple** : arche peu profonde et étirée, bande de bois mince, six racines encore fines avec une articulation naissante, petits pieds. Silhouette nettement plus large que haute.
- **Adulte haut et fortement développé** : voûte élevée, six longues racines épaisses et articulées, appuis élargis et écorce mûre ; racines occupant plus de la moitié de la hauteur. Silhouette presque aussi haute que large.

Même espèce : arche ouverte jusqu’au sol, quatre ouvertures supérieures, six racines, visage crème central aux deux yeux et à la bouche lisibles, couleurs du bébé et même dessin doux. La maturation porte sur le corps et les racines, sans couronne, vêtements ou accessoires. Le bébé reste inchangé.

**Il s’agit d’une étude, pas de deux nouveaux stades livrés.** L’image entière est stockée dans `arbelune-studies/<run>-study.png`, hors du stockage des arts de jeu. Aucun détourage, extraction de stades, modification d’artRefs, QA, insertion en base ou publication. La galerie montre le bébé original à côté de l’étude. Un résultat `study-ready-for-visual-review` n’est pas un succès QA (`qaPassed:false`, `growthGenerated:false`). Les dix-huit images actuelles restent exactes.

## Commande et budget

Depuis `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-study
```

Plan réel `--arbelune-study-plan` exécuté sans API : **1 image d’étude, 2 formes proposées, 1 référence bébé, 0 inspection**, **0,10 € supplémentaire**, cumul prévu **13 € / 40 €**. Aucun accord budgétaire supplémentaire nécessaire. Aucun nouvel appel réel exécuté ici ; restriction réseau Gemini de l’agent inchangée, aucun contournement.

Recette `arbelune-study-plan.json` liée au résultat terminal ee150, aux dix-huit PNG, au marqueur, à la trace et au rejet utilisateur par empreintes. Gardes de sources, catalogue, progression, mois et budget revérifiées avant la requête et après la réponse. Deux bases en lecture seule, réservation avant requête, aucun retry. La garde HTTP refuse toute inspection dans ce mode. Marqueur distinct `arbelune-study-started.json`, résultats `arbelune-studies/`, galerie `preview-arbelune-study-<uuid>.html`. Conserver tout après arrêt ; aucune ancienne commande à relancer.

## Vérifications et suite

**50 tests ciblés distincts passent** (49 lignée/reprise/étude, 1 suivi CLI), dont quatre nouveaux : une seule requête utilisant le bébé exact, zéro QA et aucune mutation des dix-huit arts/stades, budget complet avant génération, source modifiée refusée, image invalide arrêtée sans retry. Typage/lint/format réussis ; **26 tables familiales inchangées, intégrité ok**. Aucun seed, migration/restauration, modification des sessions/possessions/stades/reçus/recalibrage/Teddy. Pas de nouvelle validation artistique ni d’essai familial/WebGL. Anciennes couvertures/tests/canari différés.

Suite : **examiner la planche et ses deux silhouettes d’abord**. Si elle établit des âges réellement différents, préparer les deux stades séparés, contrôler la lignée puis refaire la QA complète avant toute publication. Ne pas supprimer les gardes finales de milieu, originalité, identité, croissance, visage ou contenu. Ne pas refaire les dix-huit QA pendant une étude qui n’a pas encore convaincu visuellement. La refonte 0–5 reste autorisée et attend ce socle artistique stable ; stabilisation et mise en service ensuite. Avec cette seule étude et les 20,50 € initiaux estimés du socle 0–5 : 33,50 €, **hors validations/corrections restantes** ; ce n’est pas une promesse de coût final.
