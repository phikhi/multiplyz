# multiplyz — Workflow de développement (agentique)

> Cycle de dev : Epic → Story → dev multi-agents (worktrees) → review multi-agents en boucle → **gate humain** → merge.
> Tout centralisé sur **GitHub** (Issues + Project). Garde-fous **en dur** anti-drift.

---

## 1. Structure GitHub

- **Epics** = issues `label:epic` (ou milestones). Reprennent l'**ordre de build** de [PLAN.md](./PLAN.md) : Scaffold · Auth · Moteur math · Étayages visuels · Couche jeu/carte · Pipeline mondes IA · Espace parent · PWA/responsive.
- **Stories** = issues liées à un epic, avec :
  - description + **critères d'acceptation** testables (format *Given/When/Then*),
  - **scope** via labels (`scope:backend|frontend|security|qa|game-design|product`),
  - **checklist DoD**, dépendances (`blocked-by`), estimation.
- **Project board** : `To do → In progress → In review → Human gate → Done` (automations : PR liée déplace la carte).
- **Templates** : issue *story* + **PR template** (checklist DoD).
- **CODEOWNERS** : route les reviews vers les bons rôles selon le chemin des fichiers.

## 2. Découpage Epic / Story

- Chaque epic → stories en **slices verticales** (cf. skill `brief-to-tasks`).
- Marquer ce qui est **parallélisable** (sans dépendance) vs séquentiel → les agents parallèles ne prennent que des stories indépendantes.

## 3. Rôles d'agents

| Rôle | Agent type | Mission |
|---|---|---|
| **Développeur** | selon scope (frontend-developer / backend-architect / …) | code la story dans un **worktree** isolé |
| Reviewer **Backend** | backend-architect / code-reviewer | logique serveur, data, API, moteur |
| Reviewer **Frontend + A11y** | frontend-developer / ui-visual-validator | UI, tokens, responsive, accessibilité |
| Reviewer **Security** | security-auditor | auth/PIN, données enfant, surface d'attaque |
| Reviewer **QA/Test** | test-automator | couverture, E2E, qualité des tests |
| Reviewer **Game-design** | agent specs | cohérence ludique/pédago vs ENGINE/PRODUCT/MAP |
| **Product Owner** | agent produit | valide **critères d'acceptation** + fidélité produit vs specs |
| **Humain (toi)** | — | **arbitre du drift** + autorité finale ; peut révoquer la délégation. Ne merge plus en routine (cf. [ADR 0003](docs/adr/0003-agent-merge-et-accepte-adr.md)) |
| **Agent orchestrateur** | — | **merge** (reviews scope+PO ✅ + CI verte + branche à jour) + **accepte les ADR dans le contrat** (ADR 0003) |

→ L'agent auteur demande review **aux rôles pertinents selon le scope** + **PO** systématique.

## 4. Cycle d'une story

1. Pick story → `In progress`, assignée à l'agent dev.
2. Branche + **git worktree** isolé (parallélisme sans conflit).
3. Code + **tests** (unit/feature/integration/E2E selon scope) + **lint**.
4. **Captures Playwright** systématiques (toute story à impact UI).
5. **Hooks locaux** (pre-PR) : lint + tests + coverage + build → doivent passer.
6. **Ouvre une PR** : template DoD rempli, lien issue, **captures**, résumé clair.
7. Demande review (rôles du scope + PO).

## 5. Definition of Done (gate dur)

- ✅ **Lint** pass.
- ✅ **Tests** pass + **couverture** : **100 % logique critique** (moteur pédago / économie / backend) ; **pragmatique UI** (parcours **E2E** couverts). Seuils vérifiés en **CI**.
- ✅ **Type-check + build** OK.
- ✅ PR **documentée** + **captures Playwright**.
- ✅ **Vérif runtime** : skill **`next-dev-loop`** passé (comportement réel sur `next dev`) — toute story à impact runtime/UI.
- ✅ **Critères d'acceptation** satisfaits (validés par le **PO**).
- ✅ **Reviews** des agents du scope : approuvées.

## 6. Boucle de review

```
PR ouverte → reviewers (scope + PO) commentent en inline
   ├─ changes requested → l'agent auteur corrige, re-push, re-demande review
   └─ boucle TANT QUE le DoD n'est pas atteint
→ toutes reviews ✅ + checks CI ✅ → **l'agent orchestrateur merge** (squash + delete-branch), rebase la PR suivante, **rapporte** au proprio
→ escalade au proprio **uniquement si drift** (cf. [ADR 0003](docs/adr/0003-agent-merge-et-accepte-adr.md)) ou itérations > 5
```
- **Anti-boucle infinie** : limite d'itérations (ex. **5**) → au-delà, **escalade à toi**.
- Les reviewers commentent **sur la PR** (inline) ; l'auteur **résout** chaque commentaire.

## 7. Gates & Hooks « en dur » (anti-drift)

- **GitHub Actions (required checks)** : `lint · typecheck · test+coverage(seuils) · build · e2e(Playwright)`. PR **non mergeable** si rouge.
- **Branch protection** sur `main` : checks verts **+ review humaine (toi) obligatoire** + branche à jour + **pas de push direct**.
- **CODEOWNERS** : review obligatoire des bons rôles par chemin.
- **Hooks Claude Code** (`settings.json`) : pre-PR local (lint/test/coverage) + **scope-guard** (l'agent ne touche que les fichiers de sa story).
- **Critères d'acceptation testables** dans l'issue : la story n'est *Done* que s'ils passent.
- **PR template** = checklist DoD obligatoire.

## 8. Anti-drift (principe)

- Story = **scope borné** + critères d'acceptation + fichiers attendus.
- Agent dev **interdit de sortir du périmètre** (hook scope-guard + review PO).
- **Les specs sont le contrat** : tout écart vs PLAN/ENGINE/PRODUCT/MAP/ECONOMY/ART/AUTH/SYNC = **rejeté en review**.
- Le **PO** garde la fidélité produit ; **toi = autorité finale**.

## 9. Outils

- Découpage : skill `brief-to-tasks`.
- Orchestration : outil **Agent** (`isolation: worktree`) + outil **Workflow** (fan-out + boucle review).
- CI : **GitHub Actions**. Issues/PR : **gh CLI**. Captures : **Playwright**.
- Tests : **Vitest** (unit/intégration) + **Playwright** (E2E) + **coverage Vitest**.

## 10. Mise en place (tranche 0, prérequis)

- `git init` + repo GitHub + remote.
- Project board + labels + **issue/PR templates** + **CODEOWNERS**.
- **GitHub Actions** (lint/typecheck/test+coverage/build/e2e) + **branch protection** (checks + ta review).
- **Hooks** `settings.json` (pre-PR + scope-guard).
- Seuils de couverture (100 % critique / pragmatique UI) configurés dans l'outil de test.
- **`docs/adr/`** + **`docs/design/`** + templates (ADR, Technical Design) + **`LEARNINGS.md`** initial.

## 11. Definition of Ready (DoR)

Une story n'est **prenable** par un agent que si :
- **critères d'acceptation** (Given/When/Then) clairs et **testables**,
- **scope + labels** posés, **specs/tokens** référencés,
- **dépendances résolues** (aucun `blocked-by` ouvert),
- estimation faite.
→ Sinon elle reste en **backlog** (non pickable).

## 12. Tâches découvertes en cours de story

- **Drift interdit** : l'agent **ne traite pas** hors de son scope.
- Découverte → **issue `discovered`** liée (contexte, scope présumé), `needs-triage`.
- **Bloquant** (story infinissable sans) → escalade : **split** ou nouvelle story bloquante ; la story courante passe `blocked`.
- **Non-bloquant** → **backlog** ; l'agent continue.
- **Triage** par **PO / toi** (priorisation + DoR).

## 13. Auto-apprentissage (rétro)

- **Fin de story** : mini-rétro (agent) → leçons (ce qui a cassé, boucles de review répétées, pièges stack) → **`LEARNINGS.md`** (daté, scope, lien PR).
- **Fin d'epic** : rétro de synthèse (tendances).
- **Promotion** : une leçon **récurrente** devient **règle dure** → `CLAUDE.md`, règle **lint/typecheck**, ou **hook** `settings.json`. (Non promue = rappel ; promue = appliquée automatiquement.)
- **Lecture obligatoire** : tout agent lit **`LEARNINGS.md`** (+ `CLAUDE.md` + specs du scope) **avant** de démarrer.

## 14. Conventions, WIP & intégration

- **Branches** : `story/<id>-slug`, `epic/<id>-slug`, `fix/<id>-slug`.
- **Commits** : Conventional Commits (`feat:`, `fix:`, `test:`…). Titre PR : `[#id] <type>: <résumé>`.
- **WIP limit** : max ~3-4 stories en parallèle ⚙️ (limite conflits + coût).
- **Petites stories** + **rebase sur `main`** avant PR/merge ; branche **à jour** (gate). Intégration fréquente.

## 15. Migrations, secrets & validation E2E

- **Migrations Drizzle** : versionnées, dans la PR, jouées en **CI** (DB de test) + au deploy ; **pas de migration destructive sans backup** du fichier SQLite ; revue par le reviewer Backend.
- **Secrets/env** : `.env` jamais commité ; **GitHub Secrets** (CI) + **Forge env** (prod). Clés : modèle image, chemin DB…
- **Validation E2E** : **pas de staging** → **E2E Playwright en CI** + **captures systématiques** dans la PR ; ton **gate humain** se fait sur la **PR + captures**. (Staging ajoutable plus tard.)

## 16. Garde-fous des agents (permissions & budget)

- Les agents **dev** ne peuvent pas : merger leur propre PR, **force-push `main`**, modifier la branch protection, lire/écrire les secrets, sortir de leur **worktree/scope**.
- **Merge = agent orchestrateur** dès reviews scope+PO ✅ + CI verte + branche à jour (cf. [ADR 0003](docs/adr/0003-agent-merge-et-accepte-adr.md)). **Jamais** force-push `main` / secrets / branch-protection. **Drift → proprio**. Le proprio peut reprendre la main / révoquer.
- **Budget tokens** par story/epic ⚙️ → éviter l'emballement de la flotte ; escalade si dépassé.

## 17. Custom agents & skills à créer (tranche 0)

**Agents** (`.claude/agents/`) :
- **`product-owner`** — valide critères d'acceptation + fidélité produit vs PRODUCT/ENGINE/MAP/ECONOMY.
- **`game-design`** — cohérence ludique/pédago vs specs.
- **Reviewers spec-aware** — wrappers (backend / frontend+a11y / security / qa) **instruits de lire les specs** du repo avant de juger.

**Skills / commandes** (`.claude/skills/`) :
- **`story-start`** — branche + worktree + template ; charge specs + `LEARNINGS.md`.
- **`open-pr`** — ouvre la PR (template DoD, lien issue, **captures Playwright**) + demande les reviews scope+PO.
- **`retro`** — extrait les leçons → `LEARNINGS.md` (+ propose promotions).
- **`discovered-issue`** — crée une issue `discovered` liée + triage initial.
- **`adr`** — crée/met à jour un ADR (`docs/adr/`) depuis le template ; relie à l'issue/PR + spec impactée.

## 18. Décisions, ADR & Technical Design

- **ADR** (`docs/adr/NNNN-titre.md`) : tout choix d'archi. Format court — **Contexte · Décision · Alternatives · Conséquences · Statut · Type · Liens**. Statuts : `proposed / accepted / superseded / rejected`. Type : `arch | data | deps | security | pedago | product`.
- **Technical Design / RFC** (`docs/design/<id>.md`) : pour les epics/stories **`needs-design`** (complexes) — approche, alternatives, impacts, plan de test. **Avant** de coder. Revu par **architect-review** + reviewers du scope + **PO**.
- **ADR obligatoire (gate)** si la décision : modifie une **spec contrat** (PLAN/ENGINE/STACK/AUTH/SYNC/MAP/ECONOMY/ART), le **modèle de données**, ajoute une **dépendance**, ou est **transverse**. Sinon non requis.
- **Dans le contrat vs drift** (cf. [ADR 0003](docs/adr/0003-agent-merge-et-accepte-adr.md)) :
  - **Dans le contrat** (HOW dans le WHAT établi — archi / data / dépendance / refacto / config) → l'agent orchestrateur **accepte** en autonomie (mineurs **et** majeurs) + met à jour la spec.
  - **Drift** (touche/contredit décisions verrouillées PLAN / pédagogie ENGINE / éco / sécurité / scope) → reste `proposed` jusqu'au **sign-off propriétaire**.
- **La review SIGNALE, l'ADR DÉCIDE** : un reviewer qui détecte un sujet d'archi **n'arbitre pas dans la PR** → ouvre un ADR / issue `needs-design` (hors PR). La PR est **bloquée/splittée** si elle sort du design validé.
- **Retro → décisions** : douleur récurrente / dette → propose un **ADR** ou un **epic de refacto**.
- **Sync specs** : un ADR **accepté** → **met à jour la spec contrat** concernée + lien vers l'ADR. Les specs restent **canoniques** ; l'ADR garde le **pourquoi/historique** (`superseded` chaîne les décisions).
- **Qui** : `architect-review` rédige/instruit ADR & designs ; `product-owner` pour le type produit ; `game-design` pour la pédagogie ; l'**agent orchestrateur accepte dans le contrat** ; **toi = sign-off drift uniquement** (ADR 0003).

## 19. Skills (playbooks) des agents

Les agents utilisent les **skills installés comme playbooks canoniques** (ne pas improviser). Projet **web Next.js** → skills **Next** pertinents ; **`expo:*`** (natif) et **`stripe:*`** (paiement) **exclus**.

| Tâche / rôle | Skills |
|---|---|
| **Vérif runtime (DoD)** | **`next-dev-loop`** (obligatoire avant PR) · `verify` · `run` |
| Code UI / nouveaux composants | `frontend-design` · `design-tokens` (réf.) |
| Découpage stories | `brief-to-tasks` |
| Perf (story dédiée) | `next-cache-components-adoption` · `next-cache-components-optimizer` |
| Review code | `code-review` · `simplify` |
| Review design / UI / a11y | `design-review` |
| Review sécurité | `security-review` |
| Commits | `caveman-commit` (Conventional Commits) — optionnel |
| ADR | skill `adr` (custom, tranche 0) |

> **Exclus** : `expo:*` (app native — on est web/PWA), `stripe:*` (pas de paiement).

## Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Suivi | **GitHub Issues + Project board** |
| Découpage | Epic → Story (slices verticales) |
| Exécution | Agents autonomes en **worktrees**, parallèle |
| Couverture | **100 % logique critique** + pragmatique UI |
| Orchestration | **Claude Code natif** (Agent + Workflow + hooks) + GitHub Actions |
| Reviewers | Backend · Frontend+A11y · Security · QA/Test · Game-design · **Product Owner** |
| Merge | **Agent orchestrateur** après reviews scope+PO ✅ + checks verts + branche à jour ; proprio = drift/révocation (ADR 0003) |
| Anti-drift | Critères d'acceptation + required checks + scope-guard + PO |
| DoR | Story prenable seulement si critères/scope/deps/estim. OK |
| Auto-apprentissage | **`LEARNINGS.md`** versionné + **promotion** en règles dures |
| Découvertes | Auto-issue `discovered` + triage (bloquant→split, sinon backlog) |
| Validation E2E | **Pas de staging** : E2E CI + captures Playwright dans la PR |
| Conventions | Branches `story/<id>-…`, Conventional Commits, WIP ~3-4, rebase |
| Garde-fous agents | Pas de merge/force-push/secrets ; budget tokens ; scope/worktree |
| À créer | Agents `product-owner`, `game-design`, reviewers spec-aware ; skills `story-start`/`open-pr`/`retro`/`discovered-issue`/`adr` |
| Décisions | **ADR** (`docs/adr/`) + **Technical Design** (`docs/design/`) pour `needs-design` |
| ADR obligatoire | si contrat (specs)/data/deps/transverse |
| Review vs décision | review **signale**, **ADR décide** (hors PR) |
| Autorité ADR | agent accepte **dans le contrat** (mineurs+majeurs) ; **proprio = drift** ; ADR accepté → spec mise à jour (ADR 0003) |
| Playbooks | Skills **Next** (`next-dev-loop`, `next-cache-components-*`) ; `expo:*`/`stripe:*` **exclus** |
| Vérif runtime | **`next-dev-loop` obligatoire** avant PR |
| Cache Components | **différé** à une story perf dédiée |
