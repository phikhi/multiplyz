# CLAUDE.md — multiplyz

## Projet
Jeu web de maths **ludique** pour aider une fille de **8 ans (CE1→CE2)** à combler ses lacunes : **compléments à 10, addition, soustraction, multiplication**. Jeu **sans fin**, collection de créatures, mascotte **Teddy** (son doudou Steiff). **App familiale perso** (pas un produit public).

## État
**Greenfield : specs complètes, code pas encore scaffoldé.** → **Lire la spec concernée avant d'implémenter une feature.**

## Stack (détail : `STACK.md`)
Next.js (App Router, **runtime Node**, pas edge) + React + TS + **Tailwind v4** + `tokens.css`. **SQLite local** (`better-sqlite3`, WAL) + **Drizzle**. Zustand. **PWA online-first**. Hébergement **VPS OVH via Laravel Forge** (daemon Node `next start` + Nginx + Let's Encrypt). Génération d'assets IA via **worker daemon**.

## Index des specs (lire la bonne avant de coder)
| Fichier | Sujet |
|---|---|
| `PLAN.md` | archi, modèle de données, ordre de build |
| `PRODUCT.md` | flows, mécanique, écrans |
| `ENGINE.md` | **moteur pédagogique** (la logique cœur) |
| `MAP.md` | carte & niveaux |
| `ECONOMY.md` | pièces/œufs/éclats + schéma data éco |
| `ART.md` · `WORLDGEN.md` | direction artistique · pipeline génération mondes |
| `COPY.md` | ton & microcopy (voix de Teddy) |
| `AUTH.md` · `SYNC.md` | auth/sécurité · connectivité online-first |
| `DESIGN_TOKENS.md` · `tokens.css` | système visuel |
| `WIREFRAMES.md` · `design-system.html` | écrans lo-fi · styleguide vivant |
| `DETAILS.md` | points mineurs (réglages, états, i18n, playtest) |
| `WORKFLOW.md` · `STACK.md` | cycle de dev agentique · stack technique |
| `LEARNINGS.md` | leçons accumulées (auto-apprentissage) — **lire avant de coder** (créé en tranche 0) |

## Règles non négociables (en codant)
- **Tokens** : jamais de valeur en dur (couleur/espacement/typo/rayon) → `var(--…)` ou alias Tailwind. Source = `tokens.css`.
- **Copy** : français, **tutoiement**, posture croissance (« pas encore », jamais « faux »), voix de Teddy. **Strings centralisées** (zéro texte en dur).
- **Pédagogie** : **no-fail**, temps mesuré en silence, maîtrise = **juste + rapide**. La logique maîtrise/sélection vit **côté serveur** → suivre `ENGINE.md`, ne pas réinventer.
- **Serveur/données** : serveur = **source de vérité**, **online-first**, **runtime Node**, écritures **idempotentes**, progression **monotone**. SQLite **WAL**.
- **Économie** : jamais d'argent réel, **ne bloque jamais l'apprentissage**, doublon → éclats, dépenses **online only**.
- **Sécurité** : PIN **hashé** (argon2/bcrypt), **rate-limit**, single-tenant famille. Jamais de PIN en clair / côté client.
- **Assets IA** : prompt de base **verrouillé** (ART), un monde ne pose que `--world-accent`, **Teddy depuis photos réelles**, QA kid-safe + fallback.
- **A11y** : feedback **doublé d'icône** (daltonisme), cibles ≥ 44 px, `prefers-reduced-motion`.
- **Paramètres `⚙️`** (notés dans les specs) = à **calibrer**, centralisés dans un fichier de config, jamais figés en dur sans raison.

## Workflow de dev (OBLIGATOIRE — cf. `WORKFLOW.md`)
- **Epic → Story** sur **GitHub** (Issues + Project). Chaque story = **critères d'acceptation** + DoD.
- Dev en **git worktree** isolé. **Toute tâche se termine par une PR** documentée + **captures Playwright**.
- **DoD** : lint + tests (**100 % logique critique**, pragmatique UI) + type-check/build + critères d'acceptation + **reviews agents approuvées** (Backend · Frontend+A11y · Security · QA/Test · Game-design · **Product Owner**).
- **Boucle de review** jusqu'au DoD, puis **gate humain (le proprio) avant merge**.
- **Gates en dur, ne jamais contourner** : GitHub Actions required checks + branch protection + CODEOWNERS + hooks `settings.json` (pre-PR + scope-guard).
- **Anti-drift** : les specs sont le **contrat** ; tout écart = rejeté en review. Rester dans le scope de la story.
- **Avant de coder** : lire **`LEARNINGS.md`** (leçons accumulées) + les specs du scope. **Découverte hors scope** → issue `discovered` (jamais absorbée). **Fin de story** → rétro → `LEARNINGS.md`.
- **Décisions d'archi** : si ça touche une **spec contrat / data / dépendance / transverse** → **ADR** (`docs/adr/`) + design doc si `needs-design`. La review **signale**, l'**ADR décide** (hors PR). Mineur = architecte autonome ; **majeur = ton sign-off**. ADR accepté → **la spec est mise à jour** (canonique).
- **Skills = playbooks** (ne pas improviser) : **`next-dev-loop` obligatoire avant PR** (vérif runtime) ; `next-cache-components-*` pour la perf (différé) ; `frontend-design`/`design-tokens` pour l'UI ; `code-review`/`design-review`/`security-review` en review ; `brief-to-tasks` pour le découpage. **Exclure `expo:*` (natif) et `stripe:*` (pas de paiement).**

## Ordre de build (cf. `PLAN.md`)
1. scaffold → 2. auth-lite → 3. **moteur math** (cœur, valider en 1er) → 4. étayages visuels → 5. couche jeu/carte → 6. pipeline mondes IA → 7. espace parent → 8. PWA/responsive.

## Build / run
- **À compléter après le scaffold.** Prévu : `pnpm dev`, `pnpm build`, migrations Drizzle, worker daemon (jobs de génération).
- Déploiement : Forge sur VPS OVH (daemon Node + Nginx + HTTPS) + worker daemon séparé.

## Rappels
- Mascotte = **Teddy** (Steiff 80s) — **photos à fournir** pour la génération.
- Pas de **TTS** ni de **notifications** en v1.
- **Playtest avec l'enfant = le vrai juge** (rétention + progrès sur ses lacunes) → calibrer les `⚙️`.
