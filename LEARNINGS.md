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

## Rétro story #29 — épic #2 Auth-lite (2.1 fondation, PR #34)

### 2026-07-01 — [db/coverage] Le callback table-extras de drizzle casse le gate 100 % fonctions (PR #34)
- Problème : le 3ᵉ argument de `sqliteTable(name, cols, (t) => [index/uniqueIndex/check(...)])` n'est **jamais invoqué au runtime** (seul drizzle-kit l'appelle au `generate`) → v8 le compte comme fonction **non couverte** → gate `functions: 100` rouge, `all:true`. `getTableConfig(t).indexes` **ne le couvre pas**. À l'inverse, le callback FK `.references(() => other.id)` **est** couvrable en forçant `getTableConfig(t).foreignKeys[0].reference()` dans un test.
- Leçon : sous gate 100 % fonctions, **éviter le callback extras** (index/check) dans le schéma. Faire respecter ces contraintes **au niveau requête** (ex. unicité prénom insensible à la casse via `lower(name)` en #2.2/#2.3) ou, si l'index DB est vraiment requis, assumer un seuil par-fichier documenté. Un index secondaire sur une table minuscule single-tenant = premature → l'omettre.
- Action : rappel (pattern à réappliquer dès #30 qui touche le schéma). Test FK couvert via `getTableConfig(...).foreignKeys[].reference()`.

### 2026-07-01 — [auth/deps] argon2id : `@node-rs/argon2` + piège `isolatedModules` (PR #34)
- Problème : `argon2` (npm ranisalt) = node-gyp → friction native pnpm 10 (cf. leçon #19). `@node-rs/argon2` = binaires **prebuilt** (napi) → pas de compilation. MAIS importer son enum `Algorithm.Argon2id` casse le build : `TS2748 Cannot access ambient const enums when 'isolatedModules' is enabled`.
- Leçon : préférer `@node-rs/argon2` (prebuilt) + l'ajouter à `serverExternalPackages`. Ne **pas** importer son `const enum` ; s'appuyer sur sa **variante par défaut (argon2id)** et **asserter le préfixe `$argon2id$`** en test.
- Action : rappel (référence pour toute dép exposant un `const enum` sous isolatedModules).

### 2026-07-01 — [config/next] `server-only` incompatible avec les modules partagés hors-Next (PR #34)
- Problème : review sécurité a suggéré `import "server-only"` sur `server-config.ts` (défense en profondeur). Mais ce module est **volontairement** consommé hors runtime Next (script `tsx db:migrate`, drizzle-kit, vitest) où `server-only` **throw** (paquet même pas installé + pas de condition `react-server`) → casserait migration + tests.
- Leçon : `server-only` ne peut coiffer que des modules importés **uniquement** dans le runtime Next. Un module de config partagé avec l'outillage hors-Next ne peut pas le porter. La protection Next (env non `NEXT_PUBLIC_*` jamais bundlé client) reste le garde-fou effectif.
- Action : rappel (finding review décliné avec raison).

### 2026-07-01 — [coverage] Aléa non biaisé = couverture déterministe (PR #34)
- Problème : générer un code via rejection-sampling (`if (byte < limit)` sur `randomBytes`) introduit une **branche probabiliste** — la branche « octet rejeté » peut ne pas s'exécuter dans un run → gate `branches: 100` **flaky**.
- Leçon : utiliser `crypto.randomInt(n)` (CSPRNG **non biaisé**, sans branche) plutôt qu'un modulo/rejet manuel → pas de branche à couvrir, déterministe, et pas de biais de modulo (bonus sécu).
- Action : rappel.

### 2026-07-01 — [process] Boucle de review propre en salve parallèle (PR #34)
- Observation : 4 reviewers **indépendants** (backend/security/qa/PO) lancés en // → 4× APPROVE au 1er tour, uniquement mineurs/nits. Findings forward-looking reportés en **notes sur les stories consommatrices** (#30/#31/#32) plutôt qu'absorbés dans la story. Story **in-contract** (aucune décision verrouillée touchée) → merge autonome de l'orchestrateur.
- Leçon : router les findings hors-scope vers les issues cibles (anti-drift), garder la story fondation étroite. Confirme la discipline « reviewers indépendants + escalade si drift ».
- Action : rappel process.

---

## Rétro story #30 — épic #2 Auth-lite (2.2 onboarding, PR #36)

### 2026-07-01 — [db/concurrence] TOCTOU : check-then-write avec un `await` entre = transaction synchrone (PR #36, MAJOR backend)
- Problème : `createHousehold` faisait `if (householdExists) …` PUIS `await Promise.all([hash argon2])` PUIS `insert`. Le hash async **rend la main à l'event loop** → deux soumissions concurrentes de la server action (endpoint POST public ; le `disabled={submitting}` client n'est PAS une garantie serveur) passent toutes deux la garde → **2 propriétaires** (viole l'invariant « owner unique ») ou violation `UNIQUE(name)` re-levée en 500. Le code se réclamait « idempotent » sans l'être sous concurrence.
- Leçon : sous un invariant d'unicité/idempotence, tout **check-then-write avec une opération async intercalée** doit re-vérifier + écrire dans une **transaction SYNCHRONE better-sqlite3** (`db.transaction((tx) => {…})`, callback sans `await`) — hacher AVANT. Le callback sync s'exécute d'un bloc (BEGIN…COMMIT) sans reprise d'event loop → sérialisation. Bonus couverture : garder la vérif **uniquement** dans la transaction (pas de court-circuit externe redondant) → les 3 branches (return false / throw / insert) sont couvrables déterministe.
- Action : **candidat promotion CLAUDE.md** (règle serveur « écritures idempotentes » → préciser « check-then-write avec await = transaction sync »). À réappliquer dès #2.3 (création session/login) et toute écriture monotone.

### 2026-07-01 — [coverage] L'optional-chaining `?.` compte comme une branche v8 (PR #36)
- Problème : gérer le focus a11y via `useEffect(() => headingRef.current?.focus(), [step])` laisse la branche « current === null » **non couverte** (le titre est toujours monté) → gate `branches: 100` rouge.
- Leçon : préférer un **ref-callback** (`ref={useCallback((node) => node?.focus(), [])}`) : au changement d'étape l'ancien titre démonte (`node=null`) et le nouveau monte (`node=élément`) → **les 2 branches du `?.` sont exercées** naturellement, et le focus suit l'étape. Éviter `?.` / paramètres par défaut / ternaires dont un côté est inatteignable sous gate 100 %.
- Action : rappel (réapplique la discipline « pas de branche morte » déjà notée #34).

### 2026-07-01 — [a11y] Assistant multi-étapes : focus au montage + région live pour secret à usage unique (PR #36, MAJOR frontend)
- Problème : au changement d'étape, le focus retombait sur `<body>` (nouveau `<h1>` jamais annoncé) ; le **code de secours à usage unique** était un simple `<p>` (ni focusable ni annoncé) → un utilisateur clavier/lecteur d'écran pouvait le **rater**.
- Leçon : dans un wizard, déplacer le focus sur le titre de chaque étape (`<h1 tabIndex={-1}>` + ref-callback focus au montage) ; annoncer tout contenu critique éphémère via `role="status"`. Pattern réutilisé par la connexion #2.3 (PinPad).
- Action : rappel a11y (à réappliquer #2.3).

### 2026-07-01 — [e2e] Gating dépendant d'un état DB → base E2E dédiée wipée à froid + spec mutante `retries:0` (PR #36)
- Problème : la racine `/` affiche l'onboarding **seulement si aucun foyer** ; les E2E doivent partir d'un état vide déterministe, et le test qui **crée** le foyer mute le single-tenant partagé. Un retry CI (`retries:1`) sur ce test rejouerait sur un foyer déjà créé → `alreadyConfigured` → jamais l'écran attendu.
- Leçon : base SQLite **dédiée E2E** (`data/e2e.sqlite`, jamais la dev), wipée en `globalSetup` + **migrée au boot** (`db:migrate && dev`) ; `describe.serial` + `test.describe.configure({ retries: 0 })` pour le spec mutant (un retry ne récupère pas une écriture one-time) ; donner un `<h1>` au placeholder « foyer configuré » pour que les specs cold-start `/` restent vertes dans les 2 états.
- Action : rappel (référence pour toute story dont un écran dépend d'un état serveur).

### 2026-07-01 — [security/copy] Garde de forme sur server action publique + registre parent neutre (PR #36)
- Problème : (a) `"use server"` = endpoint public ; `input` typé n'est pas garanti au runtime → `sanitizeName(input.name)` sur un `name` non-string = `TypeError` 500 au lieu d'une erreur de validation (AUTH §4). (b) Le tutoiement de Teddy avait fuité dans l'étape **parent** (`parentPin.method`, `errors.PARENT_PIN_SAME`), alors que COPY §5 impose un registre **neutre** côté parent.
- Leçon : (a) garder la **forme** (types des champs) en tête de toute server action avant sanitisation → erreur de validation propre. (b) surveiller le **registre par audience** (Teddy/tutoiement enfant vs neutre parent) — un même écran onboarding mélange les deux.
- Action : rappel (réapplique à #2.3+ et à tout copy parent/enfant).

### 2026-07-01 — [dx] 3 footguns de dev local révélés dès que `/` lit la DB (PR #40, #41)
- Problème : dès que la racine `/` lit une table à la requête (gating #30), le dev local casse là où les stories précédentes (page statique) ne touchaient pas la DB : (a) `pnpm dev` ne migrait pas → `SqliteError: no such table: profiles` (base dev fraîche) ; (b) le **service worker** cachait `/_next/static/*` en **cache-first** (« assets immuables ») → **faux en dev** : les chunks Turbopack réutilisent leurs URLs après édition → un chunk **périmé** servi → `strings.onboarding undefined` / TypeError ; (c) `prettier --check <un-seul-fichier>` a donné un **faux vert** alors que `prettier --check .` (la commande CI) échouait sur le même fichier → `quality` rouge au push.
- Leçon : (a) `pnpm dev` = `pnpm db:migrate && next dev` (idempotent ; prod migre via Forge, pas au boot) ; (b) SW `/_next/static` en **réseau-d'abord** (frais en ligne dev+prod, cache en repli hors-ligne), bumper `CACHE_NAME` pour purger l'ancien cache ; cache-first n'est correct QUE sur des noms hashés (prod) ; (c) toujours lancer **`pnpm format`** (commande CI exacte) avant push, pas un check par-fichier.
- Action : (a)+(b) appliqués. (c) rappel — candidat **hook pre-PR** `pnpm format` (déjà pressenti epic #1).

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

---

## Rétro story #31 — épic #2 Auth-lite (2.3 connexion, PR #42)

### 2026-07-01 — [coverage/next] Un layout de groupe imbriqué EST mesuré par le gate (PR #42)
- Problème : le gate coverage exclut le littéral **exact** `src/app/layout.tsx` (boilerplate racine). Un layout de **route-group** (`src/app/(app)/layout.tsx`, garde de route) n'est PAS couvert par cet exclude → il est **mesuré** et doit atteindre 100 %.
- Leçon : garder la glue du garde **mince** (lire session → `redirect()` sinon rendre `children`), la logique de validité dans un module pur testé, puis **unit-tester le layout** en mockant `@/lib/auth/current-session` + `next/navigation` (appeler `await AppLayout({children})`, asserter `redirect` appelé vs enfants rendus). **Ne pas** ajouter d'exclude (règle dure : exclude = boilerplate framework non testable uniquement).
- Action : rappel (réapplicable à tout garde de route serveur en groupe).

### 2026-07-01 — [e2e] Deux specs à état single-tenant OPPOSÉ ne partagent pas une base wipée-à-froid en parallèle (PR #42)
- Problème : `onboarding.spec` exige un foyer **vide** (gating 1er usage), la connexion exige un foyer **peuplé**. Une seule base E2E wipée une fois + `fullyParallel:true` → course inter-fichiers (l'ordre inter-fichiers n'est **pas** garanti ; `workers:1` ordonne par nom, fragile et lent).
- Leçon : quand deux stories forment une **même séquence** sur l'état single-tenant (créer → se connecter → garde → déconnexion), les **fusionner dans un seul fichier `describe.serial`** (ici `e2e/auth.spec.ts`, l'ancien `onboarding.spec.ts` plié dedans) → état déterministe, contexte navigateur neuf par test (le test de garde est naturellement sans cookie). `retries:0` sur le spec mutant conservé.
- Action : rappel (référence pour toute story dont l'E2E dépend d'un état serveur partagé avec une story sœur).

### 2026-07-01 — [security] Hash-leurre anti-énumération : épingler ses params argon2 aux défauts via un test CI (PR #42)
- Problème : `authenticateChild` vérifie un `TIMING_EQUALIZER_HASH` factice quand le profil est inconnu → temps constant (profil-inconnu indiscernable de PIN-faux, AUTH §4). Mais ce hash fige `m=19456,t=2,p=1` **en dur** ; si `AUTH_ARGON2_*` relève le coût en prod, les vrais hash deviennent plus lents que le leurre → oracle temporel **réintroduit silencieusement**.
- Leçon : lier le leurre à la config par un **test de garde** — asserter que `TIMING_EQUALIZER_HASH` contient `m=<memoryCost>,t=<timeCost>,p=<parallelism>` de `CONFIG_DEFAULTS.auth.argon2` → un bump de coût casse la CI et force la regénération du leurre.
- Action : rappel (tout leurre à temps constant doit tracer ses paramètres cryptographiques).

### 2026-07-01 — [auth] Un garde nommé pour un `kind` doit filtrer sur `kind` à la frontière (PR #42, consensus security+PO)
- Problème : `getCurrentChildSession` renvoyait n'importe quelle session valide. Inoffensif en #2.3 (seules des sessions `child` existent), mais l'espace parent (#7) partagera le **même cookie** `mz_session` avec une session `parent` **courte (15 min)** → elle ouvrirait le jeu enfant (et expirerait en pleine partie).
- Leçon : dès que plusieurs `kind` de session partagent un cookie, **filtrer le kind à chaque frontière de garde** (`session?.kind === "child" ? session : null`). Le nom de la fonction doit refléter la garantie qu'elle offre.
- Action : filtre posé en #2.3 (défense en profondeur avant #7) ; verrou enfant/parent à confirmer côté #7 (issue #43). Rappel.

### 2026-07-01 — [next] `cookies()` est asynchrone en Next 16 (PR #42)
- Problème : `cookies()` de `next/headers` retourne une Promise (Next 15+) → `store.set/get/delete` sur le résultat non-await = erreur.
- Leçon : `await cookies()` dans la glue cookie server-only ; garder le **constructeur d'options pur** (`sessionCookieOptions(expiresAt, secure)`) séparé de l'appel `cookies()` → options testables sans mocker `next/headers`, glue testée en mockant `next/headers`.
- Action : rappel.

### 2026-07-01 — [process] Salve de 5 reviewers → APPROVE 1er tour, fixes in-contract avant merge (PR #42)
- Observation : 5 reviewers indépendants (backend/security/frontend+a11y/qa/PO) en // → **5× APPROVE au 1er tour**, uniquement nits/forward-looking. 3 findings de **consensus** appliqués avant merge car in-contract et bon marché (filtre kind, easing tokenisé, test garde timing) ; findings forward-looking **routés en issues** (#43 entrée Parent + verrou kind #7, #44 GC sessions) + commentaire #32 (rate-limit via `headers()` IP) plutôt qu'absorbés.
- Leçon : appliquer les fixes de consensus in-contract tant que le worktree est chaud (une itération), router le hors-scope en issues (anti-drift), merge autonome de l'orchestrateur (story in-contract, CI verte, branche à jour).
- Action : rappel process (confirme la discipline reviewers indépendants + anti-drift).
