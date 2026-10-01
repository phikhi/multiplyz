# ADR 0021 — Retrouver un compagnon choisi avec ses éclats

10 septembre 2026 · Accepté dans le périmètre de la tranche TEDDy éclats.

L’achat ciblé doit retrouver son résultat après une réponse perdue, même si un autre onglet a déjà acquitté la rencontre. Le journal économique ne suffit pas à restituer l’art, le prix et le résultat exacts. La migration additive `0020_teddy_shard_receipts.sql` ajoute donc `shard_receipts`, sur le principe du reçu d’œuf de l’[ADR 0020](0020-rencontre-oeuf-persistante.md), en conservant les contrats d’œufs déjà livrés.

## Acquisition et catalogue

Une transaction SQLite synchrone `immediate` vérifie la possession et le catalogue, appelle `debitWalletInTx`, crée la possession au stade 1 et enregistre le reçu. Toute erreur d’écriture annule le débit, le journal, la possession et le reçu. Le verrou d’écriture est pris avant les lectures. Les prix viennent de la configuration serveur : commune 60 / rare 150 éclats par défaut. Le journal utilise `spend/shards/shop` et `shop:<purchaseId>`.

Les candidats sont les compagnons communs et rares manquants du catalogue réel, dans les mondes accessibles selon `getUnlockedWorldCount`. Le critère `in_egg_pool` appartient aux œufs ; il ne limite pas l’achat ciblé. Les légendaires restent exclues même si ce drapeau est incorrect. Un catalogue partiel n’invente aucun candidat. Les nouveaux mondes générés suivent les mêmes règles d’accès ; aucune liste limitée aux mondes initiaux n’est introduite. Pièces, pitié, étoiles et progression ne sont pas modifiées par cet achat.

## Reçu et intentions concurrentes

- `id` : profil + identifiant d’intention ; `profile_id` référence le profil avec suppression en cascade.
- `purchase_id` : identifiant canonique de l’acquisition.
- `offer` : compagnon, nom, monde, rareté, art, histoire et prix figés au moment de l’achat.
- `balance` : soldes après cet achat, explicitement présentés comme historiques.
- `acknowledged` et `created_at` : acquittement et date serveur.

Un profil a au plus une acquisition ciblée non acquittée. Toute nouvelle intention reçue pendant cette rencontre est liée au même reçu, y compris si elle ciblait un autre compagnon ; elle ne déclenche pas une deuxième invitation. L’écran présente le compagnon effectivement acquis. Après acquittement, ces alias restent rejouables sans nouvelle dépense. Une nouvelle invitation exige une nouvelle intention. Un compagnon déjà possédé est refusé sans doublon ni compensation.

## Reprise côté navigateur

Avant l’envoi, le navigateur garde l’intention par profil : achat avec cible et identifiant, ou acquittement avec destination (fiche, boutique ou carte). Une issue réseau inconnue conserve cette intention. Le retour du réseau, le bouton Réessayer ou la réouverture renvoient la même opération. L’acquittement doit être confirmé avant navigation ; une réponse perdue conserve la destination jusqu’au rejeu. Sans intention locale, le reçu serveur retrouve la rencontre non acquittée. Les actions vérifient que le profil attendu correspond toujours à la session ; aucun prix ni portefeuille fourni par le client n’est accepté.

Ce contrat n’ajoute pas d’achat hors ligne. Si le navigateur refuse le stockage d’une intention, l’achat n’est pas envoyé. La fiche et l’album lisent toujours le catalogue et la possession actuels ; le reçu conserve l’état historique de la rencontre.

## Vérification et migration

Contrôles ciblés sur SQLite réel : montant, accès, légendaires, profil, rejeu avant/après acquittement et annulation après débit. Parcours Chromium sur une continuation isolée de l’essai boutique, avec gains par le jeu et doublons naturels. Les anciens tests et la couverture globale restent une étape distincte avant PR.

Sur la base familiale : sauvegarde SQLite cohérente, migration du **schéma seul**, contrôle d’intégrité et comparaison des lignes de toutes les tables existantes. Aucun seed ni remplacement de la base active.
