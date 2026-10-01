# Vrillou — adulte validé, adolescent intermédiaire préparé

11 septembre 2026. L’essai `growth-proofs/df062e4c-5223-4a34-a0cb-6ccf8d4eee5d-result.json` est terminé. Appel 117 : une image, Gemini 2.5 Flash Image, **aucune référence image** dans la requête. Appel 118 : QA Gemini 3.8 Flash, cible et références réelles, dix-sept images au total. Deux HTTP 200, finishReason STOP. Identité/croissance/milieu/originalité vrais, texte vide, unsafeScore 0,20 et styleScore 0,72 ; verdict accepté selon les seuils inchangés. Ces scores ne sont pas des probabilités.

**Validation artistique explicite de l’utilisateur : « Oui, cette direction me convient ».** Elle porte sur cet adulte de Vrillou, y compris l’allure de petit dinosaure signalée avant la réponse. Ne pas lui redemander cet accord ni corriger spontanément son long cou. Le bébé reste également validé.

[Comparaison à taille égale](growth-proof-df062-comparison.jpg) ouverte et examinée : tête nettement plus petite relativement au corps, cou et membres développés, corps allongé ; couleurs, taches, ventre clair, pieds végétaux et queue fourchue reconnaissables. Le dessin change réellement de silhouette. L’adulte est plus élancé que le bébé, avec une interprétation différente des pieds. L’avis utilisateur valide cette direction. Un essai réussi ne démontre pas encore la même réussite sur les autres espèces.

## Étape préparée : l’âge intermédiaire

`worldgen-pilot.ts --growth-adolescent` produit **un seul nouveau dessin**, Vrillou ado, depuis une description écrite, sans image de référence à la génération. Cou visible mais court, tête de taille intermédiaire, torse modérément allongé et membres en développement. Le bébé et l’adulte sont réutilisés exactement ; aucun des cinq autres compagnons n’est redessiné.

Trois nouvelles inspections suivent : bébé face au catalogue ; ado face au bébé ET à l’adulte validé ; adulte face au bébé et au NOUVEL ado. L’inspecteur accepte désormais une référence `adultRef` réservée à l’ado et demande un âge **entre les deux références**. Il ne lui demande pas d’être plus vieux que l’adulte. Une différence de taille, pose ou accessoire ne suffit toujours pas. Identité/croissance, adaptation au milieu, originalité, texte/sécurité/style restent bloquants. L’échec d’une inspection rejette la lignée, sans régénérer les deux extrémités approuvées.

Accord exact : `data/teddy-world-pilot/growth-adolescent-approval.json` avec phrase utilisateur, empreintes du résultat, du brouillon, du PNG adulte et du plan antérieur. Fichiers/catalogue/progression revérifiés avant chaque appel. Deux bases en lecture seule, budget cumulé conservé, mêmes gardes. Nouveau marqueur `growth-adolescent-started.json`, résultat/brouillon/QA dans `growth-adolescents/`, galerie `preview-growth-adolescent-*.html`. Aucun retry, aucun remplacement/publication. Conserver le marqueur même après interruption ; ne pas relancer les anciennes passes.

Depuis `app/`, Node 22, dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-adolescent
```

**Plan sans API exécuté : 0,25 € supplémentaires**, une image et trois inspections ; **8,80 € cumulés prévus sur plafond autorisé 30 €**. État actuel : 118 appels, 8,55 € réservés. Aucun appel de cette nouvelle passe lancé ici ; restriction réseau antérieure inchangée. Le futur ado reste à examiner avant extension de la méthode aux autres créatures.

## Suite et contrôles

Refonte 0–5 toujours autorisée et à réaliser : 41 nouveaux compagnons, 20,50 € d’estimation initiale hors corrections. Avec le pilote et ce prochain essai : 29,30 €, marge 0,70 €, **hors reprises encore nécessaires des autres âges du pilote**. Recalculer avant élargissement ; aucune hausse automatique ni dépense générale engagée. Préserver tous les ids/possessions/surnoms/stades/reçus/sessions, les arts existants et les thèmes réels.

83 tests ciblés distincts passent, dont huit nouveaux sur l’ado, les références et l’approbation. Typage/lint/format ciblés passent. Plan CLI réel sans API, suivi et contrôle de préservation en lecture seule : **26 tables familiales identiques, intégrité ok**. Aucun nouveau seed/migration/restauration ni écriture de la base active. Pas de nouvel essai familial/WebGL, anciens tests/couverture/canari toujours différés. Ces contrôles techniques ne prouvent pas l’apparence du futur ado.
