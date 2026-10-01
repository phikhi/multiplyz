# Examen de la deuxième passe de croissance — 4092

11 septembre 2026. Résultat réel `cast-redesigns/4092a831-7c45-4a54-b632-f024ddb585f6-result.json` : douze nouveaux PNG (appels 87–98), dix-huit inspections (99–116), toutes HTTP 200. Sept refus de croissance. **8,40 € réservés cumulés / plafond autorisé 30 €**, aucune publication.

## Pixels examinés

Les dix-huit arts ont été ouverts en trois planches, avec dimensions d’affichage normalisées : [Vrillou/Samarine](growth-inspection-4092-1.jpg), [Nacélie/Rosélice](growth-inspection-4092-2.jpg), [Spirélis/Arbélune](growth-inspection-4092-3.jpg).

| Créature | Observation | QA ado / adulte |
| --- | --- | --- |
| Vrillou | Même tête énorme et corps compact ; ajout d’une branche. Les proportions demandées sont absentes. | Refus / refus |
| Samarine | Ado surtout ailes allongées ; adulte à graine nettement plus effilée. Cela ne valide pas artistiquement la lignée. | Oui / oui |
| Nacélie | Coques et visage proches ; tige et racines font l’essentiel de la différence. | Refus / refus |
| Rosélice | Bébé frontal puis corps horizontal ; ado et adulte très proches. | Oui / refus |
| Spirélis | Vue inversée, gouttes et motifs ajoutés ; silhouette toujours très proche. Le oui ado paraît trop permissif. | Oui / refus |
| Arbélune | Ado presque identique ; adulte plus large, surtout épaississement des racines. Le oui adulte ne suffit pas à établir la croissance attendue. | Refus / oui |

L’utilisateur avait refusé les douze premiers stades, même les QA positives. Aucun nouvel avis artistique sur cette seconde passe n’a été rapporté. Les six bébés restent validés. Tous les verdicts bruts sont conservés.

## Diagnostic

Les requêtes archivées 87, 88 et 89 contiennent réellement les nouvelles consignes anatomiques. L’ado reçoit le bébé ; l’adulte reçoit bébé et nouvel ado. Les instructions distinguent explicitement identité et proportions et demandent des différences visibles à taille égale. Il ne s’agit donc pas d’un mode CLI oublié ou d’une injection de recette absente. La requête QA 100 demande bien proportions ET structures modifiées. Le rejeu local d’`assessAsset` sur le résultat réel reproduit les sept refus, sans abaisser les seuils.

Hypothèses examinées : (1) référence visuelle bébé trop contraignante — cohérente avec les pixels, causalité encore à tester ; (2) consignes non transmises — écartée sur les requêtes réelles ; contraintes de fidélité et d’âge encore possiblement concurrentes ; (3) QA permissive — certains oui automatiques restent peu convaincants visuellement. Une simulation HTTP ne peut prouver la qualité d’un futur dessin.

## Essai distinct préparé

`worldgen-pilot.ts --growth-proof` : **un seul adulte de Vrillou, puis une seule inspection fraîche**. Même modèle image et même QA. Génération depuis une description écrite de sa morphologie, palette, motifs et proportions adultes, **sans référence image à cette étape**. La QA conserve le bébé canonique, l’ado refusé comme témoin, tout le catalogue historique et les autres créatures aux trois âges. La référence ado est un repère diagnostique, jamais un âge approuvé. Le critère est un adulte immédiatement reconnaissable comme plus développé, tout en restant Vrillou. Si l’identité diverge ou la croissance reste insuffisante, l’essai est refusé ; aucun autre dessin automatique.

Plan/empreintes : `data/teddy-world-pilot/growth-proof-plan.json`. Chargeur lié au résultat 4092, au brouillon 12 et aux dix-huit arts hachés, plus approbation des bébés et exclusions des anciens âges. Source/catalogue/progression/recette revérifiés avant chaque appel. Deux bases en lecture seule, mêmes gardes, aucun changement du générateur familial. Un nouveau marqueur `growth-proof-started.json` empêche de refaire l’essai. PNG, trace, brouillon, QA, résultat et galerie séparés dans `growth-proofs/` / `preview-growth-proof-*.html`. Tous les originaux conservés. Ne jamais effacer le marqueur après interruption ou refus.

Plan sans API exécuté : **0,15 € supplémentaires**, cumul **8,55 € / 30 €**. Aucun appel payant de cet essai lancé ici ; restriction réseau antérieure inchangée. Commande depuis `app/`, Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-proof
```

Un résultat `passed-for-visual-review` ne valide ni le groupe ni la méthode pour toutes les espèces : examiner le dessin, puis concevoir l’ado entre les deux âges et chiffrer l’élargissement. Ne relancer ni `--cast-growth` ni `--cast-redesign`.

## Budget et périmètre restant

Le socle 0–5 reste à refaire : 41 créatures, 123 arts, estimation initiale **20,50 €** avec les deux passes de QA, hors corrections. Avec 8,40 € déjà réservés et l’essai à 0,15 €, cela ferait 29,05 €, marge 0,95 €. **Ce montant ne couvre pas la reprise encore nécessaire des autres évolutions du pilote** ; le précédent total 28,90 € supposait la réussite de la deuxième passe. Recalculer le coût après établissement de la méthode ; ne pas promettre la fin de tous les essais dans cette marge, ni augmenter automatiquement le plafond. Aucun accord à redemander pour l’essai présent, déjà couvert.

## Contrôles

32 tests ciblés distincts passent (9 nouveaux sur l’essai, 10 croissance, 4 refonte, 8 approbation/budget, 1 suivi). Typage, lint et format ciblés passent. Plan CLI réel sans API et suivi : 116 appels, 8,40 € réservés. Préservation en lecture seule : **26 tables familiales identiques, intégrité ok**. Aucune migration/seed/restauration, aucune écriture de la base active. Pas de nouvel essai familial ou WebGL, ni de reprise des anciens tests globaux/couverture/canari. La nouvelle image n’existe pas encore ; la correction artistique reste à démontrer.
