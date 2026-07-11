---
name: orchestrate
description: Boucle d'orchestration autonome de multiplyz. À lancer au démarrage d'une conversation (« continue multiplyz », « avance le projet », reprise de session) : synchronise l'état, trie le backlog, découpe l'épic, choisit/parallélise les stories, puis enchaîne story-start → build → PR → reviews → merge → rétro sans solliciter le propriétaire — escalade UNIQUEMENT sur le drift. Utiliser quand le propriétaire veut avancer le projet sans intervenir.
---

# orchestrate

Playbook de la **boucle autonome** (cf. **ADR 0004** + ADR 0003, WORKFLOW §20). Le propriétaire ne doit **pas** avoir à intervenir sur le planning : triage, découpage, séquencement, parallélisation sont pris en autonomie **tant que ça reste dans le contrat**. Escalade **uniquement** sur le **drift**.

## 0. Charger le contexte (obligatoire)
`CLAUDE.md`, `LEARNINGS.md`, mémoire de statut projet, + specs du scope à venir. Ne jamais réinventer une décision verrouillée.

## 1. Synchroniser l'état

**1.0 — Verrou d'exclusion mutuelle (EN PREMIER, avant tout — #264 Option A, ADR 0004).** Empêche de **démarrer une story** tant qu'un **build concurrent** est verrouillé (réduit fortement le recouvrement ; ne couvre pas la fenêtre planning/merge d'un autre run sans build actif — full-exclusion pleine-durée = follow-up lockfile/flock). Deux runs cron qui se recouvrent = merges parallèles + clôtures d'épic prématurées + worktrees écrasés (2 collisions réelles). Au démarrage, AVANT de spawn le moindre subagent :
```bash
node .claude/skills/orchestrate/concurrency-guard.mjs   # scanne les verrous agent-* (pid vivant ?)
```
- **BLOCKED** (exit 3, un verrou `agent-*` dont le **pid est VIVANT** = build d'un AUTRE run en cours) → **YIELD** : ne démarrer **aucune** story, s'arrêter proprement, rapport court (« run concurrent actif sur <branche>, je cède »). Ne PAS tuer le process concurrent (destructif, domaine ops proprio) ; ne PAS re-programmer (le cron relancera, le concurrent aura fini).
- **STALE** (exit 0, verrou dont le **pid est MORT** = run crashé/coupé) → nettoyer l'orphelin (`git worktree remove --force .claude/worktrees/<name>`), puis continuer.
- **CLEAR** (exit 0) → continuer normalement.

```bash
git fetch --prune && git status
gh pr list --state open           # PR en cours à finir/merger d'abord
gh issue list --state open --limit 50
gh run list --limit 5             # CI
# Décisions du propriétaire EN ATTENTE — DEUX canaux durables uniquement (cf. PR #77) :
gh issue list --state open --label needs-owner --json number,title,comments   # arbitrages / promotions déférées
for n in $(gh pr list --state open --json number -q '.[].number'); do \
  gh pr view "$n" --json number,comments -q '{n:.number,c:[.comments[]|select(.author.login=="phikhi")|.body]}'; done
```
Le propriétaire décide **sur une PR OUVERTE** (lue avant merge) ou **sur une issue `needs-owner`** (ouverte = en attente, fermée = consommée). **Pas** de scan des PR déjà mergées (fenêtre fragile, sans accusé — c'est le trou de #77).

- **Finir l'existant avant de commencer** : PR ouverte prête → boucle review→merge ; branche/worktree orpheline → reprendre ou nettoyer.
- **Consommer les décisions du propriétaire AVANT tout nouveau travail** — tout commentaire proprio (approbation / refus / correction) ou issue `needs-owner` **tranchée** = **instruction à appliquer**, jamais un fil clos. Protocole **ack obligatoire** (marqueur « consommé », anti-régression #77) :
  1. **Appliquer** (PR de suivi si contrat, sinon direct).
  2. **Accuser** : répondre sur le fil `→ appliqué dans PR #X` (`gh pr comment` / `gh issue comment`) **et** réagir 👍 (`gh api …/reactions -f content=+1`).
  3. **Clore** l'issue `needs-owner` (une issue `needs-owner` ouverte = décision **non encore appliquée**, invariant de reprise).
  - Avant d'agir sur un commentaire : s'il porte déjà l'ack (`→ appliqué dans PR #…`) ou 👍 de l'orchestrateur → **déjà consommé**, ne pas ré-appliquer (idempotence).

## 2. Trier le backlog (grille)
Classer **chaque** issue ouverte (surtout `discovered`) :

| Classe | Critère | Action |
|---|---|---|
| **bloquant-maintenant** | correctness/sécurité dont dépend une story du scope courant | intégrer dans l'épic courant, avant la story consommatrice |
| **prochain-épic** | rattachée à un épic futur précis (ex. entrée Parent → #7) | commenter/lier l'épic cible, différer |
| **backlog-hygiène** | durcissement / sécu / data / hygiène, aucun blocage immédiat (ex. #50 TOCTOU, #82 idempotence, #37 unicité, #44 GC) | **drainé en story de durcissement à la clôture de l'épic** (voir §5) — ne pas laisser traîner |
| **gate-déploiement** | requis avant un jalon de déploiement (ex. Nginx X-Real-IP #47) | milestone `pre-deploy`, différer au pré-déploiement |
| **parké-playtest** | calibration ⚙️ qui exige l'enfant qui joue (ex. #66/#76/#83) | milestone `playtest-⚙️`, **parké explicitement** (pas oublié) |

Rapporter le tri (bref). Ne pas absorber une issue hors-scope dans une story (anti-drift). **Toute issue `discovered` reçoit une classe + un milestone** → aucune ne reste sans destination.

## 3. Choisir l'épic + découper en stories
- **Ordre de build verrouillé** (CLAUDE.md/PLAN) : ne pas sauter. Épic courant fini → épic suivant.
- Découper l'épic en **stories GitHub** (Epic → Story) : critères d'acceptation testables + DoD, `blocked-by`, scope. S'appuyer sur la spec du scope (ex. `ENGINE.md` pour #3) et le skill `brief-to-tasks` si utile. Séquencer par **surfaces partagées**.

## 4. Choisir la/les story(ies) + parallélisation
- Prochaine story = première **débloquée** (`blocked-by` résolus) dans l'ordre.
- **Paralléliser** deux stories seulement si **surfaces disjointes** ET aucun **contrat partagé** modifié (schéma, config, règle lint, dépendance, composant partagé). Surface partagée → **séquencer** (LEARNINGS : interactions cross-PR en fan-out). Plafonner le // pour garder la charge de review saine.

## 5. Boucle d'exécution (par story) — build DÉLÉGUÉ
Le thread orchestrateur **ne construit pas lui-même** (contexte plat, cf. §7). Par story :
1. **Déléguer le build à un subagent isolé** (`isolation: worktree` ; modèle selon risque, §7). Brief : « implémenter la story #X (critères + DoD) en suivant le workflow multiplyz (`story-start` → build 100 % logique critique → gates lint/type/coverage/build/e2e + captures → `open-pr`) ; **escalader tout drift** à l'orchestrateur ; **ne rien merger** ». Reçu **compact** attendu : n° de PR, résultats de gates, fichiers touchés, captures, **flag drift éventuel**.
2. **Reviewers indépendants** (subagents, scope + PO, en // ; modèle/fan-out selon §7) → verdicts. **Front livré → VÉRIF VISUELLE des pixels (garde-fou dur, CLAUDE.md #170)** : l'orchestrateur **et** le reviewer Frontend **ouvrent la capture et regardent** que le changement est réellement visible (bon endroit, non recouvert) ; tout élément superposé (SVG/overlay/badge/`absolute`) exige **en plus** une **garde E2E de non-occlusion** (`boundingClientRect`). Panel de tests/reviews vert sur un front **jamais rendu visible** = **DoD non satisfait**.
3. **Fixes de consensus in-contract** : renvoyer au **subagent de build** (via SendMessage — il a encore son worktree) « applique : … ». **Pas** dans le thread principal.
4. **Merge** (ADR 0003 : reviews+PO ✅ + CI verte + à jour) → **`retro`** → `LEARNINGS` → **checkpoint statut** (mémoire).

Router le hors-scope en issues `discovered`. **Re-trier** le backlog entre les merges. Répéter jusqu'à vider l'épic.

**Clôture d'épic — DRAIN obligatoire (avant de passer à l'épic suivant) :**
1. Re-trier **toutes** les `discovered` restantes (grille §2).
2. Les `backlog-hygiène` du scope de l'épic (durcissement / sécu / data non-bloquants — ex. #50/#82/#37/#44) → **regroupées en UNE story de durcissement** (`hardening`), passée par la boucle normale (§5) **avant** de démarrer l'épic suivant. Ne jamais clore un épic en laissant sa dette sécu/data en suspens.
3. Les `parké-playtest` et `gate-déploiement` restent sous leur milestone (non drainées ici, mais **visibles et assignées**).
4. **Avant de clore** : vérifier que la **VALEUR PRODUIT CENTRALE de l'épic atteint réellement l'enfant bout-en-bout** (câblage consommateur fait), pas seulement que chaque story a livré son mécanisme testé (CLAUDE.md #180) — gap vu par les reviewers **fidélité** (game-design + PO), jamais par l'ingénierie qui approuve le mécanisme. Une **story de câblage consommateur** manquante se planifie **avant** la clôture (pas en backlog-hygiène) ; tout owner-gate se **file en issue `needs-owner`**.
5. Puis **clôturer l'épic** et revenir à l'étape 3.

## 6. Escalade — SEULEMENT le drift
S'arrêter et demander le sign-off du propriétaire **uniquement** si une décision **modifierait une décision verrouillée** : modèle de données PLAN · pédagogie ENGINE · économie · sécurité · scope d'épic. **Sinon, jamais.** (ADR 0004.) Le subagent de build **escalade le drift** à l'orchestrateur (il ne tranche pas). Présenter le choix de drift clairement + option recommandée, attendre l'arbitrage.

**En run headless/programmé** (le proprio n'est pas là pour arbitrer en direct) : sur drift → **stop**, ouvrir/étiqueter une issue GitHub **`needs-owner`** avec la question de drift + option recommandée, checkpoint statut, et **NE PAS re-programmer** de reprise (attendre l'arbitrage à la prochaine session interactive). Au **démarrage**, si un blocage `needs-owner` est déjà ouvert → ne pas avancer dessus (le contourner ou s'arrêter si tout le scope en dépend).

## 7. Contexte & quota (autonomie longue)
**Contexte** — l'état durable vit dans **git / GitHub / `LEARNINGS` / mémoire**, pas dans le contexte → le contexte est **jetable aux frontières de story**.
- **Thread principal = conclusions only** : déléguer build (§5), reviews, exploration (`Explore`) aux subagents ; ne jamais garder fichiers/diffs dans le contexte principal.
- **Ne jamais couper / compacter au MILIEU d'une story** (état intermédiaire non durable = branche à moitié faite). Frontière propre = **après merge + rétro** ; y mettre à jour la **mémoire de statut** (WIP + next) → reprise exacte en nouvelle conversation.

**Quota (Claude Max — fenêtre glissante ~5 h ET quota hebdo)** — **règle de décision : ADR 0011.**
- **Tiering modèle** : **Opus** = orchestration + jugement de drift + build **cœur** (moteur/sécu/data) ; **Sonnet** = reviewers + build **mécanique** ; **Haiku** = exploration.
- **Fan-out au risque** : story mécanique/faible risque → panel de review **réduit** ; sécu/data/pédagogie → panel **complet** (scope + PO).

**Décision quota = MESURE locale + RÉACTIF au message, JAMAIS un % auto-estimé (ADR 0011).**
Le % serveur / le reset / le quota hebdo **ne sont PAS lisibles localement** — toute phrase « quota à ~N % » est une **hallucination** (cause des faux arrêts/démarrages passés). N'utiliser que ces deux signaux honnêtes :

- **STOP quota = RÉACTIF, jamais préventif.** Ne s'arrêter pour cause de quota **que** quand le **message de limite d'usage** se déclenche (seule autorité « coupé + reset »), ou en **fin de scope**. **Interdit** : s'arrêter « parce que le quota doit être haut ». Pas de message → on continue.
- **START (garde anti-orphelin) = décision sur MESURE**, à **chaque frontière de story** (jamais un chiffre en mémoire/cache) :
  ```bash
  node .claude/skills/orchestrate/quota-usage.mjs   # JSON + 1 ligne humaine (ADR 0011)
  ```
  Lecteur JSONL maison (pur stdlib, compte-account) → tokens du **bloc 5 h actif**, **minutes avant reset** (réelles), **plafond empirique** (max bloc passé, auto-calibré — 0 nombre deviné), **proxy hebdo 7 j**, et un `startGuard.verdict` :
  - **HOLD** (finir la story courante, n'en démarrer **aucune**) si `ratio ≥ START_GUARD_RATIO` (⚙️ 0.85) **ou** `resetsInMin ≤ STORY_WALLCLOCK_MIN` (⚙️ 30 min).
  - **GO** sinon.

**Quota bas (message de limite reçu) → PAUSE PROPRE + reprise AUTO-PROGRAMMÉE :**
  1. Finir la story courante (**merge + rétro**), **checkpoint statut** (WIP + next + **chiffre MESURÉ** : `usedTokens` / `resetsInMin`, jamais un %). Ne jamais s'arrêter au milieu.
  2. **Parser QUELLE limite** dans le message (5-hour **vs** weekly) et lire son **heure exacte de reset** (à défaut fenêtre 5 h : `now + 5 h`).
  3. **Programmer un run UNIQUE** au **reset de la fenêtre bloquante** (`+ ~5 min`) via le skill **`schedule`** (one-time, pas de cron), commande **`continue multiplyz`**. Ce run bosse la fenêtre suivante puis **re-programme** le suivant → **chaîne auto**. ⚠️ Si le mur est **hebdo**, programmer au reset **hebdo** — **jamais** `+5 h` (sinon réveil dans le même mur = run gâché).
  4. **STOP** + rapport : « fait X / reste Y / **reprise programmée à HH:MM (fenêtre 5 h | hebdo)** ».
  - **Fin de scope** (plus d'épic/story ouverte) → **NE PAS** re-programmer ; rapport de complétion.
  - **Scheduling cloud indisponible** (gating plan) → ne pas programmer ; rapporter l'heure de reset + le chiffre mesuré pour reprise manuelle (`continue multiplyz`).
  - **Mur hebdo sans heure de reset exacte** → ne pas re-programmer une reprise qui retomberait dans le mur ; rapport + (si tout le scope est bloqué) issue `needs-owner`.
  - **Drift rencontré** (§6) → `needs-owner` + **ne pas** re-programmer.
  - **Ne pas démarrer** une story quand `startGuard.verdict = HOLD` (évite les branches orphelines).

## Rapport (sans attendre d'aval)
Rapporter en continu, sobrement : tri du backlog, épic/story choisis + pourquoi, parallélisation, chaque merge, rétro. Le propriétaire lit ; il n'a pas à répondre (sauf drift).

## Interdits (en dur, jamais relâchés)
Force-push `main` · secrets · toucher la branch-protection · contourner CI/reviews/PO · sortir du scope de l'épic sans escalade drift.
