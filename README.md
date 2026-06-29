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

## Statut
🏗️ Tranche 0 (mise en place). Build pas encore commencé.
