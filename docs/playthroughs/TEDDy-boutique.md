# TEDDy — Pièces, œuf et rencontre

10 septembre 2026 · `app/` · branche locale `feat/teddy-first-slice`.

Cette tranche prolonge les deux expériences déjà validées : **pièces gagnées en jouant → boutique → œuf → rencontre → collection et fiche**. La forêt, la caméra, les compagnons du catalogue et l’économie existante restent la référence. La validation utilisateur des deux premières tranches reste acquise ; cette nouvelle tranche attend son essai.

## Parcours livré

- « La cabane aux œufs » sur la carte mène à la clairière : œuf dessiné en CSS/SVG devant la forêt 3D, solde réel, prix et solde après achat, accès libre à la suite de l’aventure. Aucun argent réel, aucune pression temporelle.
- Sans assez de pièces, l’enfant peut poursuivre son chemin. Un catalogue indisponible ne provoque aucun débit.
- L’achat conserve le tirage atomique existant, ses mondes accessibles, ses doublons, ses éclats et sa pitié. Les légendaires restent réservées aux gardiens.
- Le reçu est désormais enregistré dans la même transaction. Double clic, réponses perdues et onglets concurrents restituent le même résultat. Une panne au reçu annule aussi les écritures économiques.
- L’œuf attend un clic ou une activation clavier pour s’ouvrir, sans nouveau tirage. La rencontre présente l’art et l’histoire réels en grand. Le doublon affiche ses éclats ; la pitié garde sa règle configurée.
- « Retrouver mon compagnon » acquitte le reçu avant d’ouvrir sa fiche. La destination résiste à une coupure puis une fermeture. L’album et le surnom réutilisent la tranche compagnons validée.
- Une intention locale appartient à son profil ; un changement de joueur interdit de la dépenser dans un autre portefeuille. Le reçu serveur reste disponible sans le stockage local ; celui-ci conserve aussi la phase révélée lorsque possible.

Contrat : [ADR 0020](../adr/0020-rencontre-oeuf-persistante.md), [ECONOMY](../../ECONOMY.md), [SYNC](../../SYNC.md). Migration additive `0019_teddy_egg_receipts.sql`, sans changement des tables de progression ou de portefeuille existantes.

## Vérifications techniques distinctes

- **2 560 tests passent.** Actions de boutique et module serveur `egg-receipt.ts` : **100 % lignes, fonctions et branches**. Tests de coût serveur, refus, rejeu, perte de réponse, deux intentions concurrentes avant/après acquittement, isolement des profils, cascade, annulation au reçu, doublons et pitié.
- Les tests d’interface vérifient le double clic, la fermeture/reprise, la destination, le stockage refusé ou corrompu, l’expiration de session, le prix, l’art et le focus après retry. Les couples de couleurs informatifs atteignent 4,5:1 dans les deux thèmes.
- ESLint, TypeScript et build de production réussis. Le schéma et la migration sont générés ensemble ; une nouvelle génération ne produit aucun changement.
- Revues source locales Standards et Produit approuvées après corrections. Les captures ont été ouvertes par l’orchestrateur et les reviewers. Ce sont des revues locales, pas des reviews de PR.
- Le parcours a détecté un vrai défaut de navigation : `router.refresh()` immédiatement après `router.replace()` pouvait laisser la boutique affichée. Le refresh est désormais réservé au retour interne à la boutique ; la navigation vers la fiche est vérifiée dans le navigateur compilé.
- **Avant PR, séparément : couverture globale toujours sous le gate de 100 %** (97,47 % lignes/statements, 97,91 % fonctions, 98,08 % branches). Les branches restantes incluent l’orchestration des premières tranches et le client boutique. Aucun seuil ni périmètre de couverture abaissé. **Le canari historique `e2e/auth.spec.ts` reste à adapter et exécuter.**

## Parcours navigateur isolé

Le script [check-teddy-shop.mjs](../../scripts/check-teddy-shop.mjs) utilise Chromium, l’application compilée et SQLite réel. Le seed prépare uniquement le foyer et les données pédagogiques dans `data/teddy-shop-check.sqlite` ; aucun gain, progrès ou compagnon n’est injecté pendant la partie.

**Résultat observé : 8 niveaux de 10 calculs, 4 achats, 3 compagnons distincts et 10 éclats de doublon ; solde final 30 pièces.** Aucun `pageerror`. Boutique et rencontre contrôlées à 1280, 1024, 390 et 320 px, sans débordement horizontal ; illustration de 440 px sur ordinateur et 288 px à 320. Mouvement réduit vérifié.

Le rapport final et ses captures se trouvent dans [teddy-shop](teddy-shop/verification.json). Le parcours couvre : boutique sans pièces ; deux niveaux pour gagner les 50 premières pièces ; achat avec réponse perdue après écriture et double clic ; fermeture puis même œuf retrouvé ; art identique à la rencontre et sur la fiche ; acquittement avec réponse perdue puis fermeture et arrivée sur la fiche ; nouveaux gains par le jeu jusqu’à observer un doublon naturel et ses éclats ; retour à la boutique puis album. La pitié est exercée de façon déterministe dans SQLite, sans falsifier un tirage du parcours navigateur.

Captures : [boutique](teddy-shop/02-shop.png), [œuf retrouvé](teddy-shop/03-egg-restored.png), [rencontre](teddy-shop/encounter-1280.png), [fiche](teddy-shop/04-companion.png), [doublon](teddy-shop/05-duplicate.png), [collection](teddy-shop/06-collection.png), [rencontre à 320 px](teddy-shop/encounter-320.png).

## Reproduire sans toucher aux données familiales

Depuis `app/`, Node 22. Arrêter le serveur utilisant ce worktree avant le seed et la compilation.

```sh
DATABASE_PATH=data/teddy-shop-check.sqlite node --import tsx scripts/seed-teddy-shop.ts
DATABASE_PATH=data/teddy-shop-check.sqlite node --import tsx scripts/seed-dev-world-assets.ts
DATABASE_PATH=data/teddy-shop-check.sqlite node node_modules/next/dist/bin/next build --webpack
DATABASE_PATH=data/teddy-shop-check.sqlite GEMINI_API_KEY=local-browser-check-unused node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217
```

Dans un autre terminal :

```sh
node scripts/check-teddy-shop.mjs
```

Le seed refuse tout chemin différent. Le marqueur de clé ci-dessus sert uniquement à la validation locale de configuration : aucun worker ni appel fournisseur n’est lancé. Le parcours s’arrête sur un doublon naturellement tiré ; son nombre de niveaux peut donc varier.

Pour l’essai familial, relancer le serveur direct avec `DATABASE_PATH=data/multiplyz.sqlite`, sans seed. La migration de schéma seule doit avoir été appliquée ; ne pas recopier une sauvegarde sur la base active.

## Données familiales et aperçu

La migration a d’abord été exercée sur une sauvegarde SQLite isolée de la base familiale actuelle. Elle a ensuite été appliquée à **`data/multiplyz.sqlite`**, par le migrateur de schéma seul : aucune table remplacée, aucun seed de test. **Les lignes des 22 tables existantes sont identiques avant et après migration**, comparées par empreinte de toutes les lignes triées. Seule la table vide `egg_receipts` est ajoutée, avec l’entrée du journal de migrations. `integrity_check = ok`.

Sauvegarde cohérente préalable : `data/backups/teddy-before-shop-20260910T173610Z.sqlite`, SHA-256 `9d4fea9ef6aa00bb52264aef01011c7d8f268f8512f4bcab7cf33d02f854e9db`. C’est un secours ; la base active conserve son chemin et ses données. [Rapport de préservation](teddy-shop/data-preservation.json).

Aperçu familial : **http://127.0.0.1:3217**, serveur dev lancé directement avec `DATABASE_PATH=data/multiplyz.sqlite`. Choisir le profil habituel, puis « La cabane aux œufs » sur la carte. Les changements restent locaux, sans commit, PR, merge ni déploiement.

## Suite produit

Achat ciblé avec les éclats, puis évolution cosmétique et arts de stades. L’accueil, le diagnostic et l’espace parent conservent leur présentation existante. La boutique n’ajoute pas de fonctionnement autonome hors ligne. La fluidité sur le matériel familial et le ressenti de cette nouvelle rencontre restent à observer lors de l’essai.
