---
name: discovered-issue
description: Enregistre une tâche découverte pendant une story multiplyz sans dériver — crée une issue 'discovered' liée + triage initial (bloquant vs backlog). Utiliser dès qu'un agent trouve du travail hors du scope courant.
---

# discovered-issue

Anti-drift (cf. WORKFLOW §12). **Ne jamais absorber** le travail découvert dans la story courante.

## Étapes
1. Décrire la découverte : contexte, scope présumé, lien à la story d'origine.
2. Créer l'issue :
   ```bash
   gh issue create --title "[discovered] <titre>" --label "discovered,needs-triage" --body "..."
   ```
3. **Triage** :
   - **Bloquant** (story infinissable sans) → marquer `blocked`, escalader : split de la story ou nouvelle story bloquante.
   - **Non-bloquant** → backlog ; continuer la story.
4. Référencer l'issue dans la PR (section Découvertes).

Le triage/priorisation final revient au **PO / propriétaire**.
