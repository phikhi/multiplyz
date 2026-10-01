# TEDDy — première tranche intégrée

10 septembre 2026 · Branche locale `feat/teddy-first-slice`, issue de `b820ae4` · Worktree `TEDDy/app/`.

Le parcours **profil réel → carte → calculs adaptés dans la forêt 3D → résultat et gains enregistrés → retour au chemin** fonctionne, avec reprise après fermeture. La scène conserve la direction validée du prototype « Le passage des lucioles » : forêt enveloppante, caméra derrière Teddy, progression lumineuse et rencontre avec Lumo.

**Validation utilisateur après essai, le 10 septembre 2026 : « ok j'ai testé, c'est très bien comme ça pour cette partie. »** La tranche intégrée est approuvée. L’utilisateur a ensuite demandé une sauvegarde du contexte avant clear. L’utilisateur a depuis confirmé un playtest avec l’enfant : « la partie est deja faite avec elle. elle adore », et demandé de continuer sur la suite. Les gates techniques encore ouverts restent distincts de cette validation.

Les changements sont locaux, sans commit, PR, merge ni déploiement. Le parcours est disponible pour essai ; le gate de couverture global du dépôt reste à compléter avant PR.

## Essayer

Serveur local lancé lors de la livraison : **http://127.0.0.1:3217**. Choisir le profil habituel et utiliser son code enfant. Pour relancer, depuis `TEDDy/app/`, avec Node 22 :

```sh
pnpm dev --hostname 127.0.0.1 --port 3217
```

Le script `dev` migre la base et prépare les assets locaux. La commande directe utilisée pour cet aperçu, après ces préparatifs, est :

```sh
node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

`app/data/multiplyz.sqlite` est une **copie indépendante** de la base familiale, réalisée par SQLite backup puis migrée. Un profil et 272 tentatives ont été repris. La comparaison de toutes les lignes des tables profils, tentatives, maîtrise, progression, portefeuille, collection et journal confirme leur conservation après migration. Les essais de cette version sauvegardent dans cette copie et ne se synchronisent pas avec la base d'origine. Le dépôt et la base désignés par `multiplyz/` sont conservés.

Ces décomptes et cette comparaison décrivent la copie initiale. **L’essai utilisateur a depuis pu faire évoluer la base : conserver ses données actuelles, ne pas remplacer cette copie par une nouvelle copie de l’origine à la reprise.**

Les vérifications automatiques utilisent exclusivement **`data/teddy-check.sqlite`**, distincte de la copie familiale.

## Intégration et contrats

- L'accueil conserve la sélection de vrais profils et l'authentification existante. La carte présente les nœuds réels, le niveau accessible et la reprise du passage ou du reçu final.
- Le moteur serveur existant choisit les faits, le format QCM/saisie et les distracteurs d'après la maîtrise du profil. La première tentative compte ; l'aide et le nouvel essai ne la transforment pas en réussite. Le plafond de nouveaux faits reste actif : dix questions sont une cible, certains profils reçoivent un niveau plus court. Un moteur sans question disponible affiche l'état vide existant.
- Les quatre aides représentent compléments à 10, addition, soustraction et multiplication. Exploration facultative, révélation explicite, puis nouvel essai. Le chemin avance aussi après une réponse accompagnée ; aucune étoile n'est nécessaire pour débloquer la suite.
- `adventure_sessions` sauvegarde la liste de questions, la cible monde/niveau, l'état pédagogique, la phase et le reçu. Session + révision identifient chaque commande. Tentative/maîtrise/checkpoint et progression/gains/reçu sont atomiques. L'ancien endpoint acceptant des étoiles ne peut plus créditer un niveau : il ne restitue qu'un reçu déjà enregistré.
- Une intention en attente est conservée dans le navigateur avant l'envoi et renvoyée avant toute nouvelle session à la réouverture. Le résultat attend la confirmation serveur. Une saisie interrompue est restaurée, le temps actif exclut pause et page masquée. Les états confirmés sont disponibles depuis un autre appareil ; une intention jamais reçue reste propre au navigateur qui la conserve.
- Le diagnostic initial et le recalibrage utilisent encore l'écran pédagogique existant, puis rejoignent la forêt. Un nouveau niveau respecte le verrou parental ; une aventure déjà commencée reste reprenable.
- La scène approuvée et Three.js r169 sont servis localement, ainsi que les polices. La scène reçoit des états de présentation et n'écrit jamais la progression. Pause, clavier, son et mouvement réduit sont intégrés.

Contrat canonique : [SYNC.md](../../SYNC.md), [ADR 0019](../adr/0019-session-aventure-persistante.md). Provenance artistique et licence : [public/forest/README.md](../../public/forest/README.md).

## Parcours navigateur observé

Le script [check-teddy.mjs](../../scripts/check-teddy.mjs) pilote Chromium contre l'application Next et SQLite réelles. Le profil de test Nova est préparé avant le parcours avec une maîtrise permettant de servir dix questions et les deux formats. Aucun score ou gain n'est injecté pendant la partie. Les captures emploient la forêt approuvée et les vrais composants de production.

1. Connexion par code, carte de onze nœuds sans chevauchement, entrée dans la forêt.
2. Première question accompagnée. La réponse HTTP est volontairement perdue **après l'écriture serveur**. L'écran reste en attente, puis le contexte navigateur est fermé et recréé avec ses cookies et son stockage. L'aide reprend ; une seule tentative existe.
3. Manipulation de l'aide, révélation, rechargement, nouvel essai. La première tentative reste non réussie et la maîtrise n'est pas recomptée.
4. Questions QCM au clavier et saisie libre. Le brouillon « 12 » résiste à la pause et au rechargement. Une autre réponse est envoyée hors connexion puis confirmée au retour du réseau.
5. Dernière confirmation HTTP perdue après écriture. Aucun résultat anticipé à l'écran ; rechargement puis rencontre et reçu persisté : **9 premières réussites sur 10, 2 étoiles, 20 pièces gagnées, 20 en portefeuille, 10 tentatives et une seule ligne de gain**.
6. Retour au chemin avec solde actualisé, puis entrée dans le niveau suivant. Animation active, déplacement gelé en pause, images arrêtées par le mode réduit manuel.
7. Carte sans débordement à 1024, 390 et 320 px ; commandes de calcul dans l'écran à 1280, 1024, 390 et 320 px. Aucune erreur JavaScript capturée.

[Rapport machine](teddy-integration/verification.json). Captures ouvertes et inspectées :

| État | Capture | Observation |
|---|---|---|
| Carte | [Carte réelle](teddy-integration/01-map.png) | Chemin visible, nœuds distincts, action principale accessible sur ordinateur. |
| Calcul | [Question sur ordinateur](teddy-integration/question-1280.png) | Forêt et caméra conservées, panneau opaque lisible. |
| Aide | [Avant révélation](teddy-integration/04-help.png) | Représentation manipulable, synthèse numérique encore absente. |
| Rencontre | [Lumo et Teddy](teddy-integration/07-encounter.png) | Chemin éclairé et conclusion dans la scène approuvée. |
| Résultat | [Gains confirmés](teddy-integration/08-results.png) | Étoiles, gain et solde distincts, confirmation de sauvegarde. |
| Adaptation | [Question à 320 px](teddy-integration/question-320.png) | Pavé en quatre colonnes, cibles agrandies, aucun débordement horizontal. |

## Vérifications techniques

- **2 561 tests Vitest passent**, aucun échec de test.
- ESLint, Prettier, TypeScript et compilation de production `next build --webpack` passent.
- `drizzle-kit generate` ne produit aucun changement après la migration : schéma, SQL et snapshot concordent.
- Les nouveaux modules serveur `adventure.ts` et `adventure-actions.ts` atteignent **100 % lignes/fonctions/branches**. Les tests utilisent SQLite réel pour la reprise, le score serveur, les commandes périmées, les onglets concurrents, le niveau entièrement accompagné, les refus de sauvegarde incompatibles et le gardien configuré à quinze questions avec légendaire garantie.
- Des triggers provoquent une panne **au moment de sauvegarder le checkpoint/reçu** : les tests vérifient le rollback des tentatives et de la maîtrise, ou du portefeuille, du journal et de la progression. La migration est aussi exercée sur la copie familiale peuplée.
- Les aides ont des tests de représentation et de contraste résolu depuis les tokens, ainsi que les inspections visuelles ci-dessus.
- **Le gate `pnpm test:coverage` reste rouge** : 95,27 % des lignes/statements, 99,26 % des fonctions et 99,64 % des branches, face au seuil global de 100 %. Les nouveaux écrans et le hook réseau sont exercés par le parcours Chromium, mais celui-ci n'alimente pas le compteur Vitest. Aucun seuil ni périmètre de couverture n'a été abaissé. Il reste à compléter ces tests avant une PR conforme aux gates du dépôt. Le canari E2E historique complet et les reviews de PR n'ont pas été exécutés pour cette livraison locale.

Les logs complets de cette exécution sont dans `test-results/` (ignoré par Git). Le rapport et les captures utiles ci-dessus restent dans ce dossier de livraison.

## Reproduire le parcours automatisé

Arrêter tout serveur utilisant ce worktree, puis, dans `app/` avec Node 22 :

```sh
DATABASE_PATH=data/teddy-check.sqlite node --import tsx scripts/seed-teddy-check.ts
DATABASE_PATH=data/teddy-check.sqlite node --import tsx scripts/seed-dev-world-assets.ts
DATABASE_PATH=data/teddy-check.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

Dans un autre terminal, toujours dans `app/` :

```sh
node scripts/check-teddy.mjs
```

Le script de préparation refuse toute autre valeur de `DATABASE_PATH`. Il initialise/réinitialise Nova uniquement dans cette base dédiée. Relancer ensuite le serveur avec la base familiale par défaut pour l'essai utilisateur.

## Limites et suite

La tranche est intégrée, la refonte complète reste à poursuivre. Collection, boutique, espace parent et diagnostic gardent leur présentation existante. Le passage utilise encore les modèles procéduraux validés ; les autres mondes reprennent cette même scène pour l'instant. Le gardien reçoit les règles et la récompense existantes, sans scène spécifique supplémentaire.

Le parcours navigateur prouve les comportements décrits, pas la compréhension de l'enfant ni une performance mesurée sur son ordinateur. La prochaine observation produit porte sur l'aide, la fatigue, la lisibilité et la fluidité en mouvement. Le jeu requiert le réseau ; il ne propose pas de partie autonome hors ligne.

Avant PR : compléter la couverture des nouveaux clients et des branchements de diagnostic, exécuter le canari complet et la revue. La direction artistique et le niveau pilote sont déjà validés : ne pas relancer une sélection artistique.
