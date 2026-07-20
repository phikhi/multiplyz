# Parcours d'acceptation bout-en-bout — R0 (baseline)

> Premier playthrough exécuté sous le gate WORKFLOW §21.c (institué par R0.2, #322). Documente
> honnêtement l'état ACTUEL du jeu (post-R0.1/R0.3, avant R1-R4) sur le **vrai art socle**. Sert de
> point zéro pour les playthroughs R1-R5 (chacun documentera le delta vs celui-ci).

## Métadonnées

| Champ | Valeur |
|---|---|
| Épic / feature | R0 — Vérité visuelle + Conformité bout-en-bout (#316), story R0.4 (#325) |
| Date | 2026-07-20 |
| Base testée | `main` `7d1b3bb4af4ff49a66d69c9992eaf355efa7441f` (post R0.1 #328, R0.2 #322, R0.3 #331) |
| Environnement | `pnpm dev` réel (Next.js 16.2.9 Turbopack, `localhost:3000`) + `agent-browser 0.32.3` piloté en Chrome réel |
| Profil enfant utilisé | **Léa** — créé de A à Z via l'onboarding réel (foyer vide → nom + avatar → PIN enfant `3434` → PIN parent `9191` → code de secours) |
| Pilote | agent de build (subagent isolé, story R0.4) |

## Méthode suivie

1. Lu avant de jouer : `WORKFLOW.md §21`, `docs/AUDIT-2026-07-20-reconstruction.md` (§2 défauts,
   §5 plan R0-R5), `PRODUCT.md §1` (flows), `LEARNINGS.md` (R0.1 : le double-seed `pnpm dev`, la
   fixture réelle "Forêt enchantée" désormais servie en dev ; R0.3 : re-baseline des captures ;
   incident branche supprimée #331).
2. `pnpm install` (worktree neuf) puis `pnpm dev` — migration + seed du monde socle 0 = **vrai art
   "Forêt enchantée"** (confirmé dans le log serveur : `seed-dev-world-assets] … slot 0 → "Forêt
   enchantée" fixture réelle`). Aucun fixture rayé E2E utilisé.
3. Onboarding réel via `agent-browser` (clics/saisies dans un vrai Chrome, pas de seed direct en
   base pour le profil) : nom, avatar, PIN enfant, PIN parent, code de secours.
4. Diagnostic (18 questions, PRODUCT §1.1.4) joué intégralement en résolvant chaque équation
   affichée à l'écran (script `solve.js` parse `"4 + ? = 10"` → répond `6`, gère `+ − × ÷` et le
   caractère moins typographique `−`).
5. Niveaux normaux enchaînés jusqu'au **boss** (nœud 8/11, "Trésor" = boss légendaire du monde 1),
   en répondant correctement à chaque question (QCM et saisie libre au pavé numérique selon le
   format lié à la maîtrise, PRODUCT §3.2).
6. Navigation manuelle vers `/carte` et `/collection` (routes existantes mais **jamais atteintes
   par le flux normal**, cf. checklist) pour documenter honnêtement ce qu'elles montrent quand on
   les force.
7. Vérification croisée en base (`sqlite3 data/multiplyz.sqlite`) pour les faits non visibles à
   l'écran (`art_ref` de la créature, contenu du `wallet`, absence de tables de dépense).

Attempts enregistrés en base sur cette session : **58** (`SELECT COUNT(*) FROM attempts`).

## Flow suivi

| # | Étape attendue (spec) | Ce qui s'est réellement passé | Capture |
|---|---|---|---|
| 1 | Login (choix profil + PIN) | Onboarding réel (foyer vide) : nom+avatar → PIN enfant → PIN parent → code de secours → « Ton aventure est prête ! » → retour à `/` qui sert alors le **sélecteur de profil** (« Qui joue aujourd'hui ? ») avec un **overlay d'installation PWA** superposé → sélection profil → PIN enfant → connexion. | `01, 02, 03` |
| 2 | Atterrissage post-login | **`/jouer` DIRECT** — jamais `/carte`. Confirme littéralement le défaut A de l'audit (`ProfileSelector.tsx:213` `router.push("/jouer")`), observé en LIVE (URL lue après connexion), pas seulement en lecture de code. | `04` |
| 3 | Carte (hub) | **Jamais atteinte par le flux normal.** Accessible seulement en tapant l'URL `/carte` à la main. Quand on le fait : vrai art "Forêt enchantée" (R0.1), 11 nœuds, avatar Teddy per-monde sur le nœud courant (`CurrentNodeTeddy`), progression réelle reflétée. | `09` |
| 4 | Entrée dans un niveau | Diagnostic (18 Q, QCM 4 choix) chaîne **directement** dans un vrai niveau (mix QCM / saisie libre au pavé numérique) sans jamais passer par la carte. Le cœur pédagogique **fonctionne** : questions variées (`+ − ×`), no-fail (« Je ne sais pas » toujours disponible), progression `Question N sur M`. | `04, 05, 07` |
| 5 | Feedback (bonne/mauvaise réponse) | Écran plein dédié après chaque réponse (« Bravo ! », « Dans le mille ! ») — **aucun score chiffré montré** (fidèle à PRODUCT §1.1.4). Aucune illustration, aucun Teddy. | `06` |
| 6 | Résultats (étoiles/pièces) | « Niveau bouclé ! 🎉 » + étoiles Unicode (★★★) + pièces gagnées (`Tu gagnes N pièces 🪙`) + phrase encourageante. Carte blanche, 0 décor, 0 Teddy. Sur le niveau boss : `Créature légendaire gagnée : Braisille 🌟` apparaît **dans ce même écran nu**, sans mise en scène. | `08` |
| 7 | « Continuer » après résultats | **Reboucle systématiquement sur un nouveau niveau, toujours dans `/jouer`.** Vérifié en LIVE sur ~8 cycles résultats→continuer : l'URL ne change JAMAIS (`http://localhost:3000/jouer` à chaque fois). Confirme littéralement le défaut B (`PlayScreen.tsx:278-280`, `handleResultsContinue` → `retryLoadLevel()`, jamais de navigation carte). | logs `boss.log`/`level.log` (URLs) |
| 8 | Retour carte | **Jamais atteint par un bouton produit.** Seule sortie : taper `/carte` à la main ou `/collection` → lien « Retour à la carte ». | `09` |
| 9 | Collection | Vide avant le boss (`10`). Après le boss : 1 créature légendaire « Braisille », rendue en médaillon **placeholder 🐾** générique (pas d'art). Confirmé en base : `characters.art_ref = 'placeholder://legendary/0'`. | `10, 11` |

## Checklist nommée (WORKFLOW §21.c)

- [ ] **Carte réellement atteinte par le flux normal** — **NON.** Login → `/jouer` direct (défaut
      A). « Continuer » après résultats → reboucle `/jouer`, jamais la carte (défaut B). La carte
      n'est atteignable qu'en tapant l'URL à la main. *(Preuve : étapes 2, 3, 7 du flow ci-dessus ;
      captures 04, 09 ; observation live des URLs sur ~8 cycles.)*
- [ ] **Teddy visible dans la boucle de jeu** — **NON.** Zéro occurrence visuelle de Teddy dans
      `/jouer` (diagnostic, questions, feedback, résultats — captures 04-08), y compris sur l'écran
      qui annonce la créature légendaire gagnée. Le seul Teddy visuel du parcours est l'avatar
      per-monde sur le nœud courant de `/carte` (`CurrentNodeTeddy`, capture 09) — **invisible en
      usage normal** puisque la carte n'est jamais atteinte (voir point précédent). Les ~80
      occurrences du mot « Teddy » dans le code sont la **voix** de Teddy (COPY), pas un
      personnage affiché pendant le jeu.
- [ ] **Art créature RÉEL affiché en collection** — **NON.** Créature légendaire « Braisille »
      obtenue au boss (capture 11) rendue en médaillon 🐾 placeholder générique — confirmé en base
      (`characters.art_ref = 'placeholder://legendary/0'`), pas un fixture de test, un vrai
      placeholder de production.
- [ ] **Boucle économique pièces→dépense bouclée** — **NON.** Portefeuille de fin de session :
      **495 pièces** (`wallet.coins`, profil Léa), 0 éclat. Aucune table `cosmetics` /
      `inventory_items` / `daily` en base (vérifié `sqlite3 .tables`). Aucun écran, bouton ou
      mention d'un usage des pièces sur les 11 écrans traversés. Les pièces s'accumulent sans but.
- [ ] **Habillage / charte visuelle présent** — **PARTIEL.** `/carte` porte le vrai art (fond de
      monde kawaii réel, Teddy per-monde) — capture 09, hérité de R0.1. **Mais** tous les écrans du
      flux normal réellement vécu (`/jouer` : diagnostic, questions, feedback, résultats) sont des
      cartes blanches nues sur fond lavande clair, étoiles Unicode (★), emoji bruts (🎉🪙🌟), **0
      illustration, 0 lien avec le monde en cours** — captures 04-08. L'icône d'app
      (`public/icon-192.png`) est un carré violet uni, sans Teddy.

**Aucun point de la checklist n'est pleinement acquis** — attendu et honnête pour un baseline R0 :
c'est exactement l'état que R1 (nav/shell), R2 (Teddy+art créatures) et R4 (économie) doivent
combler. Voir « Verdict » ci-dessous pour la distinction entre l'objectif de **R0** et cette
checklist produit à long terme.

## Captures analysées

| Capture | Ce qu'elle montre | Appuie quel point |
|---|---|---|
| `captures/r0-baseline/01-onboarding-creation-profil.png` | Écran de création de profil (foyer vide). Avatars = emoji d'animaux (renard/lapin/panda/…), 0 Teddy visuel — seul le titre mentionne « Teddy 🧸 » en texte. | Habillage (partiel — même l'onboarding est scaffold-nu) |
| `captures/r0-baseline/02-aventure-prete.png` | « Ton aventure est prête ! 🎉 » fin d'onboarding, toujours sur `/`. | Flow #1 |
| `captures/r0-baseline/03-selecteur-profil.png` | Sélecteur de profil au retour sur `/`, overlay d'installation PWA superposé. | Flow #1 |
| `captures/r0-baseline/04-jouer-landing-diagnostic-intro.png` | Atterrissage post-login sur `/jouer` (pas `/carte`) : intro diagnostic. | Carte non atteinte (défaut A) |
| `captures/r0-baseline/05-diagnostic-question1.png` | Première question du diagnostic (« 4 + ? = 10 »), QCM 4 choix, carte blanche nue. | Cœur pédagogique fonctionnel + habillage nu |
| `captures/r0-baseline/06-diagnostic-feedback-bravo.png` | Feedback plein écran « Bravo ! », no-fail, aucun score, aucune illustration. | Teddy absent, habillage nu |
| `captures/r0-baseline/07-niveau-normal-input-libre.png` | Niveau normal post-diagnostic, format de saisie libre (pavé numérique), toujours `/jouer`. | Cœur pédagogique (formats variés) |
| `captures/r0-baseline/08-resultats-niveau-boucle.png` | Résultats « Niveau bouclé ! » — 3 étoiles Unicode, pièces gagnées, carte blanche nue. | Teddy absent, habillage nu, boucle pièces (gain sans dépense) |
| `captures/r0-baseline/09-carte-monde-directe.png` | `/carte` en accès direct (URL tapée à la main) : **vrai art** « Forêt enchantée », 11 nœuds, avatar Teddy per-monde sur le nœud courant. | Carte non atteinte par le flux normal (mais art réel confirmé quand on la force) + Teddy présent seulement ici |
| `captures/r0-baseline/10-collection-vide.png` | `/collection` avant le boss : vide, en-tête « Ma collection 🐾 ». | — |
| `captures/r0-baseline/11-collection-braisille-placeholder.png` | `/collection` après le boss : « Braisille — créature légendaire » en médaillon 🐾 placeholder. | Art créature placeholder (défaut D) |

## Verdict baseline / delta

**Objectif spécifique de l'épic R0** (AUDIT §5-R0, WORKFLOW §21) : *« vrai art visible en dev/CI +
captures honnêtes + workflow corrigé »* — **ATTEINT (OUI)** :

- Le **vrai art** est réellement servi et visible en dev (capture 09 : monde "Forêt enchantée" +
  avatar Teddy per-monde réels, pas la fixture rayée de test) — livré par R0.1 (#328) et
  re-confirmé ici en pilotant l'app pour de vrai, pas en relisant le code.
- Les **captures de cette PR sont honnêtes** : elles montrent aussi bien le vrai art (09) que les
  écrans nus non habillés (04-08) et les placeholders (11) — aucune embellie.
- Le **workflow est corrigé et opérationnel** : ce document EST le premier artefact du gate
  WORKFLOW §21.c en action — le gabarit (`TEMPLATE.md`) est réutilisable, et cette exécution prouve
  qu'un agent peut piloter l'app réellement (pas lire le code) et produire un verdict vérifiable.

**Sur la checklist produit long-terme** (carte atteinte / Teddy dans le jeu / art créatures / éco
dépense / habillage) : **NON acquis**, et c'est **honnête et attendu** à ce stade — R0 ne touchait
pas ces défauts (scope volontairement exclu, cf. brief : *« NE CORRIGE RIEN du parcours cassé »*).
Ce playthrough **confirme empiriquement, en pilotant l'app réellement**, chacun des défauts déjà
identifiés par lecture de code dans `docs/AUDIT-2026-07-20-reconstruction.md` §2 :

- Défaut A (nav cassée, login→`/jouer`) — confirmé en LIVE (URL observée après connexion).
- Défaut B (`Continuer`→reboucle `/jouer`) — confirmé en LIVE sur ~8 cycles consécutifs.
- Défaut C (Teddy absent du jeu) — confirmé : 0 occurrence sur 5 écrans `/jouer`, présent
  uniquement sur `/carte` (jamais atteinte normalement).
- Défaut D (créatures placeholder) — confirmé en base (`art_ref = placeholder://legendary/0`) sur
  une vraie créature légendaire gagnée en jouant, pas une fixture.
- Défaut E (économie de dépense absente) — confirmé en base (aucune table de dépense) et en UI
  (0 mention sur 11 écrans), avec un wallet réel qui a accumulé 495 pièces sans but.

**Ce baseline est le point zéro** que R1 (nav/shell), R2 (Teddy+art créatures) et R4 (économie)
combleront. Les playthroughs de clôture de ces épics devront citer ce fichier et documenter
explicitement le delta (quels points de la checklist passent de NON/PARTIEL à OUI).

Aucun trou nouveau découvert nécessitant une issue `discovered` : tout ce qui est documenté ici
était déjà connu et scopé par l'AUDIT (§2) et le plan R0-R5 (§5). Une observation additionnelle,
non bloquante, à noter pour R1/R2 : le diagnostic et les niveaux normaux utilisent **deux formats
de question distincts** (QCM 4 choix vs saisie libre au pavé numérique, PRODUCT §3.2) — le second
format n'a **aucune illustration ni retour visuel différent** du premier ; à garder à l'esprit si
R2 habille les écrans de jeu (les deux formats devront être couverts, pas seulement le QCM le plus
visible en capture).

## Signature (WORKFLOW §21.c)

À remplir par les reviewers **game-design** et **product-owner** demandés sur la PR de cette story
(distinct de la review story-level habituelle) :

| Rôle | Verdict | Commentaire | Date |
|---|---|---|---|
| game-design | _(en attente de review)_ | | |
| product-owner | _(en attente de review)_ | | |

**Condition matérielle** : ce fichier est committé dans `docs/playthroughs/` **et** sera posté en
commentaire sur l'issue épic **#316** après ouverture de la PR.
