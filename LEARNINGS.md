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

---

## Rétro epic #1 (salve parallèle #11/#12/#14/#13)

### 2026-06-29 — [qa/ci] Gate coverage VIDÉ — récidive (PR #20)
- Problème : exclure TOUS les fichiers source (`page.tsx`+`ThemeToggle`+`layout`) → « All files 0% » mais `test:coverage` exit 0 → seuil 100% satisfait À VIDE. **Récurrence** de la leçon PR #16 (pire : scope annulé).
- Leçon : un `exclude` qui vide le scope rend le gate 100% creux. Tester la logique (composant à état/branches) plutôt que l'exclure ; jamais 0 fichier mesuré.
- Action : **PROMU règle dure CLAUDE.md** (récurrent ×2). Exclude réservé au boilerplate framework non testable (`layout.tsx`).

### 2026-06-29 — [process/orchestration] Stories parallèles → interactions cross-PR (PR #19/#20/#21)
- Problème : 3 stories en // (worktrees isolés) → contrats partagés non vus avant merge : (a) **ownership config DB** #12↔#14 (double source `busy_timeout`) → ADR 0002 ; (b) règle lint `react/jsx-no-literals` de #14 cassait les littéraux JSX de la démo #11 au rebase ; (c) surfaces partagées `page.tsx`/`layout.tsx`.
- Leçon : en fan-out, repérer d'avance les **surfaces partagées** + tout changement transverse (lint/config/dep) d'une story = contrat → l'annoncer aux stories sœurs et séquencer les merges.
- Action : rappel process (+ ADR 0002 pour la config). À intégrer au découpage `brief-to-tasks`.

### 2026-06-29 — [git] Branch protection strict → chaîne de rebase séquentielle (epic #1)
- Problème : protection `strict` → chaque merge met les PR suivantes BEHIND ; PR empilées = rebases répétés + convergence (#12 sur `@/config/server-config`) au 2e merge.
- Leçon : sous `strict`, l'orchestrateur rebase au fil et applique les convergences ADR au rebase de la 2e PR mergée ; planifier l'ordre de merge (#14→#12→#11).
- Action : rappel.

### 2026-06-29 — [ci] Re-formater après rebase/résolution de conflit (PR #20)
- Problème : après résolution d'un conflit sur `layout.tsx`, le fichier mergé non reformaté → `pnpm format` rouge en CI (fast fail 16s).
- Leçon : toute résolution de conflit/rebase peut laisser un fichier non-Prettier → relancer `pnpm format` avant de pousser.
- Action : **PROMU règle dure CLAUDE.md** (DoD : `pnpm format` après rebase/merge). Candidat hook pre-PR.

### 2026-06-29 — [db] better-sqlite3 natif sous pnpm 10 (PR #19)
- Problème : pnpm 10 ignore les build scripts → natif `better-sqlite3` non compilé (runtime KO) ; bundle serveur Next tente d'embarquer le natif.
- Leçon : `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` + `serverExternalPackages: ["better-sqlite3"]` (next.config) + `tsx` pour le script de migration TS.
- Action : rappel (référence pour toute dép native).

### 2026-06-29 — [frontend/pwa] PWA offline = 2 états + contraste des couleurs de statut (PR #23)
- Problème : (a) `OfflineBanner` en `useState(true)` ne couvrait que la perte mid-session, pas le **chargement déjà hors-ligne** ; (b) fond `warning` (clair dans les 2 thèmes) + `--color-text-primary` (s'inverse en dark) = contraste ≈1.35:1 illisible.
- Leçon : online-first ≠ pas d'offline UX — cold-start (`navigator.onLine` au mount via `useSyncExternalStore`) ET mid-session (events), messages distincts (SYNC §3). Une couleur de statut exige un token texte **constant** (`--color-on-warning`), pas un token qui s'inverse par thème.
- Action : rappel a11y/PWA (token `--color-on-warning` ajouté à `tokens.css`).

### 2026-06-29 — [process] next-dev-loop indispo (Next < 16.3) (PR #23, issue #24)
- Problème : le skill `next-dev-loop` (DoD vérif runtime) exige `/_next/mcp` (Next ≥ 16.3) ; projet en 16.2.9 → item DoD jamais réellement exécuté, suppléé par E2E live.
- Leçon : un item DoD peut être bloqué par la version de la stack — le tracer, ne pas le cocher en silence.
- Action : issue `discovered` #24 (upgrade Next ≥ 16.3). Rappel.
