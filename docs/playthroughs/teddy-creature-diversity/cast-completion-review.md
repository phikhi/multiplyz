# Vrillou validé — compléter les cinq autres lignées

11 septembre 2026. L’ado produit par l’appel 120 et les trois inspections 121–123 sont réussis (HTTP 200). Résultat `growth-adolescent-clarifications/94113477-61d2-4085-8022-b433db9f3ef1-result.json`, trois QA positives : bébé style 0,95 / unsafe 0 ; ado identité/croissance/milieu/originalité vrais, style 0,90 / unsafe 0 ; adulte mêmes comparaisons vraies, style 0,72 / unsafe 0,10. **8,90 € réservés cumulés, 123 appels**. Aucun dessin publié, aucune écriture de base.

Les pixels de l’ado ont été ouverts, puis [les trois âges à taille égale](growth-lineage-941134-comparison.jpg). Le bébé est compact à grosse tête ; l’ado a un corps allongé mais une tête encore importante et un cou plus court ; l’adulte est élancé avec un petit visage et un long cou. **Retour explicite de l’utilisateur : « c’est bon pour moi ». Les trois âges de Vrillou sont validés**, en plus des six identités bébé déjà approuvées. Les conserver exactement et ne pas redemander cet accord.

## Cinq lignées préparées

| Créature | Progression demandée |
| --- | --- |
| Samarine | Graine ronde → corps étiré et voiles intermédiaires → longue graine fuselée et grandes voiles en faucille. Exactement deux voiles. |
| Nacélie | Coques rondes → chambres ovales verticales → deux hauts réservoirs fuselés, visage relatif plus petit, tige développée. |
| Rosélice | Arche compacte → insecte allongé à taille naissante → thorax/abdomen élancés et six longues pattes articulées à palettes. |
| Spirélis | Corps compact → pied et corps allongés → long corps bas, petit visage et hautes parois de la même coquille ouverte en U. |
| Arbélune | Petite arche → portée intermédiaire sur racines développées → grand pont vivant allongé sur six piliers enracinés ; quatre petites ouvertures hautes conservées. |

Recettes dans `data/teddy-world-pilot/cast-completion-plan.json` : dix descriptions propres aux espèces et à leurs milieux, accord lié aux empreintes du résultat/brouillon/arts validés. Aucun nom, bébé, thème ou personnage Teddy changé. Les deux âges de Vrillou sont exclus de la génération. Génération **depuis le texte uniquement**, comme les deux âges validés de Vrillou ; cinq formes adultes puis cinq formes intermédiaires. La réussite sur les cinq autres espèces reste à vérifier sur leurs futurs pixels.

Les **dix-huit images finales** sont ensuite réinspectées ensemble : chaque ado se situe entre son bébé et son adulte ; chaque adulte est comparé au bébé et au nouvel ado. Les références comprennent tous les autres compagnons historiques et tous les âges des autres créatures finales. Pas de réutilisation des anciennes QA positives ou négatives. Seuils, gardes de milieu/originalité/identité/croissance et filtrage fournisseur inchangés. Un nouveau refus arrête/rejette la passe ; aucune boucle de correction ni publication automatique.

## Budget accepté et commande

Après information du total estimé à 31,30 €, l’utilisateur demande **« augmente a 40 si besoin »**. Le besoin est établi ; le plafond cumulé de **40 €** est enregistré dans `budget-authorization-40.json`, après les accords 10/30 €, sans supprimer de réservation. Ne pas redemander cet accord. Le code exige la chaîne complète des accords et conserve les 8,90 € déjà réservés.

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-completion
```

Depuis `app/`, sous Node 22, Terminal utilisateur : le réseau Gemini reste indisponible dans cet environnement, aucune nouvelle tentative de contournement. Plan sans API exécuté : **dix images, six bébés réutilisés, deux âges de Vrillou réutilisés, dix-huit inspections**, **1,90 € supplémentaires, cumul prévu 10,80 € / 40 €**. Nouveau marqueur `cast-completion-started.json`, brouillons après chaque image, QA/bilan dans `cast-completions/`, galerie `preview-cast-completion-*.html`. Tout conserver en cas d’interruption ou refus ; ne relancer aucune ancienne commande et ne supprimer aucun marqueur.

Gardes : source approuvée et toutes ses empreintes, ancien catalogue et progression revérifiés avant chaque appel ; réservations avant requêtes ; deux bases en lecture seule ; PNG immuables, anciennes images exclues de toute recopie. Aucune nouvelle commande de publication du monde ou de remplacement du socle. L’estimation du socle 0–5 reste **20,50 €** pour 41 créatures/123 images et les deux passes de QA, soit **31,30 € cumulés** avec ce groupe réussi ; marge **8,70 €** sur 40 €, hors nouvelles corrections/conception payante. Pas un engagement à dépenser tout le plafond.

## Vérification

**38 tests ciblés distincts passent**, dont sept nouveaux sur cette passe et un sur le plafond 40 €. Dix générations sans référence image, conservation des dix-huit anciens fichiers et de Vrillou, dix-huit QA avec les nouveaux pairs, budget complet avant appel, arrêt sans retry, empreintes/approbation/slots vérifiés. Typage/lint/format ciblés passent. Plan CLI réel et suivi sans API, **26 tables familiales identiques et intégrité ok**. Aucun nouveau dessin produit ici, aucun seed/migration/restauration, aucun nouvel essai familial/WebGL ; anciens tests/couverture/canari toujours différés.

Suite : résultat des cinq lignées → examen du groupe complet → refonte des mondes 0–5 avec thèmes/identifiants/possessions/surnoms/stades/reçus/sessions préservés → stabilisation et mise en service familiale. Les autres anciennes passes restent historiques et ne doivent pas être relancées.
