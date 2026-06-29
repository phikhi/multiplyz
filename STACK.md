# multiplyz — Stack technique

> Synthèse transverse. Détails dans les specs dédiées (PLAN, SYNC, AUTH, WORLDGEN, ENGINE…).

## Frontend
- **Next.js** (App Router) + **React** + **TypeScript**
  - Version courante : **16.3.0-preview.5** (pinned preview — cf. [ADR 0004](./docs/adr/0004-next-16-3-preview.md)). À migrer vers 16.3.0 stable dès parution npm.
- **Tailwind CSS v4** (`@theme`) branché sur **`tokens.css`** (variables CSS, light/dark)
- Polices **Baloo 2** + **Nunito** via `next/font/google`
- État client : **Zustand**
- **PWA** : `next-pwa` (ou SW custom) — installable, précache la coquille ; **online-first**

## Backend / API
- **Next.js route handlers / server actions** en **runtime Node** *(pas edge/serverless — requis pour SQLite local)*
- **Serveur = source de vérité** ; logique pédago + éco côté serveur ; écritures **idempotentes**

## Base de données
- **SQLite — fichier local sur le VPS**, **mode WAL**
- **Drizzle ORM** + **better-sqlite3** (migrations versionnées)
- **Config** : les ⚙️ DB (`busy_timeout`, chemin) viennent du **module config central** (`src/config/server-config.ts`), pas de constantes dans la couche DB — cf. [ADR 0002](./docs/adr/0002-config-centrale-possede-params-db.md)
- **Backups** = copie du fichier (+ snapshot VPS)
- *Pourquoi pas Turso/MySQL* : VPS persistant + 1 famille (faible charge) → SQLite local = simple, rapide, gratuit, suffisant. (Online-first → pas besoin de la sync de Turso.)
- Tables : `profiles · mastery · attempts · progress · collection · worlds · characters · wallet · cosmetics(+owned) · inventory_items · daily · ledger · jobs`

## Auth / sécurité
- **Single-tenant famille** : nom + **PIN enfant** + **PIN parent** (zéro email/code famille)
- PIN **hashé** (argon2id/bcrypt) ; sessions cookie **httpOnly/Secure** ; **rate-limit + backoff** ; code de secours parent *(cf. AUTH.md)*

## Pipeline IA (génération de mondes)
- Modèle image : **Nano Banana (Gemini 2.5 Flash Image)** — img2img + **consistance de personnage** (idéal Teddy) + fusion multi-références. Candidat principal, **à confirmer par spike** ⚙️. Clé **API Gemini** requise.
- **Teddy en 2 stages** : (A) 1× photos → **master kawaii validé** (model sheet : neutre + content/oups/acclame/intrépide) ; (B) par monde → ancrer sur le **master** (jamais les photos). Master = aussi les **sprites de réaction** en jeu.
- Génération en **tâche de fond** : **worker daemon** (géré par Forge) consommant une **file de jobs** (table `jobs` SQLite ; **BullMQ + Redis** en option si le volume monte)
- **Assets → disque local du VPS**, servis par **Nginx** (dossier `public/`/storage) ; métadonnées + **prompt + seed** en SQLite
- Buffer 2 mondes, auto-filtre kid-safe + validation parent optionnelle, fallback pré-généré *(cf. WORLDGEN.md)*

## Hébergement / déploiement
- **VPS OVH** provisionné/déployé via **Laravel Forge**
- Domaine : **`multiplyz.phikhi.com`** (sous-domaine → VPS)
- **Next.js** lancé comme **daemon Node** (`next start`) derrière **Nginx** (reverse proxy) + **Let's Encrypt** (HTTPS)
- **Worker daemon** séparé pour les jobs de génération IA
- **Redis** optionnel (file de jobs / cache) — provisionnable par Forge

## Connectivité
- **Online-first** : réseau requis pour jouer ; coquille PWA en cache + message doux si coupure *(cf. SYNC.md)*

## Tests
- **Vitest** (unit/intégration, TS natif) + **Playwright** (E2E + captures) + **coverage** Vitest.
- **next-dev-loop** pour la vérif runtime (DoD).

## Divers
- Audio : **bruitages + musique** (pas de TTS en v1)
- i18n : **FR**, strings **centralisées**
- Node : **22 LTS** (`.nvmrc` + `engines`)

## Points à valider au build
- **Nano Banana** : spike kawaii flat-vector + img2img Teddy (qualité / coût / latence / sur-censure)
- **File de jobs** : table SQLite simple ↔ BullMQ+Redis (selon volume réel)
- Réglage **WAL + busy_timeout** SQLite (concurrence daemon web + worker)
