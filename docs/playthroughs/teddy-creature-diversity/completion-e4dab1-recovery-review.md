# Dix évolutions conservées — reprise des inspections après détourage

11 septembre 2026. `--cast-completion` s’est arrêté après l’appel 133, avant la première QA. Les dix réponses 124–133 sont HTTP 200 / STOP, dix fichiers bruts présents ; neuf dessins détourés sont enregistrés dans les brouillons 1–9. Résultat original intact : `cast-completions/e4dab1f0-a78d-468b-ab14-9fb4237277c4-result.json`. **133 appels, 9,90 € réservés cumulés, plafond 40 € déjà autorisé.** Pas de nouvelle génération à payer pour récupérer ce groupe.

## Diagnostic et récupération locale

Erreur reproduite directement en donnant `storage/worldgen/raw/133-0.png` à `cutoutNewCreature` : « Détourage non fiable : le fond doit être blanc et dégagé aux bords. » Les pixels ont été ouverts : la créature est l’ado d’Arbélune, entouré d’un cadre noir et gris extérieur à une zone blanche. Le rejet du fond est correct ; ce n’est ni un refus fournisseur ni un verdict d’identité/croissance.

Recadrage explicite de cette seule réponse 1024 × 1024 : **left 120, top 120, width 784, height 784**. Une couronne intérieure blanche de 2 % est contrôlée pour ne couper aucune partie de la créature. Le détourage blanc habituel est ensuite appliqué sans modifier ses seuils. Aucun redessin ou changement de couleur/anatomie. Le fichier brut et les neuf dessins précédents restent exacts. Chaque dessin déjà sauvegardé a aussi été comparé à un nouveau détourage de sa réponse brute : correspondance binaire après normalisation PNG.

Nouveau fichier dérivé : `world/6/runtime-745b665d-8174-46ef-b5b5-7313361f1f6c-legendary-ado.png`. Groupe complet : `cast-completion-recoveries/a254022b-d3cc-45d0-9eb0-3acd20c673fd-prepared.json`. Recette immuable `cast-completion-recovery.json` : arrêt source, marqueur, dix brouillons, dix réponses brutes, trace de cette passe et dix-huit PNG liés par empreintes. Les dix-sept autres arts du groupe, dont tous les bébés et Vrillou complet, sont conservés exactement. Aucun ancien fichier n’a été écrasé.

Galerie locale complète : [les six lignées récupérées](../../../data/teddy-world-pilot/preview-cast-completion-recovered-e4dab1f0-a78d-468b-ab14-9fb4237277c4.html). Les dix-huit chemins d’image sont présents. Planches réelles examinées : [Vrillou/Samarine](completion-e4dab1-recovered-1.jpg), [Nacélie/Rosélice](completion-e4dab1-recovered-2.jpg), [Spirélis/Arbélune](completion-e4dab1-recovered-3.jpg).

## Qualité à établir

Les changements de proportions sont plus nets que les copies bébé rejetées auparavant. La récupération technique ne valide cependant pas les nouvelles identités : yeux de Nacélie ado différents, motif spiralé sur la coquille de Spirélis ado, nombre/agencement des ouvertures et position/lisibilité du visage d’Arbélune changés. Ces observations locales restent à confronter à la QA puis à l’utilisateur ; aucune approbation des cinq nouvelles lignées n’est acquise. Vrillou et les six bébés restent approuvés.

## Commande suivante prête

Dans `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-completion-inspect
```

Plan réel `--cast-completion-inspect-plan` exécuté sans API : **0 image générée, 18 images existantes, 18 inspections, 0,90 € supplémentaires, cumul prévu 10,80 € / 40 €**. Accès Gemini toujours bloqué dans l’environnement de l’agent : aucun nouvel appel ni contournement tenté. Aucun accord budgétaire supplémentaire nécessaire.

La nouvelle commande ne dispose d’aucune génération dans son parcours de reprise ; une garde HTTP refuse aussi toute requête d’image avant réservation. Elle conserve les gardes du monde futur, du thème réel, du catalogue, de la progression, des accords et du budget. Les empreintes de la récupération sont revérifiées avant chaque inspection et après la passe. Les deux bases sont ouvertes en lecture seule.

Les dix-huit QA sont fraîches, avec les mêmes seuils et les références réelles du catalogue/pairs. Chaque ado est comparé au bébé ET à l’adulte ; chaque adulte au bébé et au nouvel ado. Tous les pairs finaux sont présents. Un verdict négatif reste un rejet ; aucun âge n’est corrigé automatiquement, aucun monde n’est publié. La récupération refuse un ancien refus QA ou une passe qui aurait déjà engagé ses inspections.

Nouveau marqueur : `cast-completion-inspect-started.json`. Brouillon/QA/bilan : `cast-completion-inspections/`. Galerie de la future passe : `preview-cast-completion-inspect-<uuid>.html`. **Ne pas relancer --cast-completion, ni effacer un ancien marqueur ou résultat.** Tout conserver en cas d’arrêt de cette inspection.

## Vérification et suite

**43 tests ciblés distincts passent** (34 lignée/reprise, 3 recadrage, 5 détourage/croissance, 1 suivi CLI). Neuf tests ajoutés : cadre refusé par la garde générale, recadrage aux marges dégagées, couleurs/marques pâles préservées, dix-sept arts inchangés, dix-huit QA sans génération, budget complet préalable, trace/pixels altérés refusés, aucune reprise de refus QA. Typage, lint et format ciblés réussis. Plan réel sans API vérifié ; **26 tables familiales identiques, intégrité ok**. Aucun seed, migration/restauration de base active, changement de sessions/recalibrage/possessions/arts livrés. Pas de nouvel essai familial/WebGL ni reprise de la couverture globale ou de l’ancien canari.

Suite : inspections des dix-huit arts → examen du résultat et corrections éventuelles ciblées → refonte 0–5 déjà autorisée, avec thèmes/ids/possessions/surnoms/stades/reçus/sessions préservés → stabilisation et mise en service familiale. Budget initial 0–5 toujours estimé 20,50 €, cumul avec cette QA 31,30 € hors corrections/conception payante, dans le plafond 40 €.
