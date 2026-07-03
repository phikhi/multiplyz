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

---

## Rétro story #32 — épic #2 Auth-lite (2.4 rate-limit + backoff, PR #46)

### 2026-07-01 — [schema/coverage] Clé composite en PK texte encodée → évite le callback d'extras drizzle (PR #46)
- Problème : une table de compteurs (rate-limit par profil/IP) veut une clé composite `(scope, key)`. Un **PK composite** ou un **UNIQUE index** en drizzle passe par le 3ᵉ argument callback de `sqliteTable` → jamais invoqué au runtime → casse le gate 100 % fonctions (LEARNINGS #34).
- Leçon : encoder la clé composite dans **une seule colonne PK texte** (`"<scope>:<clé>"`, ex. `"profile:5"` / `"ip:1.2.3.4"`), l'assemblage se faisant dans une fonction pure testée (`attemptKey`). Aucun callback d'extras → schéma couvrable à 100 %, et l'upsert `onConflictDoUpdate` cible ce PK simple.
- Action : rappel (pattern pour toute table clé-valeur / compteur / jonction sous gate 100 % fonctions).

### 2026-07-01 — [security/deploy] Rate-limit par IP : X-Real-IP de confiance, pas le 1er maillon de XFF (PR #46, finding backend majeur)
- Problème : lire le **1er maillon** de `X-Forwarded-For` suppose que Nginx **écrase** l'en-tête. Or le template Nginx/Forge par défaut **ajoute** (`$proxy_add_x_forwarded_for`) le `remote_addr` réel APRÈS la valeur cliente → le 1er élément est **contrôlable par le client** → rate-limit par IP contournable (fausse IP/req) ou empoisonnable (bloquer une IP tierce). Le garde **par profil** reste efficace (défense primaire).
- Leçon : côté serveur, préférer **`X-Real-IP`** (posé par Nginx à `$remote_addr`, non-spoofable), `X-Forwarded-For` en repli seulement. Une hypothèse d'en-tête de proxy est une **exigence de déploiement** à tracer (issue infra), pas un acquis.
- Action : `resolveClientIp` (X-Real-IP prioritaire). Exigence Nginx tracée #47 (avant prod). Rappel.

### 2026-07-01 — [e2e] Comportement dépendant du temps réel = pas d'E2E (flaky), couvrir en unitaire avec horloge injectée (PR #46)
- Problème : démontrer le backoff en E2E échoue — la fenêtre est **courte** (base 1 s) et expire pendant la navigation (reload ~1 s) → la tentative « bloquée » ne l'est plus → test flaky sur un gate. Message d'échec identique (générique) → aucune UI distincte à capturer.
- Leçon : un comportement **temporel** se teste avec une **horloge injectée** (`now` en paramètre) en unitaire/intégration, pas en E2E wall-clock. Documenter le non-test (commentaire NB) plutôt que de laisser un trou muet. Vérifier que la nouvelle logique n'introduit pas de flaky dans l'E2E existant (ici : happy-path n'utilise que le bon PIN → reset au succès → compteurs jamais accumulés).
- Action : rappel (tout `now`/délai/expiration → injection d'horloge + test déterministe).

### 2026-07-01 — [auth] Anatomie d'un backoff proportionné (PR #46)
- Problème/rappel : garde-fou anti-brute-force **sans** verrou permanent (c'est un enfant).
- Leçon : (1) **bloquer AVANT le `verify`** (aucun coût argon2 consommé sur cible bloquée) ; (2) n'**enregistrer** un échec que sur une tentative **réellement** vérifiée (le chemin bloqué ne prolonge pas le délai → le backoff court depuis le dernier échec réel) ; (3) **reset au succès uniquement** (un attaquant ne remet pas le compteur à zéro sans le bon PIN) ; (4) bloqué → `null` **générique** indiscernable (anti-énum) ; (5) seuil = bloqué dès `failures >= threshold` (les `threshold` premières tentatives tolérées) ; (6) courbe **plafonnée** (jamais de verrou permanent). Path **générique** (seuil/scope paramétrés) → réutilisable (#2.5 code-secours).
- Action : rappel (réappliquer tel quel à toute vérif de secret rate-limitée).

---

## Rétro story #33 — épic #2 Auth-lite (2.5 récupération PIN parent, PR #49) — **épic #2 COMPLET**

### 2026-07-01 — [coverage/branch] Ordonner un `&&` pour rendre les deux côtés atteignables (PR #49)
- Problème : `if (ok && owner !== undefined)` laisse la branche « `owner !== undefined` faux » **inatteignable** (elle n'est évaluée que si `ok` est vrai, or `ok` vrai implique un owner présent) → gate `branches: 100` rouge.
- Leçon : mettre en **premier** l'opérande qui **varie** réellement dans les tests. `owner !== undefined && ok` : foyer absent court-circuite à gauche (owner undefined), foyer présent évalue `ok` des deux côtés (bon/mauvais code) → les 3 combinaisons du `&&` sont exercées. Règle générale sous gate 100 % : ordonner un `&&`/`||` pour qu'aucune combinaison ne soit logiquement morte.
- Action : rappel (réapplique la discipline « pas de branche morte »).

### 2026-07-01 — [process/coverage] Une branche défensive seulement atteignable en concurrence → issue, pas absorbée (PR #49)
- Problème : le reset (verify async → `UPDATE`) a un TOCTOU (double reset concurrent = last-write-wins). Le fix propre = CAS (`UPDATE … WHERE recovery_code_hash = ?` + `changes === 1` sinon erreur). Mais la branche `changes !== 1` n'est **atteignable qu'en concurrence** → intestable en mono-thread → casserait le gate 100 %.
- Leçon : un durcissement dont la branche d'échec n'est pas déterministe en test unitaire se **route en issue** (#50) plutôt que de l'absorber et vider/contourner le gate. Enjeu réel mais négligeable en single-tenant (+ `disabled={submitting}`) → priorité basse. (Confirmé par le reviewer backend lui-même.)
- Action : rappel (candidat : tester un CAS via injection d'une rotation entre verify et update, si un jour requis).

### 2026-07-01 — [copy] Registre PAR AUDIENCE, pas selon le libellé de l'issue (PR #49)
- Problème : l'issue #33 disait « voix de Teddy », mais l'écran de récupération est **parent** → COPY §5 impose un registre **neutre/vouvoiement** (pas Teddy, pas de tutoiement/emoji). Découvert aussi : `onboarding.recovery` (#2.2) avait laissé fuiter du **tutoiement** sur un écran parent (→ issue #51).
- Leçon : déterminer le registre par l'**audience réelle de l'écran** (enfant = Teddy/tutoiement ; parent = neutre/vouvoiement), pas par la formulation de l'issue. Verrouiller par test (`strings.test` rejette `\btu\b`/`\bte\b` sur les textes parent).
- Action : rappel (réapplique LEARNINGS #2.2 « registre par audience » ; issue #51 pour aligner l'onboarding).

### 2026-07-01 — [reuse/consts] Primitive rate-limit générique + constantes pures partagées (PR #49)
- Observation : (1) le path rate-limit de #2.4 (`rate-limit.ts` + `pin-attempts.ts`, seuil/scope paramétrés) a été réutilisé **sans refactor** pour la récupération — il a suffi d'étendre `AttemptScope` de `"recovery"`. Confirme le dividende d'un cœur générique. (2) `RECOVERY_CODE_LENGTH`/alphabet ont dû être **remontés dans `validation.ts`** (module **pur, client-safe**) car `tokens.ts` (import argon2, server-only) ne peut pas être importé côté client (l'UI a besoin de la longueur). `tokens.ts` réimporte + réexporte (compat).
- Leçon : concevoir les gardes avec seuil/scope paramétrés (réemploi cross-story) ; placer les **constantes partagées client+serveur** dans un module **pur** (jamais un module server-only qui tire argon2/DB).
- Action : rappel.

### 2026-07-01 — [process] Clôture d'épic : contrat mis à jour + 5 stories salve reviewers (épic #2)
- Observation : épic #2 Auth-lite bouclé en 5 stories séquencées (2.1 fondation → 2.5 récup), chacune 4–5 reviewers indépendants **APPROVE au 1er tour** (nits/forward-looking uniquement), fixes de consensus in-contract appliqués à chaud, hors-scope systématiquement **routé en issues** (anti-drift). Décision d'impl in-contract (code de secours usage-unique régénéré) → **AUTH §5 mis à jour canoniquement** dans la PR (le contrat suit la réalité). Fondations minces + génériques (PinPad, rate-limit, hash, sessions) ont rendu chaque story consommatrice courte.
- Leçon : séquencer un épic par surfaces partagées, garder les fondations génériques, mettre à jour la spec quand une décision in-contract la précise, router le forward-looking. Discipline reviewers indépendants + merge autonome orchestrateur (in-contract, CI verte) tenue sur 5 stories.
- Action : rappel process (transposer à l'épic #3 Moteur math).

---

## Rétro story #57 — épic #3 Moteur math (3.1 Faits & compétences, PR #65)

### 2026-07-02 — [dx/subagent] `~/.nvm/nvm.sh` inexistant : nvm = fonction shell non sourçable en sous-shell non interactif (PR #65)
- Problème : le brief de subagent de build disait `. ~/.nvm/nvm.sh && nvm use 22` (CLAUDE.md « Node 22 via nvm use »). Sur cette machine nvm est exposé comme **fonction shell** via le profil interactif ; `~/.nvm/nvm.sh` **n'existe pas** → la commande échoue en sous-shell non interactif (subagent/Bash tool). Le build a dû mettre Node 22 sur le PATH directement.
- Leçon : dans un contexte non interactif (subagent, Bash tool, CI-like), utiliser `export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"` (ou détecter la version installée) plutôt que sourcer nvm. `nvm use` marche seulement dans un shell interactif où la fonction est chargée.
- Action : **rappel fort** — l'inclure dans tout brief de subagent de build multiplyz. Candidat : script helper repo (`scripts/with-node.sh`) ou doc DX. (Réappliqué dès #58.)

### 2026-07-02 — [engine/data] Désérialiser une clé persistée = valider domaine + round-trip bijectif, pas seulement la syntaxe (PR #65, consensus backend+qa MAJOR)
- Problème : `parseFactKey` (reconstruit un `Fact` depuis sa clé, future `attempts.fact_id`/`mastery.fact_id`) validait la **syntaxe** (séparateur, préfixe, numérique, tri canonique) mais **pas le domaine** : `parseFactKey("comp10_999")` → réponse -989 ; `sub_3-15` → -12 (viole b≤a) ; `mult_0x5` → opérande 0 ; `comp10_007` → `{key:"comp10_7"}` (la branche comp10 sautait le check round-trip `fact.key === key` des branches binaires). Une clé corrompue/hors-Tier1 **relue de la DB** aurait produit une réponse absurde au lieu d'être rejetée. Deux reviewers (backend + qa) l'ont trouvé **indépendamment** → signal fort.
- Leçon : tout parseur d'un **identifiant persisté** doit (1) valider les opérandes contre le **domaine canonique** (pas juste la forme) et (2) garantir le **round-trip bijectif** (`fact.key === key`) sur **toutes** les branches. Facteur : un **prédicat de bornes unique** (`isFactInDomain`) partagé entre le **générateur** et le **parseur** → génération et relecture ne peuvent pas diverger. Ajouter `Number.isSafeInteger` dans le parse d'entier (au-delà de 2^53 le round-trip se corrompt silencieusement).
- Action : rappel (réappliquer à toute (dé)sérialisation de `fact_id`/clé métier en #58/#63 ; garde-fou avant que la clé n'alimente une écriture DB).

### 2026-07-02 — [process/⚙️] Un ⚙️ de calibration signalé par un reviewer ≠ drift : garder le défaut spec-littéral + router au playtest (PR #65, game-design REQUEST_CHANGES)
- Problème : le reviewer game-design a mis REQUEST_CHANGES sur le cardinal `sub=210` (`a≤20, b≤a`) vs add/mult=55 (déséquilibre Tier 1 → pace §7 / tier §8). Mais (a) ENGINE §1 marque ce cardinal `~ borné ⚙️` (calibration) et §12 ne verrouille que « add/sous **dans 20** » → 210 est **fidèle au littéral** ; (b) le fix proposé (`a,b∈1..10`) **supprimait les exemples canoniques d'ENGINE eux-mêmes** (`sub_15-6`, `sub_12-5`, minuende>10, cœur CE1) → objectivement faux ; (c) backend + PO jugeaient 210 in-contract.
- Leçon : distinguer **décision verrouillée** (→ escalade drift) d'un **⚙️ de calibration** (→ autonomie orchestrateur, ADR 0004). Sur un ⚙️ : garder le **défaut spec-littéral**, **assumer explicitement** le choix dans le code (commentaire ⚙️ calibrable), et **router le rééquilibrage en issue `discovered`** pour calibration au moment où l'effet se matérialise (ici #66 → #60 3.4 / playtest) — **ne pas** élargir la story de fondation pour trancher une calibration aval. Ne pas appliquer aveuglément le fix d'un reviewer s'il contredit la spec.
- Action : rappel process (⚙️ = orchestrateur tranche + trace ; ne jamais absorber une calibration aval dans une fondation).

### 2026-07-02 — [process] Panel complet sur fondation cœur + re-review ciblée du seul reviewer bloquant (PR #65)
- Observation : 4 reviewers indépendants sur la fondation du moteur (backend/qa/game-design/PO) → 2 APPROVE + 2 REQUEST_CHANGES au 1er tour. Le MAJOR (robustesse `parseFactKey`) est remonté **indépendamment** par backend ET qa = vrai défaut, pas un nit. Fixes de consensus appliqués **au worktree chaud en une itération** (via SendMessage au subagent de build), puis **re-review du seul reviewer bloquant restant** (qa) — pas de re-run du panel entier (fan-out au risque, §7 : le changement était mécanique/durcissement, backend+PO non impactés).
- Leçon : sur une fondation cœur, panel complet ; un finding trouvé par 2 reviewers = priorité haute ; après fix, ne re-solliciter que les reviewers dont le verdict bloquait ou dont la surface a changé (économie de quota). Merge autonome quand scope+PO ✅ + CI verte + à jour, en documentant le ruling sur un REQUEST_CHANGES in-contract.
- Action : rappel process.

---

## Rétro story #58 — épic #3 Moteur math (3.2 Schéma mastery/attempts + config moteur ⚙️, PR #68)

### 2026-07-02 — [process] Leçons appliquées d'emblée par le subagent de build → 4× APPROVE 1er tour, zéro friction CI (PR #68)
- Observation : contrat data+config (schéma `mastery`/`attempts` + `loadEngineConfig`) → 4 reviewers indépendants (backend/security/qa/PO) **APPROVE au 1er tour**, aucun bloquant. Le build a **réappliqué proactivement** les leçons accumulées : PK texte encodée `masteryKey` (pattern `pin_attempts`, évite le callback extras drizzle #34/#46), FK cascade niveau colonne testée via `getTableConfig().foreignKeys[].reference()`, `loadEngineConfig` pur sans `server-only` (consommé hors-Next #34), **Node 22 via PATH direct** (#57 appliqué → aucune casse d'outillage cette fois). backend + qa ont **exécuté les gates localement** (355 tests 100 % non-vacuous, `db:migrate` idempotent 2×, cascade vérifiée en DB réelle) = verify haute confiance sur un contrat data.
- Leçon : LEARNINGS lu+appliqué avant de coder = la story de contrat la plus risquée passe sans tour de correction. Confirme le dividende du fichier de leçons + fondations génériques réutilisées.
- Action : rappel (transposer aux stories logiques 3.3–3.7).

### 2026-07-02 — [contrat] Contrat le plus précis gagne : `is_retry` d'ENGINE §10 malgré silence de PLAN §data (PR #68)
- Problème/décision : PLAN §Modèle de données ne liste pas `is_retry` sur `attempts`, mais ENGINE §10 (contrat pédagogique, plus précis pour cette table) l'exige (re-ask intra-niveau §4/§9). Inclus par le build → décision in-contract, pas un drift (aucune contradiction verrouillée, la spec la plus spécifique prime).
- Leçon : quand deux specs se recouvrent, la **plus précise pour la surface concernée** est le contrat effectif ; un champ présent dans l'une et tu dans l'autre (sans contradiction) n'est pas un drift. Documenter la résolution dans la PR.
- Action : rappel.

### 2026-07-02 — [config] Un bloc de config ⚙️ est un contrat BRUT non validé de façon croisée → la logique consommatrice doit clamper (PR #68, backend MINOR forward-looking)
- Problème : `EngineConfig` valide chaque champ isolément (listes/ratios/seuils) mais **pas les relations** (rien n'empêche `ENGINE_MAX_BOX=0` ou `promoteBoxes>maxBox` par env). Sans impact ici (posé, non consommé).
- Leçon : une story de config **pose** des valeurs brutes ; la **validation croisée + le clamp** (`min(maxBox, box+promote)`, `max(0, box-demote)`) appartiennent à la **logique consommatrice** (3.3 Leitner), qui ne doit jamais supposer la config cohérente. Router en note sur la story consommatrice (#59), ne pas sur-valider la config brute.
- Action : note routée #59 (3.3) ; findings forward-looking aussi routés #63 (valider `fact_id`/`profile_id` serveur avant insert) + #60 (index DUE/NEW/MAINT via migration si lent). Rappel anti-drift.

---

## Rétro story #59 — épic #3 Moteur math (3.3 Modèle de maîtrise : Leitner + fluence + anti-mash, PR #70)

### 2026-07-02 — [engine/pédagogie] Anti-mash : le principe supérieur (§2 anti-devinette) prime sur l'illustration littérale (§9) → rapide+juste ne promeut pas non plus (PR #70, in-contract confirmé game-design+PO)
- Problème/décision : ENGINE §9 décrit littéralement « très rapide **ET fausse** → faux, pas de promotion » (silence sur rapide+**juste**). Le build a pris le choix **conservateur** : une réponse `< antiMashMs` (600 ms) n'est **jamais comptée fluente** → un rapide+juste ne promeut pas non plus (retombe sur « juste mais lent », box inchangée, **réponse toujours comptée juste**, non punitif) ; rapide+faux reste faux. game-design ET PO ont tranché **in-contract** (pas de drift, pas d'escalade proprio) : §2 verrouille le garde-fou **anti-devinette** (« maîtrise = rappel juste **ET rapide** ») ; une réponse `<600 ms` chez une enfant de 8 ans n'est pas un rappel automatisé crédible → promouvoir un rapide+juste **violerait §2**, le principe verrouillé, dont §9 n'est qu'une illustration. Le comportement dépend entièrement de `antiMashMs` (⚙️) → rien n'est figé.
- Leçon : sur une ambiguïté pédagogique, distinguer le **principe verrouillé** (ici §2 anti-devinette) de son **exemple** (ici §9 rapide+faux) — trancher par le principe supérieur, pas par la lettre de l'illustration. Choix **conservateur non punitif** (refuser le crédit de maîtrise non mérité, jamais rétrograder/bloquer) = fidèle à no-fail. Le juger in-contract quand : (a) aucune décision verrouillée enfreinte, (b) réversible en 1 ligne, (c) piloté par un ⚙️. Faire confirmer par game-design + PO (pas escalade proprio d'emblée).
- Action : **promotion proposée** — clarifier ENGINE §9 pour verrouiller l'intention (« très rapide `< antiMashMs`, **juste ou fausse** → jamais de promotion (martèlement/devinette) ; un rapide+juste reste compté juste sans crédit de maîtrise »), afin qu'une story future ne « corrige » pas vers la lecture littérale. → issue doc `discovered` **#71** créée. Playtest : si un fact vraiment sur-appris stagne parce que l'enfant répond toujours `<600 ms`, baisser `antiMashMs` (⚙️, ne bloque jamais l'apprentissage).

### 2026-07-02 — [engine] « next_due court » (§2 juste+lent) = délai natif de la boîte non promue, PAS un délai « court » spécial (PR #70)
- Décision : ENGINE §2 dit « juste mais lent → box inchangé, `next_due` court ». Interprété (backend+qa+game-design+PO concordants) comme `next_due = now + délai(box courant)` : le délai reste celui de la boîte non promue (donc plus court qu'après promotion), la table Leitner §11 portant seule la révision espacée — **aucun délai ad hoc distinct**.
- Leçon : ne pas inventer un second barème « court ». Le code de sélection aval (**3.4 #60**) doit s'appuyer sur `next_due` tel quel, sans supposer un délai « juste-mais-lent » séparé.
- Action : rappel (transposer à 3.4 composition de niveau).

### 2026-07-02 — [qa/coverage] 100 % de coverage NE détecte PAS un lookup par clé d'objet erroné : paramétrer les tests sur TOUTES les clés du domaine (PR #70, qa MINOR)
- Problème : `isFluent` lit `config.fluenceThresholdsMs[attempt.skill]` — **indexation d'objet**, pas un branchement. La suite n'exerçait que `skill:"add"` → le 100 % lignes/branches/fonctions restait **vert** alors qu'une régression de clé (typo, mauvais skill mappé, seuil sub/mult 4 s vs add 3 s) serait passée inaperçue. Le gate non-vacuous (all:true + thresholds 100) ne couvre pas ce trou car il n'y a **aucune branche** à couvrir sur un accès indexé.
- Leçon : quand la logique **indexe par une clé de domaine** (enum skill, type, tier…), le 100 % de coverage est **insuffisant** — il faut un test **paramétré sur chaque clé** (boucle sur toutes les compétences vérifiant le seuil propre à chacune). Corollaire du principe « gate non-vacuous » : coverage 100 % ≠ toutes les valeurs de domaine testées.
- Action : **promotion candidate** (discipline QA/CLAUDE.md) — « logique indexée par clé de domaine → test paramétré sur toutes les clés ». Fix appliqué à chaud sur #70 (mult/sub 4 s vs add/comp10 3 s).

### 2026-07-02 — [process] Fondation cœur, leçons réappliquées → 4× APPROVE 1er tour ; fixes QA (tests only) appliqués sans re-review (PR #70)
- Observation : 3ᵉ story cœur d'affilée (#57/#58/#59) avec **4 reviewers APPROVE au 1er tour**, zéro bloquant. Le build a réappliqué proactivement : clamp config dans la logique consommatrice (**note #58 honorée**), Node 22 via PATH (#57), horloge injectée, ordre des `&&` pour éviter branches mortes (#49). Les 4 findings QA étaient **mineurs, tests-only** (0/mult/chaînage/clamp symétrique) → appliqués en une itération via SendMessage au subagent (worktree chaud), **sans re-review** (tous déjà APPROVE, aucun changement de logique, +9 tests → 388, 100 % maintenu). Le point anti-mash routé d'emblée par le build en flag `DRIFT?` → tranché in-contract par les 2 reviewers pédago (game-design+PO) sans halte proprio.
- Leçon : sur des ajouts **tests-only** post-APPROVE, pas besoin de re-solliciter le panel (économie quota). Un flag drift honnête du build + le bon panel (game-design+PO pour la pédagogie) résout l'ambiguïté sans escalade proprio quand c'est réversible/piloté par ⚙️.
- Action : rappel process (transposer à 3.4–3.7).

---

## Rétro story #61 — épic #3 Moteur math (3.5 Format QCM/pavé + distracteurs typiques, PR #73)

### 2026-07-02 — [dx/gate] `rtk` (proxy token-killer) MASQUE le résultat de `prettier --check` → vérifier `pnpm format` via la commande CI EXACTE (PR #73, blocker CI)
- Problème : le build a annoncé « format conforme » (via `pnpm exec prettier --check` / le hook `rtk`) mais la CI `quality` (`pnpm format` = `prettier --check .`) était **ROUGE** : prettier reformate les appels **multi-args** `it.each(SKILLS)("…", cb)` (reflow > `printWidth:100`), contrairement aux `it("…")` mono-string. Le proxy `rtk` renvoyait un faux « All files formatted correctly », masquant l'échec. 1 tour de review perdu (backend REQUEST_CHANGES + qa bloquant sur ce seul point).
- Leçon : **ne jamais se fier à `pnpm exec prettier`/format via le hook `rtk`** pour valider le gate format. Vérifier avec la **commande CI exacte** : `rtk proxy pnpm format` (contourne le filtrage) et **exiger exit 0 explicite** avant de cocher le DoD. Idem pour tout gate dont la sortie est filtrée par un proxy. Prettier reflow les callbacks multi-args → le `--check` local doit tourner sur **tout le repo** (`prettier --check .`), pas fichier par fichier.
- Action : **promotion forte** — l'inclure dans tout brief de subagent de build multiplyz (« vérifie `pnpm format` via `rtk proxy`, exit 0, commande CI exacte »). Candidat règle CLAUDE.md/DoD. Récurrence probable sur toute story ajoutant des `it.each`/callbacks multi-lignes.

### 2026-07-02 — [qa] 100 % coverage non-vacuous NE verrouille PAS le CONTENU des branches de repli/bord → mutation testing + assertions de contenu exact (PR #73, qa 2× MAJOR)
- Problème : coverage 100 % réel (non-vacuous) mais 2 mutations **survivent** : `value >= 0` → `value > 0` dans `isValidCandidate` (le distracteur `0` légitime, ex. `comp10_9`, n'était affirmé nulle part — `fillWithOffsets` compense silencieusement) ; `a*(b+2)` → `a*(b+3)` (5ᵉ candidat mult « table voisine », exercé par les faits `a=1`, jamais vérifié en contenu). Cause : les tests de contenu exact (`arrayContaining`) ne portaient que sur les **premiers** candidats typiques ; le **balayage exhaustif** ne vérifiait que forme (longueur/unicité/bornes), pas contenu. Extension de la leçon #59 : le 100 % (même paramétré par clé au niveau macro) ne détecte pas une valeur de **branche de repli/bord** fausse.
- Leçon : sur une logique qui **génère des valeurs de domaine** (distracteurs, réponses, clés), le coverage 100 % non-vacuous est insuffisant → (1) **assertion de contenu exact** sur les branches de **repli/bord** (pas seulement les cas nominaux), (2) un **balayage exhaustif** doit vérifier le **contenu** (au moins sur les cas de repli), pas que la forme, (3) **mutation testing manuel** ciblé sur les bornes (`>=`/`>`, offsets, constantes) pour trouver les assertions manquantes. Le reviewer qa a trouvé ces trous **précisément** en mutant — discipline à garder sur tout module génératif.
- Action : **promotion candidate** (discipline QA) — « module génératif → assertion de contenu exact sur repli/bord + mutation testing des bornes ». Fixes appliqués (PR #73 : +tests contenu `0` et `a*(b+2)`, `FILL_OFFSETS` exporté + ordre verrouillé). Transposer à 3.4 (composition de niveau : vérifier le **contenu** des pools DUE/NEW/MAINT, pas que la taille) et 3.6 (diagnostic).

### 2026-07-02 — [engine] Repli distracteurs `±3` : `±1/±2` de §6 est un HOW sous le WHAT « distracteur proche plausible » → extension in-contract (PR #73, game-design+PO)
- Problème/décision : §6 littéral prévoit une complétion `±1/±2` quand < 3 distracteurs typiques. Balayage exhaustif des ~329 faits Tier 1 → **1 seul** cas (`sub_1-1`, réponse=0, bord `a=b`) où `±1/±2` ne fournit pas 3 distracteurs valides (`≥0`, `≠`réponse, uniques). Build a étendu à **±3** (`MAX_FILL_OFFSET`, constante ⚙️, `FILL_OFFSETS` dérivée). game-design + PO **in-contract** : le vrai contrat produit est « TOUJOURS 4 choix crédibles, jamais de blocage » ; `±1/±2` est un détail d'implémentation du remplissage, pas une garantie verrouillée ; `±3` **sert** ce contrat au seul point où `±2` échoue, artefact de bord unique, réversible. Alternative rejetée (bannir `a=b` dans `domain.ts` 3.1) = vrai drift (supprime un fait légitime, hors scope).
- Leçon : distinguer la **garantie produit** (WHAT : 4 choix, no-block) du **détail d'implémentation** (HOW : amplitude du repli) — étendre le HOW pour servir le WHAT est in-contract quand borné/réversible/⚙️. Un pseudo-code de spec (`±1/±2`) n'est pas une décision verrouillée §12.
- Action : rappel (⚙️ `MAX_FILL_OFFSET` calibrable ; lié au rééquilibrage univers sub **#66** — le bord `a=b` disparaîtra peut-être au playtest).

### 2026-07-02 — [process] Story mécanique : 1 tour de re-review (format + 2 majors qa) au lieu du 1er-tour-APPROVE des fondations — re-vérif ciblée sans re-panel (PR #73)
- Observation : contrairement à #57/#58/#59 (4× APPROVE 1er tour), cette story mécanique a pris **1 boucle** : backend REQUEST_CHANGES + qa CHANGES_REQUESTED, tous deux sur le **blocker format** (rtk) + qa 2 majors (mutation testing). game-design + PO APPROVE d'emblée (dont ruling ±3 in-contract). Fixes de consensus (format + 2 tests contenu + ordre + constante + corps PR) appliqués en **une itération** via SendMessage au subagent (worktree chaud) → CI verte. **Pas de re-panel** : les 2 bloqueurs étaient **objectivement vérifiables** (format = CI verte ; trous qa = tests prescrits présents, confirmés par grep + CI) → l'orchestrateur a **vérifié directement** (grep tests + `gh pr checks`) plutôt que de relancer backend/qa (économie quota, story mécanique, changements tests-only/format).
- Leçon : quand les findings bloquants sont **objectivement vérifiables** (gate CI, présence de tests prescrits), re-vérifier **directement** au lieu de relancer le reviewer (économie quota) ; réserver la re-review humaine-agent aux jugements non mécaniques. Le blocker format (rtk) + les trous de contenu auraient été évités si le build avait tourné la commande CI exacte + mutation-testé ses branches de repli → boucle feed-forward dans les briefs.
- Action : rappel process (briefs 3.4+ : `rtk proxy pnpm format` exit 0 + assertions de contenu sur repli/bord).

---

## Rétro story #60 — épic #3 Moteur math (3.4 Composition de niveau, PR #75)

### 2026-07-02 — [qa/coverage] 100 % coverage NE garantit PAS la correction d'une garde : un test à chemin unique et sans effet observable masque un bug latent (PR #75, qa CHANGES_REQUESTED → VRAI BUG, pas un trou de test)
- Problème : `insertReasks` (garde anti-adjacence des re-ask, ENGINE §4 « jamais 2× le même fait d'affilée ») était **incorrecte** — le re-ask du fait « presque-su » (dernier item du niveau, placé là par `orderForVictory`) restait collé à son occurrence originale. Le 100 % de coverage marquait la garde **verte** : le seul test déclencheur (niveau à 1 fait) produisait le **même résultat avec et sans la garde** (aucun autre fait pour tester une position alternative) → une branche exécutée mais sans **effet observable** sur l'assertion. La 1ʳᵉ passe de build avait même écrit dans la PR « branches mortes évitées » alors qu'une garde active était buggée. Le mutation testing qa (désactiver la garde → le test survit) l'a exposé. Fix : réécriture en `insertNonAdjacent` (balaye les points d'insertion de la fin vers le début, retient le premier sans voisin homonyme des deux côtés) + un test avec **au moins 2 faits distincts** dont le re-ask est le presque-su, qui **échoue** si la garde est retirée. Autres trous trouvés par la même discipline : borne exacte du cap de consolidation (`weak === consolidationThreshold`, mutant `>=`→`<` tué par un test pile + un test `-1`), `strengthOf` NEW(`-1`) vs box0(`0`) (mutant `-1`→`0` tué par un test d'ordre relatif explicite), assertion `toBe(3)` (vs `toBeGreaterThanOrEqual`) pour distinguer le palier interleaving 3 du palier 4.
- Leçon : une **garde/branche de repli** dont l'unique test déclencheur produit le **même output avec et sans elle** est un angle mort de coverage — le pourcentage la marque verte, un bug latent y survit indéfiniment. Sur toute garde anti-X (anti-adjacence, anti-doublon, anti-collision, borne exacte, ordre relatif entre deux constantes voisines), exiger **avant de déclarer done** : (1) un test dont l'assertion **échoue** si la garde est retirée/mutée (pas seulement « la ligne s'exécute »), (2) mutation-tester manuellement les opérateurs de bord (`>=`/`>`, `-1`/`0`, offsets) comme déjà noté #61 pour les modules génératifs — ici étendu aux **gardes structurelles/anti-collision**, pas seulement aux valeurs de domaine générées.
- Action : **renforce et généralise la leçon #61** (qui portait sur les modules *génératifs* de valeurs) aux **gardes anti-X et branches de repli** en général. **Promotion forte proposée** — durcir CLAUDE.md §Tests/CI : « toute garde/branche de repli exige ≥1 test à effet observable (échoue si la garde saute), pas seulement la couverture de ligne ». Voir note de promotion ci-dessous.

### 2026-07-02 — [process/⚙️] Ambiguïté de spec quantitative (palier interleaving « 4 compétences » inatteignable au défaut) : garder le littéral, ne pas deviner un mapping spéculatif, router au playtest (PR #75, consensus backend+PO+game-design)
- Problème/décision : ENGINE §7 dit « 2 puis 3–4 compétences à mesure que la maîtrise monte », et le code mappe linéairement `count = 1/2/3/4` aux paliers `progress ≥ k × interleaveThresholdRatio`. Au défaut `interleaveThresholdRatio = 0.4`, le palier 4 exigerait `progress ≥ 1.2` — hors de `[0,1]` — donc **inatteignable** : l'enfant plafonne à 3 compétences mêlées. La logique du palier 4 est correcte et testée (via override de seuil), seulement **inactive avec la config livrée**. Backend/PO/game-design ont jugé **non bloquant pour la v1** : c'est un ⚙️ de calibration (progression douce, monotone, no-fail respectés), pas une décision verrouillée.
- Leçon : quand une spec donne une **fourchette qualitative** (« 3–4 ») et que l'implémentation naturelle rend une borne inatteignable au défaut, **ne pas deviner** un mapping non-linéaire spéculatif pour la « faire marcher » sans données — garder le mapping **littéral le plus simple**, documenter la limite en **commentaire code** (visible, pas silencieux) et router à une **issue `discovered`** de calibration playtest (ici #76, avec 2 options tranchées au besoin : baisser le ratio, ou mapping non-linéaire). Confirme le pattern déjà noté #57 (cardinal `sub` 210 vs déséquilibre Tier 1) : sur un ⚙️, l'orchestrateur tranche en autonomie et trace, il ne bloque pas la fondation pour une calibration qui ne se juge qu'au playtest réel.
- Action : rappel process (⚙️ de calibration = spec-littéral + commentaire + issue de suivi, jamais un mapping deviné). Issue #76 ouverte (options + note ENGINE §11 déléguée).

---

## Rétro story #62 — épic #3 Moteur math (3.6 Diagnostic de départ, PR #78)

### 2026-07-03 — [qa/mutation] Un mutant qui SURVIT sans effet observable ≠ bug : distinguer « code mort/sans-effet » (acceptable) de « test manquant sur un vrai comportement » (#75) (PR #78, qa MINOR, 4× APPROVE)
- Problème/observation : le mutation testing qa a trouvé UN mutant survivant — le tie-break `a / 10` de `difficultyScore` (cas `comp10`) : le retirer ne change **aucune** sortie de `selectDiagnostic` car `generateFacts("comp10")` produit toujours `a=1..9` en ordre ascendant et `Array.sort` V8 est **stable** → l'ordre d'insertion masque déjà l'absence du tie-break. Contrairement à #75 (mutant survivant = **vrai bug latent** dans une garde anti-adjacence), ce mutant survit parce que le code est **sans effet observable dans le domaine réel** (déterminisme déjà garanti par la stabilité du tri), pas parce qu'un comportement réel n'est pas testé. Idem la garde `counts[skill] < PER_SKILL_TARGET+1` : **mathématiquement inatteignable** en `false` avec les bornes livrées (clamp amont) → code défensif mort, pas un bug.
- Leçon : en mutation testing, classer chaque mutant survivant : (a) **survit car code mort/sans-effet** (déterminisme déjà garanti autrement, branche inatteignable sous les bornes) → **ne pas sur-corriger** ; option la plus propre = **retirer le commentaire qui revendique une garantie non testée** (ici « tie-break pour ordre total ») ou documenter l'hypothèse (stabilité du tri) plutôt qu'ajouter un test artificiel ; (b) **survit car un vrai comportement n'est pas asserté** (#75) → **bug/trou à corriger avant done**. Le critère discriminant = « ce mutant a-t-il un effet observable sur une sortie pédagogique réelle (amorçage boîtes, adaptatif, taille/répartition) ? ». Un commentaire qui promet une propriété (déterminisme, ordre total) qu'aucun test ne vérifie est une dette trompeuse — l'aligner sur la réalité.
- Action : rappel (nuance la discipline #75/#61 : mutation testing = trier les survivants par effet observable, pas les tuer tous aveuglément). Nit tie-break non bloquant, non absorbé (comment-only, 0 effet) — noté ici.

### 2026-07-03 — [process] 4× APPROVE 1er tour + ZÉRO major qa : les briefs feed-forward des LEARNINGS ont saturé les angles morts habituels (PR #78)
- Observation : 1re story cœur du moteur où qa ne trouve **aucun MAJOR** (vs #70/#73/#75 qui avaient 1–2 majors de mutation-testing). Le brief de build feed-forwardait explicitement les leçons coverage (#59 test paramétré par clé, #73 assertion de contenu exact sur repli/bord, #75 garde à effet observable, #61 mutation-testing des bornes) → le build les a **appliquées d'emblée** (`it.each(SKILLS)`, ancre `toEqual([...18 clés...])` comme filet transversal, tests d'effet observable sur l'adaptatif « ne pas enfoncer » et l'anti-mash, bornes `>=`/`>` mutées). Réutilisation stricte des modules 3.1/3.2/3.3 (`generateFacts`/`parseFactKey`/`isFluent`/`boxDelayMs`) sans réinvention. Panel complet (backend/game-design/qa/PO) sur module cœur → 4× APPROVE, findings tous MINOR/NIT single-reviewer, aucun consensus bloquant. Merge autonome orchestrateur (in-contract, CI verte, à jour). Forward-looking routé : validation de forme `responseMs`/garde `Number.isFinite(diagnosticSize)` → **note sur #63** (frontière serveur 3.7, LEARNINGS #36) ; divergence doc PRODUCT.md « ~15 » vs ENGINE « ~18 » → **issue #79**. Aucune absorption hors-scope.
- Leçon : mettre les leçons coverage/mutation dans le **brief de build** (pas seulement dans LEARNINGS que le build lit) fait converger la story du 1er coup — le coût d'un tour de review qa se déplace vers un brief plus précis. Confirme #58 (« leçons appliquées d'emblée → 4× APPROVE »). Router systématiquement le forward-looking vers la story consommatrice (frontière serveur) plutôt que d'ouvrir une issue flottante quand la story cible existe déjà (#63).
- Action : rappel process (transposer les briefs feed-forward à 3.7 #63 : TOCTOU/transaction sync #36, validation de forme des payloads, idempotence/monotonie, horloge serveur).

### 2026-07-03 — [engine] Séparer sélection / adaptatif / amorçage en 3 fonctions pures (pas de boucle interactive dans le module) (PR #78)
- Décision : le diagnostic (§3) est modélisé en 3 fonctions pures — `selectDiagnostic` (les ~18 faits + difficulté), `adaptDiagnostic` (ajuste le plan restant selon les réponses : ne pas enfoncer / sonder plus dur), `seedDiagnosticMastery` (réponses → lignes `MasteryState` via le barème boîte 3/2/0). Le module **ne porte aucune boucle interactive** : c'est l'appelant (API 3.7) qui orchestre pose→réponse→ré-appel. Difficulté = proxy déterministe par compétence (distance-au-pivot comp10, somme+retenue add, minuende+emprunt sub, produit mult), terciles, prise **centrale** (représentatif du tier, pas son bord).
- Leçon : garder les modules moteur **purs et sans état de session** (l'orchestration/persistance vit en 3.7) → testables en isolation, réutilisables, et la frontière I/O reste au seul endroit prévu. Le proxy de difficulté est un ⚙️ pédagogique heuristique assumé (ancré par test de contenu exact) → à surveiller au playtest, pas à figer davantage.
- Action : rappel (3.7 consomme ces 3 fonctions ; l'état/transaction/validation réseau y vivent, pas dans `diagnostic.ts`).

---

## Rétro story #63 — épic #3 Moteur math (3.7 Persistance + API serveur, PR #81)

### 2026-07-03 — [qa/mutation] Gardes-frères d'un même payload : mutation-tester CHACUNE, pas juste une — la couverture asymétrique de gardes parallèles est un angle mort récurrent (PR #81, qa MAJOR tests-only, 4× APPROVE)
- Problème : `submitAttempt` valide un payload public avec deux gardes de forme **sœurs** — `const correct = input.correct === true;` (ligne 235) ET `const isRetry = input.isRetry === true;` (ligne 236). Le build avait mutation-testé `correct` (test avec `correct: 1` truthy-non-booléen → mutant `=== true`→`Boolean(...)` tué) mais **pas** `isRetry` (tests uniquement avec `true`/`false` littéraux) → le mutant `input.isRetry === true`→`Boolean(input.isRetry)` **survivait**. Impact réel faible (comportement identique sur ce chemin, aucune corruption) mais l'asymétrie casse la garantie « gardes de forme strictes et symétriques » revendiquée dans la PR. Fix tests-only : test miroir `isRetry: 1` (à effet observable — la réponse EST comptée car `1 !== true`, échoue si le mutant `Boolean(1)=true` la traitait en re-essai non compté). +1 test (568), aucune logique touchée.
- Leçon : quand une fonction valide **plusieurs champs par le même pattern de garde** (`x === true`, `parseFactKey`, bornes), mutation-tester **chaque champ**, pas un représentant — un `it.each` sur les champs-frères, ou un test miroir explicite par garde. La complétude d'un test sur UNE garde ne se **transfère pas** aux gardes sœurs (angle mort déjà vu #59 « indexé par clé → tester toutes les clés », ici étendu aux **gardes de forme parallèles d'un payload**). Corollaire : un reviewer qa qui mute *chaque* garde documentée-comme-testée (pas juste échantillonne) trouve ces asymétries — discipline à garder.
- Action : **promotion candidate** (discipline QA/brief de build) — « payload à N gardes du même pattern → mutation-tester les N, pas 1 ». À feed-forwarder dans les briefs de toute story validant un payload public. Fix appliqué à chaud (tests-only, pas de re-panel — QA lui-même l'a recommandé).

### 2026-07-03 — [engine/data] `client_attempt_id` (idempotency key) : SYNC §2 est la spec la plus précise → changement de schéma in-contract ; check applicatif dans une transaction sync = atomique en mono-process (PR #81, aucun drift)
- Décision : l'idempotence des soumissions (SYNC §2 « chaque écriture porte un id client → un retry ne crée pas de doublon ») a exigé une **nouvelle colonne** `attempts.client_attempt_id` + migration `0004`. Évalué **in-contract** (pas de drift, pas d'ADR séparé) : SYNC §2 l'**exige explicitement** (spec la plus précise pour cette surface), aucune décision verrouillée PLAN enfreinte, précédent `is_retry`/#58 (« la spec la plus précise gagne, HOW dans le WHAT »). Le dédoublonnage = check applicatif `attemptExists(profileId, clientAttemptId)` **dans la transaction synchrone** better-sqlite3 (BEGIN…COMMIT natif, callback sans `await`, vérifié dans node_modules par le reviewer backend) → check-then-write **réellement atomique intra-process** dans un daemon Node **mono-process** (STACK.md). Pas de contrainte UNIQUE DB (LEARNINGS #34/#46 : évite le callback extras drizzle) — suffisant et correct tant que mono-process.
- Leçon : (1) un changement de schéma **exigé par une spec** (SYNC/ENGINE/PLAN) est in-contract, pas un drift — la spec la plus précise pour la surface prime (confirme #58). (2) Dans un daemon **mono-process à binding synchrone** (better-sqlite3), un check-then-write applicatif dans `db.transaction()` sérialise sans faille TOCTOU — pas besoin de contrainte DB pour l'idempotence à ce stade ; **documenter l'hypothèse d'archi** et router la contrainte UNIQUE/index vers une issue pour le jour où l'archi passe multi-process/scaling (→ **#82**).
- Action : rappel (tout mécanisme d'idempotence = tracer l'hypothèse mono-process ; #82 = index/UNIQUE si volume/cluster).

### 2026-07-03 — [security/archi] Timing fourni par le client dans une archi optimiste (SYNC §2) = tradeoff connu : borner strictement + router l'anti-triche au playtest, pas sur-ingénierer (PR #81, security MINOR → #83)
- Problème : `response_ms` (décide box 3 vs 2, fluence ENGINE §2) est **fourni par le client** (borné fini/entier/≥0, pas mesuré serveur) → un client trichant (toujours `1` ms) biaiserait `avgResponseMs`/la fluence. Enjeu **pédagogique** (pas sécurité — box recalculée serveur, aucune corruption de données). Inhérent à l'archi optimiste SYNC §2 (feedback affiché tout de suite, écriture confirmée derrière) ; mesurer serveur imparfait aussi (latence réseau). Contexte = **app familiale mono-enfant** : l'enfant n'a aucun intérêt à truquer son propre diagnostic.
- Leçon : dans une archi optimiste où le client fournit une mesure (timing), la **borne stricte de forme** (fini/≥0) est le garde-fou proportionné ; l'anti-triche complet (mesure serveur/plausibilité) est un durcissement à **router en issue playtest** (#83), pas à sur-ingénierer dans la story de fondation — surtout en contexte single-tenant familial sans adversaire réel. Distinguer « faille sécurité » (→ bloquer) de « biais pédagogique théorique en contexte sans adversaire » (→ borner + tracer).
- Action : rappel (#83 : options mesure-serveur / plausibilité / accepter-v1, reco accepter-v1 famille). Confirme la discipline « borne de forme sur server action publique » (#36) suffit ici.

### 2026-07-03 — [process] Story serveur la plus risquée : panel complet (backend+security+qa+PO), 4× APPROVE + 1 MAJOR tests-only → fix à chaud sans re-panel (PR #81)
- Observation : la story la plus à risque de l'épic (transactions, idempotence, écriture publique enfant) → **panel complet 4 reviewers** ; backend, security ET qa ont **exécuté les gates + mutation-testé à la main** sur le worktree réel (backend a lu le wrapper transaction dans node_modules pour confirmer la synchronicité ; qa a injecté/restauré 4 mutants) = verify haute confiance sur une frontière serveur. 3× APPROVE d'emblée + qa APPROVE-avec-1-MAJOR (asymétrie de mutation-test, tests-only, self-recommandé « fix mineur avant merge »). Fix tests-only appliqué à chaud via SendMessage au subagent (worktree chaud) → **pas de re-panel** (aucun changement de logique, backend/security/PO non impactés, le mutant tué est objectivement vérifiable). Forward-looking routé en **3 issues** (#82 index/UNIQUE, #83 timing client) + 2 nits notés (isRetry duplication sémantique `service.ts:249`, index `attemptExists`). Merge autonome (in-contract, CI verte, à jour) après update-branch.
- Leçon : sur une frontière serveur à risque, le panel complet AVEC exécution réelle des gates/mutants (pas review-sur-lecture) attrape les asymétries subtiles ; un MAJOR tests-only self-approuvé se corrige à chaud sans re-panel (économie quota, §7 fan-out au risque). Router systématiquement le durcissement forward-looking (scaling, anti-triche) en issues plutôt que d'élargir la fondation.
- Action : rappel process (transposer à 3.8 : panel frontend+a11y+qa+PO, E2E/captures Playwright car surface UI ; next-dev-loop indispo #24 → suppléé E2E).

---

## Rétro story #64 — épic #3 Moteur math (3.8 Écran de jeu nu, PR #85) — **épic #3 COMPLET**

### 2026-07-03 — [process/drift] Un bugfix qui RESTAURE un contrat verrouillé (touchant une story mergée) est in-contract, PAS un drift — convoquer les autorités concernées plutôt qu'escalader réflexivement au proprio (PR #85, DRIFT? flaggé par le build → ruling UNANIME in-contract 3 autorités)
- Problème/décision : en jouant `/jouer` bout-en-bout (E2E), le build 3.8 a découvert un bug dans `level.ts` (story mergée #60/§7) : le décompte des faits « fragiles » qui force `capNew=0` comptait les faits **NEW jamais tentés** (`state===null`, sans boîte) → dans un grand domaine (`sub`=210), `weak` dépassait toujours `consolidationThreshold` → `capNew=0` **permanent** → combiné à DUE/MAINT vides juste après diagnostic → **niveau VIDE** → `/jouer` injouable = violation directe du no-fail verrouillé (PRODUCT §2.2.3 « un niveau se termine toujours »). Le build a **corrigé** (`state !== null && isWeak(state)`) ET **flaggé `DRIFT?`** honnêtement (le fix touche la pédagogie §7 d'une story antérieure). L'orchestrateur **n'a PAS halté au proprio** : il a convoqué les **3 autorités concernées** (backend = correction logique, game-design + PO = pédagogie/produit) qui ont **unanimement** rulé **IN-CONTRACT** : le fix **restaure** la lecture littérale de §7 (« box≤1 » présuppose une boîte existante = un fait déjà rencontré ; PLAN §mastery) au service du WHAT verrouillé (no-fail), il ne **change** aucune sémantique verrouillée (cap identique, seuil inchangé, seule la définition de « fragile » corrigée pour exclure une catégorie qu'elle n'aurait jamais dû inclure). Précédent : #75 (garde à effet observable), #73 (étendre le HOW pour servir le WHAT = in-contract si borné/réversible), #70 (ambiguïté pédago tranchée in-contract par game-design+PO sans halte proprio).
- Leçon : distinguer **« bugfix restaurant une décision verrouillée »** (→ in-contract, même s'il touche une story mergée, si : (a) restaure vs change le WHAT verrouillé, (b) chirurgical, (c) les **autorités de la surface** concordent) de **« changement d'une décision verrouillée »** (→ escalade proprio). Le flag `DRIFT?` honnête du build = bonne discipline procédurale ; la **résolution** = convoquer le bon panel (les autorités de la décision touchée), pas escalader réflexivement. En run headless, escalader au proprio n'est requis que si le ruling des autorités **diverge** ou conclut à un vrai changement verrouillé — ici unanimité in-contract → merge autonome, aucune halte.
- Action : **promotion candidate** (ADR 0004 / orchestrate §6) — clarifier « drift » = *changer* une décision verrouillée, PAS *restaurer* une décision verrouillée violée par un bug (ce dernier = in-contract, à confirmer par les autorités de la surface). Router au proprio seulement si le panel diverge.

### 2026-07-03 — [engine/qa] Un bug de composition dépendant de l'état AGRÉGÉ réaliste (beaucoup de NEW) est invisible aux tests unitaires à fixtures minimales — seul l'E2E bout-en-bout sur un domaine réel l'expose (PR #85, découvert en E2E)
- Problème : le bug `capNew` de #60 avait **100 % de coverage** et 4 reviewers APPROVE à l'époque, car ses tests unitaires utilisaient des **fixtures minimales** (peu de faits) où `weak` ne débordait jamais. Le bug ne se manifeste qu'avec l'**état agrégé réaliste** post-diagnostic : ~18 faits amorcés sur ~330, donc une écrasante majorité de NEW dans `sub` (210 faits) → `weak` explose. Aucun scénario unitaire de #60 ne reproduisait ça ; c'est l'**E2E jouant `/jouer` sur le vrai domaine** (3.8) qui l'a exposé.
- Leçon : les bugs de logique de **sélection/composition qui gatent sur des comptes à l'échelle du domaine** (`weak >= seuil`, cap, ratio) échappent aux tests à fixtures minimales — il faut un test d'intégration/E2E sur un **état de domaine réaliste complet** (post-diagnostic, univers entier), pas seulement des mini-fixtures assemblées à la main. Corollaire : un même mot métier peut porter **deux sémantiques** (`weak` pour le gate `capNew` = faits déjà-vus fragiles ; `weak` pour `skillWeakness`/choix de compétence active = compte NEW à raison) — un fix doit **distinguer** les deux (ici `skillWeakness` correctement NON touché).
- Action : **feed-forward briefs** — toute story moteur gatant sur des comptes domaine-larges = exiger un test sur un état réaliste (univers complet post-diagnostic), pas des mini-fixtures. La story consommatrice E2E (ici 3.8) est le dernier filet — d'où l'importance de l'E2E bout-en-bout sur le vrai moteur.

### 2026-07-03 — [frontend/a11y] La gestion du focus est PAR TRANSITION de contenu, pas par écran : auditer toutes les substitutions de contenu, pas seulement les frontières d'étape « évidentes » (PR #85, frontend MAJOR)
- Problème : `ResultsScreen` gérait le focus au montage (ref-callback, LEARNINGS #36) mais `FeedbackPanel` (transition **question→feedback**, même écran) **non** → au clic sur une réponse, le bouton démonte, le focus retombe sur `<body>`, l'utilisateur clavier perd tout repère. Le pattern #36 était appliqué de façon **incohérente** — sur la frontière « évidente » (fin de niveau) mais pas sur la substitution intra-écran (feedback). Idem détournement de token : `--space-12` (espacement) utilisé comme largeur de layout au lieu de `--max-width-play` (token sémantique dédié).
- Leçon : (1) **chaque substitution de contenu qui retire l'élément focalisé** (pas seulement les changements de route/étape) exige une gestion du focus — **auditer toutes** les transitions d'un écran (question↔feedback↔résultats), pas juste les frontières macro. (2) Ne jamais emprunter un token d'**espacement** pour une **largeur de layout** — utiliser le token sémantique dédié (`--max-width-play`) ; un token détourné contredit `tokens.css` et sous-dimensionne silencieusement.
- Action : rappel a11y/tokens (transposer #36 à toute substitution de contenu ; discipline token = catégorie sémantique correcte).

### 2026-07-03 — [process] Clôture épic #3 Moteur math : 8 stories (3.1→3.8) séquencées par surface partagée, boucle autonome tenue de bout en bout
- Observation : épic #3 bouclé en **8 stories** (3.1 faits → 3.2 schéma/config → 3.3 maîtrise ∥ 3.5 format → 3.4 composition, 3.6 diagnostic → 3.7 persistance/API → 3.8 écran nu), séquencées par **surface partagée** (contrats facts/schéma/config en amont, UI en aval). Pattern autonome tenu sur tout l'épic : **build délégué** à un subagent isolé (Opus cœur moteur/data/sécu, Sonnet mécanique/UI) ; **LEARNINGS feed-forwardés dans les briefs** → convergence 1er tour sur les fondations (#58/#59/#62 : 4× APPROVE) ; **panels dimensionnés au risque** (cœur/serveur = complet backend+sécu+qa+PO+game-design ; UI = frontend+a11y+qa+PO) ; **fixes de consensus in-contract à chaud** (SendMessage worktree chaud, pas de re-panel quand objectivement vérifiable) ; **forward-looking systématiquement routé en issues** (#66/#71/#76/#79/#82/#83), **jamais absorbé** (anti-drift) ; **⚙️ de calibration** gardés au défaut spec-littéral + commentaire + issue playtest ; **merge autonome** de l'orchestrateur (ADR 0003) ; **drift escaladé au proprio = ZÉRO** (le seul `DRIFT?` flaggé — bugfix level.ts — rulé in-contract à l'unanimité des autorités). Chaque story finie par rétro → LEARNINGS + checkpoint statut.
- Leçon : la boucle autonome (orchestrate) tient sur un épic entier cœur-métier sans intervention proprio quand : specs = contrat, LEARNINGS feed-forwardés, panels au risque, forward-looking routé, drift jugé par les autorités de la surface. Le moteur pédagogique (le cœur, à valider en 1er selon PLAN) est **livré et validé bout-en-bout** (diagnostic → composition → jeu → persistance idempotente).
- Action : **prochain = épic #4 Étayages visuels** (à découper en stories, non encore décomposé). Le moteur nu est jouable ; #4 l'habille (visuels d'étayage). Transposer la discipline (surfaces partagées, panels au risque, feed-forward).

---

## Rétro story #89 — Durcissement auth/data (drain de dette épic #2, PR #91) — pont avant épic #4

### 2026-07-03 — [data/drizzle] Un index posé par SQL à la main hors de `schema.ts` = drift snapshot silencieux et NON gardé ; le `.unique()` **de colonne** (pas le callback 3ᵉ-arg) est la voie propre et ne casse PAS le gate 100 % fonctions (PR #91, backend BLOQUANT reproduit)
- Problème : pour l'index UNIQUE Unicode sur `name_key` (#37), le 1er build a **écrit le `CREATE UNIQUE INDEX` à la main** dans la migration SQL et **omis l'index de `schema.ts` + du snapshot drizzle** — par sur-application de LEARNINGS #34/#46 (« éviter le callback extras drizzle qui casse le gate 100 % fonctions »). Résultat : `schema.ts` (pas d'index) == snapshot (pas d'index), tous deux **ignorants** de l'index réel en base → `pnpm db:generate` = no-op **trompeur** (cohérent entre eux, mais désync du SQL réel). Le reviewer backend a **reproduit** concrètement : ajouter `.unique()` sur `name_key` dans `schema.ts` (ce qu'un futur agent ferait « pour corriger » l'absence visible) + `db:generate` → drizzle génère une migration `0006` **recréant un index en doublon**. L'ADR **documentait** le risque mais **aucune garde active** ne le protégeait (un commentaire n'est pas une garde).
- Leçon : (1) **Le piège #34/#46 = le callback d'extras 3ᵉ-arg composite `(t) => [...]`** (fonction non couverte → casse le gate), **PAS** le `.unique("nom")` **chaîné sur la colonne** — ce dernier n'ajoute aucune fonction non couverte, `schema.ts` reste à 100 %. Donc pour un index **mono-colonne**, toujours le déclarer en `.unique()` de colonne et laisser **drizzle-kit régénérer snapshot + SQL** (`db:generate`) → cohérence garantie, zéro SQL à la main. Réserver le contournement SQL-à-la-main aux index composites, et alors **rendre le snapshot honnête** + aligner l'état. (2) Un schéma/migration se valide par `db:generate` **no-op** (schema.ts ↔ snapshot ↔ SQL cohérents), pas seulement par `db:migrate` OK. (3) **Toute garde de cohérence data exige une garde à effet observable** (règle CLAUDE.md) : ici un test qui, après `runMigrations`, asserte l'ensemble des index de `sqlite_master` sur la table == attendu, **mutation-testé** (retrait de l'index → rouge). Un ADR/commentaire ne remplace jamais le test.
- Action : **promotion candidate** (règle dure CLAUDE.md / brief de build data) — « index mono-colonne → `.unique()` de colonne + `db:generate` (jamais de SQL index à la main) ; tout changement schéma se valide par `db:generate` no-op ; index/contrainte critique → test `sqlite_master` mutation-testé ». Corrige la lecture trop large de #34/#46. À feed-forwarder dans tout brief touchant `schema.ts`/migrations (épic #7 espace parent, #82 index idempotence).

### 2026-07-03 — [process] Un bloquant CONFIRMÉ-reproduit par 1 seul reviewer (sur 4 APPROVE) reste bloquant — verify ≠ vote ; full panel sur story sécu/data attrape ce que 3 lentilles ratent (PR #91)
- Observation : story de durcissement (CAS reset PIN #50, GC sessions #44, unicité Unicode #37) = surface **sécu/data** → **panel complet** backend+security+qa+PO. PO/Security/QA ont **APPROVE** d'emblée (QA a même noté l'absence d'index au snapshot mais l'a jugée « dette de tooling documentée, intentionnelle »). **Backend seul** a **reproduit empiriquement** le drift (double `db:generate` → index doublon) → `REQUEST_CHANGES` bloquant. L'orchestrateur **n'a pas mergé au vote 3-contre-1** : un défaut **confirmé et reproduit**, in-contract (STACK « migrations sûres » + règle garde CLAUDE.md), prime sur la majorité. Fix renvoyé au subagent de build (worktree chaud, SendMessage) : option propre (`.unique()` colonne + régénération) + garde testée + minors (ADR `PR #—`→#91, locale `toLocaleLowerCase("fr-FR")`). **Re-review ciblée** du seul bloquant par le reviewer qui l'a levé → backend re-reproduit le `db:generate` no-op et mutation-teste la garde → APPROVE. Merge autonome (4/4 APPROVE, CI verte, à jour).
- Leçon : sur frontière data/sécu, **la valeur du panel complet = la lentille qui creuse et reproduit**, pas le compte d'APPROVE. Un finding **reproduit** (pas seulement plausible) ne se dissout pas dans une majorité d'APPROVE — il se traite. La **re-review ciblée par l'auteur du bloquant** (pas un re-panel complet) suffit quand le fix est chirurgical et objectivement vérifiable (économie quota, §7). Distinguer « QA voit l'anomalie mais la juge intentionnelle » de « backend prouve qu'elle casse un futur `db:generate` » : c'est la **reproduction** qui tranche.
- Action : rappel process — brief de review data doit inviter à **reproduire** (lancer `db:generate`/mutants), pas seulement lire ; un bloquant reproduit = fix avant merge même minoritaire.

### 2026-07-03 — [process/gouvernance] Drain de dette à la clôture d'épic : « finis l'existant avant du neuf » = la story-pont légitime entre deux épics (orchestrate §5)
- Observation : épic #3 clos, épic #4 pas commencé. Au lieu d'ouvrir #4 (du neuf), l'orchestrateur a **drainé la dette sécu/data de l'épic #2** (#50/#44/#37, découvertes en review de #30/#31/#33, jamais drainées à la clôture de #2) en **UNE story de durcissement** `hardening` (§5), passée par la boucle normale. #82 (index idempotence attempts) **laissé dehors** car sa propre triage dit « aujourd'hui non requis, différé » → `pre-deploy`. Toutes les `discovered` restantes triées + milestonées (`playtest-⚙️` : #66/#76/#83 ; `pre-deploy` : #82/#47/#9) → aucune sans destination.
- Leçon : quand un épic se clôt sans avoir drainé sa dette hygiène (ici #2), la **story-pont de durcissement** est le bon usage de « finis l'existant avant d'ouvrir du neuf » — bornée, in-contract, surface backend disjointe de l'épic suivant (visuel #4), frontière propre. Ne pas drainer une issue dont **sa propre triage** dit « différé » (#82) : respecter la classe posée. Milestoner **chaque** discovered (destination explicite) évite l'oubli.
- Action : rappel — à toute clôture d'épic, vérifier que la dette hygiène de l'épic est drainée (sinon story-pont au démarrage du suivant) ; **prochain = décomposer épic #4 Étayages visuels** en stories (ENGINE §étayages, WIREFRAMES, DESIGN_TOKENS) puis boucle.
