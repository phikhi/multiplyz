---
name: story-start
description: Démarre une story multiplyz proprement — crée la branche + worktree isolé, charge les specs du scope + LEARNINGS, vérifie le DoR. Utiliser au début de chaque story avant de coder.
---

# story-start

Prépare le terrain pour coder une story (cf. WORKFLOW §4, §11).

## Étapes
1. **DoR** : vérifier que l'issue a des critères d'acceptation testables, un scope, des deps résolues. Sinon → stop, signaler.
2. **Lire le contexte obligatoire** : `CLAUDE.md`, `LEARNINGS.md`, + les specs du **scope** de la story (ex. backend → PLAN/ENGINE/ECONOMY/AUTH/SYNC ; frontend → DESIGN_TOKENS/tokens.css/WIREFRAMES/COPY).
3. **Branche + worktree isolé** :
   ```bash
   git worktree add ../mz-story-<id> -b story/<id>-<slug> main
   ```
4. Noter le **périmètre de fichiers attendu** (anti-drift) dans la description de travail.
5. Coder en respectant : tokens (zéro valeur en dur), strings centralisées, no-fail, serveur source de vérité, runtime Node.

## Sortie
Branche + worktree prêts, specs chargées, périmètre défini.
