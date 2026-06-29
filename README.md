# multiplyz 🧸

Jeu web de maths **ludique** pour aider un enfant (8 ans, CE1→CE2) à combler ses lacunes : compléments à 10, addition, soustraction, tables de multiplication. Jeu **sans fin**, collection de créatures, mascotte **Teddy**. App familiale perso.

## Stack
Next.js (App Router, runtime Node) · React · TypeScript · Tailwind v4 + `tokens.css` · SQLite local (`better-sqlite3`, WAL) + Drizzle · PWA online-first. Hébergement VPS OVH via Laravel Forge. Génération d'assets via Nano Banana (Gemini). Détails : [`STACK.md`](./STACK.md).

## Docs (source de vérité — lire avant de coder)
| Fichier | Sujet |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | règles + index pour les agents |
| [`PLAN.md`](./PLAN.md) | archi, data, ordre de build |
| [`PRODUCT.md`](./PRODUCT.md) | flows, mécanique, écrans |
| [`ENGINE.md`](./ENGINE.md) | moteur pédagogique |
| [`MAP.md`](./MAP.md) · [`ECONOMY.md`](./ECONOMY.md) | carte/niveaux · économie |
| [`ART.md`](./ART.md) · [`WORLDGEN.md`](./WORLDGEN.md) | direction artistique · génération mondes |
| [`COPY.md`](./COPY.md) | ton & microcopy |
| [`AUTH.md`](./AUTH.md) · [`SYNC.md`](./SYNC.md) | auth/sécurité · connectivité |
| [`DESIGN_TOKENS.md`](./DESIGN_TOKENS.md) · `tokens.css` | système visuel |
| [`WIREFRAMES.md`](./WIREFRAMES.md) · `design-system.html` | écrans · styleguide |
| [`DETAILS.md`](./DETAILS.md) | points mineurs |
| [`WORKFLOW.md`](./WORKFLOW.md) | cycle de dev agentique |
| [`LEARNINGS.md`](./LEARNINGS.md) | leçons accumulées |

## Workflow de dev
Epic → Story (GitHub Issues + Project) → dev en worktree → tests + lint + `next-dev-loop` + captures Playwright → PR → review multi-agents → **gate humain** → merge → retro → `LEARNINGS.md`. Voir [`WORKFLOW.md`](./WORKFLOW.md).

## Démarrer en local

Prérequis : **Node 22 LTS** (`.nvmrc`) + **pnpm** (`packageManager` pinné dans `package.json`).

```bash
nvm use                # Node 22
pnpm install
cp .env.example .env    # renseigner GEMINI_API_KEY (requis en production)
pnpm dev               # http://localhost:3000
```

Scripts : `pnpm dev` · `pnpm build` · `pnpm start` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:coverage` · `pnpm test:e2e`.

### Configuration & secrets
- Tous les paramètres ⚙️ et clés proviennent du **module de config** (`src/config/`) — jamais de valeur en dur.
- Variables d'environnement : voir [`.env.example`](./.env.example). `.env` n'est **jamais commité**.
- **Validation au boot (fail-fast)** : si une clé **requise** manque en production, le serveur refuse de démarrer avec un message explicite (`src/instrumentation.ts`).
- En production, les valeurs sont injectées via **Forge env** / **GitHub Secrets** (cf. [`WORKFLOW.md`](./WORKFLOW.md) §15).

### Internationalisation (i18n)
- **FR uniquement** en v1, mais **toutes les chaînes sont centralisées** dans `src/strings/` (zéro texte en dur, voix de Teddy — cf. [`COPY.md`](./COPY.md)). Le lint `react/jsx-no-literals` interdit tout littéral visible dans l'UI.

### Base de données
SQLite local (mode WAL) + Drizzle. Migrations versionnées jouées via `pnpm db:migrate` (script livré avec #12). Chemin du fichier : variable `DATABASE_PATH`.

## Déploiement (VPS OVH via Laravel Forge)
- **Next.js en daemon Node** : `pnpm build` puis `pnpm start` (**runtime Node, pas edge**), lancé comme **process Forge** persistant.
- **Nginx** en reverse proxy devant le daemon (port interne 3000) + **Let's Encrypt** (HTTPS) sur `multiplyz.phikhi.com`.
- **Worker daemon** séparé (jobs de génération IA) — process Forge distinct.
- Variables de prod via **Forge env** ; migrations jouées au déploiement (`pnpm db:migrate`).
- Détails : [`STACK.md`](./STACK.md) §Hébergement.

## Statut
🏗️ Tranche 0 (mise en place). Build pas encore commencé.
