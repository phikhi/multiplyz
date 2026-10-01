# ADR 0020 — Retrouver la rencontre d’un œuf acheté

10 septembre 2026 · Accepté dans le périmètre de la tranche TEDDy boutique/œufs.

## Problème

L’achat existant empêche un second débit avec le même identifiant, mais renvoie seulement `REPLAY` lorsqu’il a déjà été effectué. Après une réponse HTTP perdue, l’enfant ne peut donc pas retrouver le résultat précis de son œuf. Le journal seul ne contient ni le compagnon tiré, ni la distinction nouveauté/doublon, ni les éclats attribués.

## Décision

Ajouter `egg_receipts` par migration additive 0019. L’achat appelle les mécanismes `buyEggAndDraw`, `wallet`, `egg` et `egg_pity` existants dans une transaction englobant aussi le reçu. Une panne à l’écriture du reçu annule également le débit, la possession, les éclats et la pitié.

- `id` : clé composée profil + identifiant d’intention client. Le profil vient toujours de la session.
- `profile_id` : référence au profil, suppression en cascade.
- `draw_id` : identifiant canonique de l’achat.
- `result` : résultat serveur figé (créature, art, histoire, nouveauté/doublon, éclats, pitié et solde après achat).
- `acknowledged` : rencontre acquittée ; les reçus demeurent disponibles pour le rejeu.
- `created_at` : instant serveur.

Un profil n’a qu’une rencontre non acquittée. Une autre intention d’achat arrivée pendant cette rencontre est liée au même résultat : une ligne alias avec le même `draw_id`, enregistrée dans la transaction. Même si sa réponse se perd puis que le premier onglet acquitte la rencontre, rejouer cette seconde intention ne dépense rien. L’acquittement porte sur toutes les lignes du même achat et du même profil.

Les nouvelles actions exigent aussi le profil attendu par l’écran comme garde de session ; il ne devient jamais l’autorité du débit. Un changement de joueur interdit de rejouer une intention dans le portefeuille du nouveau profil. Prix, tirage et récompenses restent exclusivement calculés côté serveur.

## Présentation et reprise

L’œuf apparaît après confirmation serveur. L’ouverture est une action de présentation, sans débit ni tirage supplémentaire. La rencontre montre le reçu ; la fiche et l’album lisent la possession et le catalogue actuels. Un solde historique est explicitement nommé « Solde après cet achat ».

Le navigateur conserve, par profil, une intention avant l’envoi (achat ou acquittement et destination). Une erreur réseau la conserve ; réessayer ou rouvrir renvoie le même identifiant. La révélation est également mémorisée quand le stockage le permet. Le reçu serveur retrouve au minimum l’œuf même sans stockage local. Aucun jeu hors ligne ni inventaire d’œufs différés n’est ajouté.

Les anciennes dépenses antérieures à cette migration restent dans le journal et la collection ; leur tirage ne peut pas être reconstruit avec certitude. Elles continuent de répondre `REPLAY` sans second débit.

## Vérification et données existantes

Tests SQLite réel : rejeu avant/après acquittement, deux onglets et réponse perdue, isolation et suppression de profils, résultat figé, refus sans débit, rollback au reçu, doublons et pitié configurée. Contrôle navigateur sur `data/teddy-shop-check.sqlite`, sans injection de gains pendant le parcours.

La migration ne modifie aucune table existante. Les essais et seeds utilisent uniquement leur base dédiée. Sur la base familiale, l’application finale de la migration doit utiliser le migrateur de schéma seul, avec sauvegarde cohérente et comparaison des lignes existantes, sans seed de test.
