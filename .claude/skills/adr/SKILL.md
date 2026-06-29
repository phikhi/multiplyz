---
name: adr
description: Crée ou met à jour un ADR multiplyz (Architecture Decision Record) depuis le template, le relie à l'issue/PR et à la spec impactée. Utiliser pour toute décision touchant le contrat (specs/data/dépendances/transverse).
---

# adr

Décisions tracées (cf. WORKFLOW §18). **La review signale, l'ADR décide** (hors PR).

## Quand
Obligatoire si la décision modifie une **spec contrat** (PLAN/ENGINE/STACK/AUTH/SYNC/MAP/ECONOMY/ART), le **modèle de données**, une **dépendance**, ou est **transverse**.

## Étapes
1. Copier `docs/adr/TEMPLATE.md` → `docs/adr/NNNN-<slug>.md` (NNNN = prochain numéro).
2. Remplir : Contexte · Décision · Alternatives · Conséquences. Renseigner **Statut**, **Type**, **Portée**, **Liens** (issue/PR/spec).
3. **Portée** :
   - **mineure** → `architect-review` peut passer en `accepted`.
   - **majeure** → reste `proposed` jusqu'au **sign-off du propriétaire**.
4. ADR **accepté** → **mettre à jour la spec contrat** concernée + lien vers l'ADR. (`superseded` chaîne les décisions remplacées.)

## Sortie
Fichier ADR + (si accepté) patch de la spec.
