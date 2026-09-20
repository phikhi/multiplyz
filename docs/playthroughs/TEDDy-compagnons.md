# TEDDy — Rencontre légendaire et compagnons

10 septembre 2026 · `app/` · branche locale `feat/teddy-first-slice`.

L’utilisateur confirme avoir joué la première tranche avec sa fille : « elle adore », puis autorise la suite. La forêt et le niveau déjà validés restent la référence. Cette livraison relie le gardien, la rencontre légendaire, la collection par monde et la fiche avec surnom. Les œufs, la boutique et l’évolution constituent les étapes produit suivantes.

**Validation après livraison, le 10 septembre 2026 : « ok j'ai testé, c'est très bien comme ça. »** La tranche compagnons est testée et approuvée par l’utilisateur. Il demande ensuite une sauvegarde du contexte et un prompt de reprise avant clear. Cette validation produit ne clôt pas les vérifications techniques avant PR détaillées ci-dessous. La sauvegarde cohérente de la base après cet essai et le point de reprise sont référencés dans `REPRISE.md`, à la racine TEDDy.

## Parcours livré

- L’arrivée chez le gardien utilise la position issue de la configuration serveur. Le moteur conserve sa longueur et son plafond de faits ; aucune règle pédagogique n’est réécrite.
- La rencontre montre en grand l’art de la légendaire réellement possédée, avec son nom et son histoire de catalogue. Lumo laisse la place lors de cette rencontre uniquement. Le titre porte un fond opaque pour rester lisible devant le portail.
- L’attribution, les pièces et le déblocage conservent leur transaction existante, même avec zéro étoile. Le reçu lit désormais le catalogue enregistré et le surnom éventuel, au lieu de reconstruire des métadonnées par défaut.
- « Retrouver mon compagnon » acquitte le reçu par la commande fiable `close`, puis ouvre la bonne fiche. Une réponse perdue et une fermeture du navigateur conservent cette destination. Le retour à la carte permet ensuite d’entrer directement dans le nouveau monde.
- L’album groupe le catalogue des mondes accessibles. Les compagnons obtenus apparaissent en premier ; les autres restent des silhouettes non cliquables. Un catalogue incomplet ne crée aucun emplacement fictif ni pourcentage de complétion.
- La fiche conserve l’illustration, l’histoire, la rareté et les stades cosmétiques existants. Le surnom est enregistré côté serveur, protégé par la possession du profil. Un échec réseau garde la saisie et permet de réessayer ; les soumissions concurrentes sont bloquées.

## Protection de l’existant

Les modifications précédentes sont conservées, sans commit, merge ni déploiement. Aucune nouvelle migration. `data/multiplyz.sqlite`, son WAL et son SHM ont les mêmes empreintes SHA-256 qu’au début de cette tranche, avant remise en route de l’aperçu familial. Aucun seed n’y a été exécuté.

Le parcours automatique utilise exclusivement `data/teddy-companions-check.sqlite`. Son seed refuse tout autre chemin. La base familiale, la base de contrôle précédente et sa sauvegarde sont distinctes.

## Vérifications

- 2 547 tests Vitest réussis. ESLint, Prettier, TypeScript et build de production réussis.
- `collection-album.ts`, `finish-level.ts`, `CollectionScreen.tsx` et `CreatureDetailScreen.tsx` : 100 % des lignes, fonctions et branches dans cette exécution. Les modules serveur d’aventure restent à 100 %.
- Tests de l’acquittement avant visite, de la réponse perdue puis remontage, de la destination conservée, du retour normal à la carte, de l’isolation des profils, du catalogue partiel, de l’art personnalisé préexistant, du surnom au rejeu et du gardien sans étoile.
- Revues source indépendantes Standards et Produit approuvées après correction de la fermeture du reçu, du focus clavier et du titre devant le portail. Ce sont des revues locales de cette tranche, pas des reviews de PR.
- **Couverture globale encore sous le gate de 100 %** : 97,51 % lignes/statements, 97,97 % fonctions, 98,49 % branches. Aucun seuil ou périmètre abaissé. Les branches restantes de l’orchestration client, des écrans de la première tranche et du diagnostic restent à couvrir avant PR.
- Le canari historique dans `e2e/auth.spec.ts` utilise encore les anciens écrans et reste à adapter puis exécuter. Le parcours ci-dessous est un contrôle distinct de la boucle TEDDy.

## Parcours navigateur

La vérification finale sur `next build` + `next start` a réussi, sans erreur de page. Résultats consignés dans [verification.json](teddy-companions/verification.json).

- Dix niveaux de dix questions, puis les 13 questions du gardien toutes accompagnées : zéro étoile, 60 pièces, une seule acquisition légendaire et ouverture du monde suivant. Aucun progrès ni gain injecté entre les écrans.
- Réponse perdue après la dernière écriture, fermeture et reprise du reçu ; réponse perdue à l’acquittement, fermeture et arrivée sur la bonne fiche au redémarrage.
- Même identifiant `legendary:0` et même art du catalogue pendant la rencontre, dans l’album et sur la fiche. Surnom « Luciolune » enregistré après une coupure puis retrouvé après fermeture.
- Album et fiche contrôlés à 1280, 1024, 390 et 320 px ; rencontre contrôlée sur les mêmes largeurs. Aucun débordement horizontal. Captures inspectées ; le décor reste une composition prioritairement destinée à l’ordinateur.
- Parcours clavier et focus visibles : contraste de l’anneau d’or mesuré sur les pixels de capture à 8,36:1. Le titre de rencontre possède un fond opaque pour conserver son contraste devant le portail.
- Retour au chemin puis entrée directe dans le monde 2, étape 1, sans repasser par le résultat du gardien.

Captures : [album vide](teddy-companions/01-empty-album.png), [rencontre](teddy-companions/02-legendary-encounter.png), [reçu](teddy-companions/03-receipt.png), [fiche](teddy-companions/04-companion-detail.png), [monde suivant](teddy-companions/05-next-world.png), [focus clavier](teddy-companions/06-album-keyboard-focus.png), [fiche 320 px](teddy-companions/detail-320.png).

Une passe intermédiaire en mode dev avait rencontré un manifeste Next vide lors de la recompilation à chaud. La passe finale compilée est réussie ; aucun contournement produit de ce problème de serveur dev n’a été ajouté.

## Reproduction isolée

Depuis `app/`, Node 22. Arrêter l’aperçu familial avant d’utiliser le même port.

```sh
DATABASE_PATH=data/teddy-companions-check.sqlite node --import tsx scripts/seed-teddy-companions.ts
DATABASE_PATH=data/teddy-companions-check.sqlite node --import tsx scripts/seed-dev-world-assets.ts
DATABASE_PATH=data/teddy-companions-check.sqlite node node_modules/next/dist/bin/next build --webpack
DATABASE_PATH=data/teddy-companions-check.sqlite GEMINI_API_KEY=local-browser-check-unused node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217
```

Dans un autre terminal :

```sh
node scripts/check-teddy-companions.mjs
```

La valeur de clé ci-dessus est un marqueur de test local pour la validation de configuration au démarrage. Aucun worker ni appel au fournisseur d’images n’est lancé par ce parcours. Ce n’est pas une configuration de déploiement.

Pour retrouver ensuite la copie familiale, arrêter le serveur de test et lancer le serveur dev avec `DATABASE_PATH=data/multiplyz.sqlite`, sans seed.
