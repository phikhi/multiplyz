# Génération groupée, puis revue humaine

**Lot désormais intégré au jeu** : 47 créatures, 141 images, monde 6 actif, données familiales préservées. Aucun nouveau lancement de génération requis. [Livraison et contrôles](../TEDDy-integration-creatures.md).

**Validation finale utilisateur : « tout est bon ».** Les 141 images des 47 créatures (trois âges, mondes 0–6) sont approuvées artistiquement. Manifeste définitif `data/teddy-world-pilot/renewal-visual-approval.json` : références/empreintes exactes, identifiants du socle, Friselot corrigé inclus. Aucun dessin à reprendre ni nouvelle validation artistique à demander. Intégration dans le jeu à préparer ; aucune publication ou inspection payante effectuée ici.

## Dernier état — Friselot ado détouré, aucun appel requis

Nivéo ado a été généré : reprise terminée sans anomalie, 141 images disponibles. L’utilisateur accepte le résultat, sauf un fond blanc résiduel sur Friselot ado (monde 3, slot 3, stade 2), corrigé localement. Son cadre brun fermé retenait le blanc malgré le statut technique ready. Recadrage 32 px, détourage existant et restitution du canevas 1024 : 90 % transparents, chaque pixel opaque du dessin identique. PNG examiné sur fond sombre. Les deux galeries world-3.html pointent vers ce seul dérivé ; tous les autres dessins sont inchangés.

Correction additionnelle archivée dans `data/teddy-world-pilot/friselot-adolescent-matte-repair.json` (original/dérivé et empreintes). **Appliquer cette substitution de référence lors de toute future reconstruction de galerie ou intégration**, en plus du lot sélectif ; les anciens marqueurs, plans et résultats restent immuables. Ne pas relancer les commandes terminées. Galerie courante : `data/teddy-world-pilot/renewal-batch-repair/index.html`.

Aucun appel payant pour Friselot. Budget inchangé **29,65 € / 40 €**, dernier appel 396. Aucune modification de code métier ou des gardes ; aucun nouveau test nécessaire pour ce détourage local. Les images de galerie existent et 26 tables familiales sont inchangées, intégrité SQLite correcte. Rien publié.


## Reprise sélective — fonds et image manquante seulement

L’utilisateur a terminé le lot et accepte le reste : **135 images conservées exactement**. Le lot a livré 101 nouvelles images ; 5 détourage refusés et 1 dessin absent. **29,55 € réservés / plafond 40 €.** Aucun nouvel avis artistique à demander sur le reste.

**Cinq fonds corrigés localement**, zéro appel : Véliane ado (1-0-2), Ourlane ado (2-5-2), Pectine ado (3-2-2), Hydrelle ado (4-1-2), Sablune adulte (5-5-3). Cadres extérieurs retirés par recadrage 32 px, marge blanche contrôlée, flood-fill existant puis toile 1024 px restaurée par marge transparente. Tous les pixels opaques du dessin restent identiques. PNG distincts, originaux et ancien bilan intacts. Transparence examinée sur fond sombre.

**Il reste Nivéo ado (2-2-2)** : réponse originale `PROHIBITED_CONTENT` sans image, conservée. Description clarifiée en anglais d’un animal fictif, oiseau de neige au stade intermédiaire, dans le même style et avec les mêmes attributs ; aucun filtre désactivé. Une seule nouvelle tentative autorisée, aucune inspection payante. Ne reprendre aucun autre dessin.

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-batch-repair
```

Dans `app/`, Node 22, Terminal utilisateur (réseau Gemini agent déjà indisponible). Plan réel `--renewal-batch-repair-plan` : **1 génération, 140 PNG réutilisés, 0,10 € supplémentaires → 29,65 € / 40 €**. Galerie déjà préparée : `app/data/teddy-world-pilot/renewal-batch-repair/index.html`. Les cinq fonds corrigés sont visibles ; Nivéo ado sera ajouté après la commande. Même commande pour reprendre sans repayer une tentative enregistrée.

Recette `renewal-batch-repair-plan.json` : empreintes des 102 résultats, de l’ancien bilan, de chaque source et de chaque dérivé. Toute reprise d’un âge déjà réussi est refusée. Les anciens résultats et réservations sont intacts ; journal global/verrou/budget communs. Aucun appel Gemini exécuté par l’agent. Base familiale toujours en lecture seule, 26 tables inchangées/intégrité correcte ; aucune publication.

Contrôles : 7 tests ciblés réussis, typage/lint/format corrects ; 140 images présentes dans la galerie, 5 détourages examinés, appel global 395 inchangé.

## Historique — lot complet


Demande utilisateur : générer la totalité restante en une fois ; l’utilisateur indiquera ensuite les corrections monde par monde. Cette consigne remplace les anciennes étapes de correction/inspection unitaires. Réponses courtes.

Dans `app/`, sous Node 22 :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-batch
```

102 images : les trois âges des 34 créatures des mondes 1 à 5. Les 21 arts actuels du monde 0 et les 18 du pilote sont conservés. Chaque espèce possède ses couleurs, matériaux, anatomies et milieu propres dans `data/teddy-world-pilot/renewal-batch-plan.json`. Aucune inspection payante ou correction automatique avant la revue utilisateur. Les anciens refus restent enregistrés ; ce lot n’accorde aucune validation QA.

Budget au départ : **19,35 € réservés**, **10,20 €** supplémentaires prévus, **29,55 € / plafond 40 €**. La seconde correction de Pivertin est terminée et conservée (`cbbf5332-32ed-483e-804b-cb5cd384a97c`, trois QA, refus prioritaire). Ne pas la relancer.

Galerie produite progressivement : `app/data/teddy-world-pilot/renewal-batch/index.html`, avec une page par monde. Un détourage douteux conserve l’image brute pour la revue et laisse continuer le lot. Une erreur réseau/HTTP suspend le lot. Même commande pour reprendre : les images et tentatives enregistrées ne sont jamais repayées automatiquement ; un appel interrompu sans image devient une case à reprendre ultérieurement.

Le mode `--renewal-batch-plan` vérifie le plan et le budget sans appel API. Le réseau Gemini de l’agent étant déjà constaté indisponible, le lancement payant reste dans le Terminal utilisateur. Aucun nouveau diagnostic réseau.

Base familiale ouverte en lecture seule, aucun remplacement/seed/migration ; arts existants, sessions, possessions et progression préservés. Aucune publication dans le jeu. Les gardes de publication restent en place pour l’intégration après revue/corrections. Ancienne couverture et canari différés.

Contrôles de cette tranche : 5 tests ciblés passent (reprise, détourage, budget, arrêt réseau, intégrité et statut), typage/lint/format réussis ; plan réel sans API vérifié ; 26 tables familiales inchangées, intégrité SQLite correcte. Aucun appel Gemini lancé par l’agent.
