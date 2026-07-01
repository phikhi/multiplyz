---
name: orchestrate
description: Boucle d'orchestration autonome de multiplyz. À lancer au démarrage d'une conversation (« continue multiplyz », « avance le projet », reprise de session) : synchronise l'état, trie le backlog, découpe l'épic, choisit/parallélise les stories, puis enchaîne story-start → build → PR → reviews → merge → rétro sans solliciter le propriétaire — escalade UNIQUEMENT sur le drift. Utiliser quand le propriétaire veut avancer le projet sans intervenir.
---

# orchestrate

Playbook de la **boucle autonome** (cf. **ADR 0004** + ADR 0003, WORKFLOW §20). Le propriétaire ne doit **pas** avoir à intervenir sur le planning : triage, découpage, séquencement, parallélisation sont pris en autonomie **tant que ça reste dans le contrat**. Escalade **uniquement** sur le **drift**.

## 0. Charger le contexte (obligatoire)
`CLAUDE.md`, `LEARNINGS.md`, mémoire de statut projet, + specs du scope à venir. Ne jamais réinventer une décision verrouillée.

## 1. Synchroniser l'état
```bash
git fetch --prune && git status
gh pr list --state open           # PR en cours à finir/merger d'abord
gh issue list --state open --limit 50
gh run list --limit 5             # CI
```
- **Finir l'existant avant de commencer** : PR ouverte prête → boucle review→merge ; branche/worktree orpheline → reprendre ou nettoyer.

## 2. Trier le backlog (grille)
Classer **chaque** issue ouverte (surtout `discovered`) :

| Classe | Critère | Action |
|---|---|---|
| **bloquant-maintenant** | correctness/sécurité dont dépend une story du scope courant | intégrer dans l'épic courant, avant la story consommatrice |
| **prochain-épic** | rattachée à un épic futur précis (ex. entrée Parent → #7) | commenter/lier l'épic cible, différer |
| **backlog-hygiène** | nice-to-have / durcissement / hygiène, aucun blocage | traiter **opportunément** (quand on touche le code lié) ou en fin d'épic |
| **gate-déploiement** | requis avant un jalon de déploiement (ex. Nginx X-Real-IP #47) | taguer, différer au pré-déploiement |

Rapporter le tri (bref). Ne pas absorber une issue hors-scope dans une story (anti-drift).

## 3. Choisir l'épic + découper en stories
- **Ordre de build verrouillé** (CLAUDE.md/PLAN) : ne pas sauter. Épic courant fini → épic suivant.
- Découper l'épic en **stories GitHub** (Epic → Story) : critères d'acceptation testables + DoD, `blocked-by`, scope. S'appuyer sur la spec du scope (ex. `ENGINE.md` pour #3) et le skill `brief-to-tasks` si utile. Séquencer par **surfaces partagées**.

## 4. Choisir la/les story(ies) + parallélisation
- Prochaine story = première **débloquée** (`blocked-by` résolus) dans l'ordre.
- **Paralléliser** deux stories seulement si **surfaces disjointes** ET aucun **contrat partagé** modifié (schéma, config, règle lint, dépendance, composant partagé). Surface partagée → **séquencer** (LEARNINGS : interactions cross-PR en fan-out). Plafonner le // pour garder la charge de review saine.

## 5. Boucle d'exécution (par story)
`story-start` → build (DoD, 100 % logique critique) → `open-pr` → **reviewers indépendants** (scope + PO, en //) → appliquer les fixes de **consensus in-contract** tant que le worktree est chaud → **merge** (ADR 0003 : reviews+PO ✅ + CI verte + à jour) → `retro` → `LEARNINGS`. Router le hors-scope en issues `discovered`. **Re-trier** le backlog entre les merges. Répéter jusqu'à vider le scope de l'épic, puis **clôturer l'épic** et revenir à l'étape 3.

## 6. Escalade — SEULEMENT le drift
S'arrêter et demander le sign-off du propriétaire **uniquement** si une décision **modifierait une décision verrouillée** : modèle de données PLAN · pédagogie ENGINE · économie · sécurité · scope d'épic. **Sinon, jamais.** (ADR 0004.) Présenter le choix de drift clairement + option recommandée, attendre l'arbitrage.

## Rapport (sans attendre d'aval)
Rapporter en continu, sobrement : tri du backlog, épic/story choisis + pourquoi, parallélisation, chaque merge, rétro. Le propriétaire lit ; il n'a pas à répondre (sauf drift).

## Interdits (en dur, jamais relâchés)
Force-push `main` · secrets · toucher la branch-protection · contourner CI/reviews/PO · sortir du scope de l'épic sans escalade drift.
