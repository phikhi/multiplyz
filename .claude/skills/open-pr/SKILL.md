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
- Remplir le **template DoD**, `Closes #<id>`, **intégrer les captures** (voir ci-dessous), résumer.
- Lister les **reviews** à déclencher selon le scope + **product-owner** (orchestrées hors GitHub).
- Créer les issues `discovered` éventuelles (skill `discovered-issue`).
- Si décision touchant le contrat → **ADR** (skill `adr`).

### Captures dans le body (⚠️ règle BLOQUANTE — impact UI)
Toute PR à impact UI **doit** embarquer les captures en **image rendue**, pas en simple lien.

- ❌ **INTERDIT** (ne s'affiche jamais — régression PR #85) : chemin nu ou relatif, même en backtick.
  ```md
  Captures Playwright : `docs/captures/64-question-qcm.png`, `64-feedback-erreur.png`
  ![sélecteur](docs/captures/x.png)   ← relatif : GitHub ne le résout pas
  ```
- ✅ **OBLIGATOIRE** : `![légende](…)` avec **URL absolue `?raw=true`** vers le fichier commité, sur la **branche de la story** (pas encore sur `main` à l'ouverture) :
  ```md
  ![question QCM](https://github.com/phikhi/multiplyz/blob/story/<id>-<slug>/docs/captures/<file>.png?raw=true)
  ```
- **Auto-vérif AVANT de considérer la PR ouverte** (chaque capture doit apparaître sous forme `![…](…raw=true)`) :
  ```bash
  gh pr view <n> --json body -q '.body' | grep -c 'docs/captures/.*raw=true'   # doit == nb de captures
  gh pr view <n> --json body -q '.body' | grep -nE '`docs/captures|]\(docs/captures' && echo "❌ chemin nu/relatif détecté — corriger"
  ```
  Échec de l'auto-vérif = PR **non conforme au DoD** : corriger le body (`gh pr edit <n> --body …`) avant de demander les reviews.
- Les PNG restent commités dans `docs/captures/` (choix repo : simple + permanent, cf. décision propriétaire).
- L'URL de branche s'affiche **pendant la review** (fenêtre qui compte). Après merge + suppression de branche elle casse, mais les captures restent consultables dans `docs/captures/` sur `main`.
- **Permanence (optionnel)** : au merge, l'orchestrateur peut réécrire le body `blob/story/<…>/` → `blob/main/` (`gh pr edit <n> --body …`) pour un rendu durable dans l'historique.

## Interdits
Ne pas merger. Ne pas force-push `main`. Rester dans le scope de la story.
