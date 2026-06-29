---
name: open-pr
description: Termine une story multiplyz — exécute les gates pre-PR (lint, types, tests+coverage, build, next-dev-loop, captures Playwright) PUIS ouvre une PR documentée et liste les reviews à demander. Utiliser quand le code de la story est prêt.
---

# open-pr

Clôt une story par une PR conforme au DoD (cf. WORKFLOW §4, §5, §19).

## Gates pre-PR (tout doit passer)
```bash
pnpm lint
pnpm typecheck
pnpm test:coverage   # 100% logique critique / pragmatique UI
pnpm build
```
- **Vérif runtime** : lancer la skill **`next-dev-loop`** (comportement réel sur `next dev`).
- **Captures Playwright** : générer les captures des écrans/parcours touchés (obligatoire si impact UI).

## Ouvrir la PR
```bash
gh pr create --fill --base main --head story/<id>-<slug>
```
- Remplir le **template DoD**, `Closes #<id>`, joindre les **captures**, résumer.
- Lister les **reviews** à déclencher selon le scope + **product-owner** (orchestrées hors GitHub).
- Créer les issues `discovered` éventuelles (skill `discovered-issue`).
- Si décision touchant le contrat → **ADR** (skill `adr`).

## Interdits
Ne pas merger. Ne pas force-push `main`. Rester dans le scope de la story.
