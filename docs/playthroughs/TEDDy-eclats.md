# TEDDy — Choisir un compagnon avec ses éclats

10 septembre 2026 · `app/` · branche locale `feat/teddy-first-slice`.

La tranche **éclats → compagnon manquant → acquisition → collection** est livrée localement et vérifiée techniquement. Elle attend son essai utilisateur. La direction artistique et les deux premières tranches restent validées ; aucun nouvel essai utilisateur de la boutique ou des éclats n’est présumé.

## Parcours livré

Depuis « La cabane aux œufs », le lien **« Choisir un compagnon avec mes éclats »** ouvre `/boutique/eclats`. Le catalogue présente les compagnons communs et rares manquants, regroupés par monde accessible. Chaque choix mène à l’art en grand, l’histoire, le coût, le solde actuel et le solde après invitation. Un choix peut être changé sans dépenser. Sans assez d’éclats, l’écran explique leur provenance et permet de poursuivre l’aventure.

L’invitation confirmée débite les éclats, journalise la dépense, crée la possession et conserve le reçu dans une seule transaction. Les tarifs configurés sont réutilisés : **commune 60 / rare 150 éclats**. Les légendaires restent réservées aux gardiens, même si un drapeau de catalogue est erroné. Aucun changement aux pièces, étoiles, pitié ou règles pédagogiques.

Le reçu retrouve le compagnon acquis après coupure ou fermeture. Deux intentions concurrentes sont liées à la rencontre en attente ; leur rejeu reste sans nouvelle dépense après acquittement. La destination de sortie survit à une réponse perdue. La fiche et la collection affichent la possession réelle et les mécanismes de surnom existants. Évolution et arts de stades restent la tranche suivante.

Le catalogue utilise les données réelles des mondes accessibles, **y compris les mondes générés**, sans liste limitée aux mondes initiaux. Les thèmes, créatures et règles de génération/progression sont conservés. La forêt utilisée actuellement comme scène commune reste provisoire ; la déclinaison de décors réellement différents est toujours inscrite à la feuille de route.

Contrat : [ADR 0021](../adr/0021-acquisition-ciblee-persistante.md). Migration additive `0020_teddy_shard_receipts.sql`.

## Vérifications ciblées

- **47 nouveaux tests**, et **81 tests ciblés réussis** avec les contrôles boutique/œufs voisins. SQLite réel pour les actions, l’économie, les refus, les mondes générés, l’isolation des profils, les suppressions en cascade et les reçus. Interface pour le coût, le choix sans dépense, double clic, stockage refusé/corrompu, coupure, fermeture, destinations et focus après reprise.
- Pannes d’insertion du journal, de la possession et du reçu provoquées **après le débit** : tout est annulé. Le retrait expérimental de la transaction fait échouer précisément ces tests ; code restauré et contrôles repassés. [Trace de mutation](teddy-shards/rollback-mutation.txt).
- ESLint ciblé, TypeScript et format passent ; build de production réussi. Une nouvelle génération Drizzle ne produit aucun changement.
- **Anciens tests et couverture globale différés** selon la demande utilisateur. La suite globale et l’ancien canari n’ont pas été relancés pour cette tranche ; leur adaptation et le gate à 100 % restent distincts avant PR. Aucun seuil abaissé, aucune review de PR revendiquée.

## Parcours navigateur avec gains réels

[Script](../../scripts/check-teddy-shards.mjs), [rapport](teddy-shards/verification.json).

La base dédiée `data/teddy-shards-check.sqlite` est une copie cohérente de la base du précédent parcours boutique, ouverte en lecture seule pour la copie. Point de départ : **30 pièces, 10 éclats, 4 œufs déjà achetés**. Aucun gain ni compagnon n’a été injecté pendant le parcours.

Chromium joue **14 niveaux, dont deux gardiens, soit 146 calculs**, puis ouvre **9 œufs supplémentaires**. Les doublons naturels portent le solde à **60 éclats**, avec **60 pièces** restantes. Bulle est choisie puis acquise pour 60 éclats : **une seule dépense ciblée, une seule possession, 0 éclat et toujours 60 pièces**. Le premier monde est alors complet dans l’album, et le troisième monde accessible.

L’achat perd sa réponse après écriture et reçoit un double clic. Un second navigateur avait préparé une autre cible : sa réponse est également perdue. Le premier retrouve Bulle après fermeture ; l’acquittement perd ensuite sa réponse, puis la réouverture atteint la fiche. Le second navigateur reprend après cet acquittement : il retrouve la même Bulle, sans acheter son autre cible. Art identique dans le choix, la rencontre, la fiche et la collection ; le compagnon acquis disparaît du catalogue des manquants.

Catalogue, choix et rencontre vérifiés à **1280, 1024, 390 et 320 px**, avec mouvement réduit, cibles d’au moins 44 px, sans débordement horizontal ni `pageerror`. Les captures ont été ouvertes et inspectées. Le choix est également activé au clavier.

Captures : [catalogue](teddy-shards/catalogue-1280.png), [éclats manquants](teddy-shards/01-not-enough.png), [choix et coût](teddy-shards/choice-1280.png), [rencontre retrouvée](teddy-shards/encounter-1280.png), [rencontre à 320 px](teddy-shards/encounter-320.png), [fiche](teddy-shards/02-companion.png), [collection](teddy-shards/03-collection.png).

## Données familiales et aperçu

**`data/multiplyz.sqlite` est restée la base active.** Après sauvegarde cohérente et essai sur une copie isolée, le migrateur de **schéma seul** a ajouté `shard_receipts`, vide, et une entrée au journal Drizzle. Les **23 tables applicatives préexistantes conservent exactement toutes leurs lignes**, comparées par empreinte avant/après. Intégrité SQLite `ok`. Aucun seed familial ni remplacement de base. [Rapport de préservation](teddy-shards/data-preservation.json).

Sauvegarde de secours : `data/backups/teddy-before-shards-20260910T175815Z.sqlite`, 262144 octets, SHA-256 `279fe8e80949a70287a65a774f3ee4a09dd296136ad8f0ee60ffd57146a0a55e`.

**Aperçu familial : http://127.0.0.1:3217.** Serveur dev direct, Node 22, base active et aucun seed :

```sh
DATABASE_PATH=data/multiplyz.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

Les changements locaux antérieurs sont conservés. Aucun commit, PR, merge ou déploiement.

## Reproduire le parcours isolé

Le script attend le point de départ exact de l’essai boutique (10 éclats), pas sa propre base déjà consommée. Arrêter le serveur du worktree avant de préparer une **nouvelle** base dédiée. Conserver les résultats existants avant toute nouvelle préparation. Copier la base `teddy-shop-check.sqlite` avec SQLite backup vers `teddy-shards-check.sqlite`, jamais depuis ou vers la base familiale. Appliquer les migrations à cette base de contrôle, compiler, puis :

```sh
DATABASE_PATH=data/teddy-shards-check.sqlite GEMINI_API_KEY=local-browser-check-unused node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217
node scripts/check-teddy-shards.mjs
```

Le marqueur de clé valide uniquement la configuration du serveur local ; aucun worker ni appel fournisseur n’est lancé. Les tirages sont naturels : le nombre de niveaux et d’œufs peut varier. Remettre ensuite l’aperçu familial sur `data/multiplyz.sqlite`, sans seed.
