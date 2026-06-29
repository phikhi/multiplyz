# 1. Utiliser des ADR pour les décisions d'architecture

- **Statut** : accepté
- **Type** : arch
- **Portée** : majeure
- **Liens** : [WORKFLOW.md](../../WORKFLOW.md) §18

## Contexte
Le projet est développé par des agents autonomes, avec des specs qui font office de **contrat**. Les décisions d'archi prises en commentaires de PR se perdent et ne sont pas traçables.

## Décision
Toute décision touchant le **contrat** (specs PLAN/ENGINE/STACK/AUTH/SYNC/MAP/ECONOMY/ART), le modèle de données, une dépendance, ou transverse → un **ADR** dans `docs/adr/NNNN-titre.md`. La **review signale**, l'**ADR décide** (hors PR). Mineur → `architect-review` autonome ; **majeur → sign-off humain**. Un ADR accepté **met à jour la spec** concernée (canonique) ; l'ADR garde le pourquoi.

## Alternatives
- Décider en commentaires de PR → rejeté (non traçable, enterré).
- Tout dans les specs sans ADR → rejeté (perte de l'historique du « pourquoi »).

## Conséquences
- + Décisions traçables, réversibles (`superseded`), auditables.
- + Specs restent canoniques.
- − Léger overhead d'écriture (acceptable, gaté au seuil « contrat »).
