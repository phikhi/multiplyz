---
name: retro
description: Rétro de fin de story/epic multiplyz — extrait les leçons (ce qui a cassé, boucles de review répétées, pièges stack) vers LEARNINGS.md et propose des promotions en règles dures. Utiliser après merge d'une story ou d'un epic.
---

# retro

Boucle d'auto-apprentissage (cf. WORKFLOW §13).

## Étapes
1. Revoir la story/epic : commentaires de review répétés, échecs CI, allers-retours, surprises.
2. **Écrire les leçons** dans `LEARNINGS.md` (format daté + scope + PR) :
   - Problème · Leçon · Action.
3. **Proposer une promotion** pour les leçons **récurrentes** :
   - règle dans `CLAUDE.md`, ou règle **lint/typecheck**, ou **hook** `settings.json`.
   - Une promotion qui change le contrat → passe par un **ADR**.
   - **Une promotion qui exige l'aval du propriétaire ne reste JAMAIS un simple paragraphe dans le body d'une PR** (invisible une fois mergée → jamais appliquée, cf. PR #77). L'ouvrir en **issue `needs-owner`** dédiée (titre = la règle proposée, corps = problème/leçon/action + PR source). Elle est ainsi listée au sync `orchestrate §1` et **consommée** dès arbitrage : approuvée → PR de suivi qui applique + ferme l'issue ; refusée → fermer avec note.
4. Garder concis (signal, pas de bruit).

## Sortie
Entrées ajoutées à `LEARNINGS.md` + promotions **auto-appliquées** (in-contract) ou ouvertes en **issue `needs-owner`** (aval requis) — jamais laissées en texte passif.
