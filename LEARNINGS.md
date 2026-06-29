# LEARNINGS — multiplyz

> Leçons accumulées (auto-apprentissage). **Lu par les agents AVANT chaque story.**
> Les leçons **récurrentes** sont **promues en règles dures** (CLAUDE.md / lint / hook). Cf. [WORKFLOW.md](./WORKFLOW.md) §13.

## Format d'une entrée
```
### AAAA-MM-JJ — [scope] Titre court (PR #id)
- Problème : ce qui a cassé / la boucle de review répétée / le piège.
- Leçon : la règle à retenir.
- Action : promue en (CLAUDE.md / lint / hook) — ou simple rappel.
```

---

### 2026-06-29 — [scaffold/stack] Node 22 obligatoire, pas 21 (PR #16)
- Problème : machine en Node 21.7.3 alors que `.nvmrc`/CI = 22 ; vite 7 (ESM-only) casse `vitest` sous < 22.12 (`ERR_REQUIRE_ESM`). Build/tests faits via `nvm use 22`.
- Leçon : tout outillage (vite 7/vitest) exige **Node ≥ 22.12** ; divergence local↔CI silencieuse sinon.
- Action : `engines.node ">=22.12"` posé. **Promotion CLAUDE.md** (Build/run : Node 22 via `nvm use`, jamais 21).

### 2026-06-29 — [scaffold/pnpm] packageManager requis + workspace.yaml à virer (PR #16)
- Problème : (a) CI rouge `No pnpm version is specified` → `pnpm/action-setup@v4` exige `packageManager` dans `package.json`. (b) `create-next-app` génère un `pnpm-workspace.yaml` config-only que pnpm 10.0.0 rejette (`packages field missing`).
- Leçon : pour une app seule (pas monorepo), pinner `packageManager: "pnpm@x"` ET supprimer le `pnpm-workspace.yaml` généré.
- Action : appliqué. Rappel (pas de promotion — spécifique au scaffold, non récurrent).

### 2026-06-29 — [scaffold] create-next-app en dossier non-vide (PR #16)
- Problème : worktree plein de specs `.md` → `create-next-app` refuse le dossier ; son `pnpm install` échoue aussi sur le workspace.yaml.
- Leçon : scaffolder dans un **dossier temp** puis merger les fichiers dans le worktree (en préservant specs/.github/.gitignore).
- Action : rappel (référence procédurale).

### 2026-06-29 — [qa/ci] Le gate coverage doit être ARMÉ, pas posé (PR #16)
- Problème : `vitest --coverage` sans `thresholds` → `test:coverage` passe à 0 % = **required check no-op**. Bloqué par backend + qa (blocker commun, 1 tour de review).
- Leçon : un required check de couverture sans seuils est un faux gate ; la story qui pose le tooling de test doit **armer les seuils** (WORKFLOW §5/§7/§10).
- Action : `coverage.thresholds` 100 % + `all: true` posés. **Promotion CLAUDE.md** (tout setup de test = seuils coverage vérifiés en CI, sinon gate creux).

### 2026-06-29 — [process] Branch protection = partie du DoR de tranche 0 (PR #16, issue #17)
- Problème : `main` sans branch protection (tranche 0 incomplet) ; le « gate humain » n'était qu'une convention. Découvert en review.
- Leçon : les gates « en dur » (WORKFLOW §7) doivent être **vérifiés actifs**, pas supposés. Self-approval impossible en solo → `required_approving_review_count: 0` (le merge manuel du proprio = le gate).
- Action : protection activée (checks `quality`+`e2e` strict, PR obligatoire, no push direct/force). **Promotion** : ajouter « vérifier `gh api .../branches/main/protection` » à la checklist de toute nouvelle branche protégée.

### 2026-06-29 — [scaffold/tooling] Next 16 réécrit tsconfig.json (PR #16)
- Problème : `next build` reformate `tsconfig.json` → `prettier --check` casse dessus.
- Leçon : les fichiers réécrits par un outil (tsconfig par Next) doivent sortir du périmètre Prettier.
- Action : `tsconfig.json` ajouté à `.prettierignore`. Rappel.
