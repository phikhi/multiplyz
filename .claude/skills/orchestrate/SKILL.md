---
name: orchestrate
description: Boucle d'orchestration autonome de multiplyz. À lancer au démarrage d'une conversation (« continue multiplyz », « avance le projet », reprise de session) : synchronise l'état, trie le backlog, découpe l'épic, choisit/parallélise les stories, puis enchaîne story-start → build → PR → reviews → merge → rétro sans solliciter le propriétaire — escalade UNIQUEMENT sur le drift. Utiliser quand le propriétaire veut avancer le projet sans intervenir.
---

# orchestrate

Playbook de la **boucle autonome** (cf. **ADR 0004** + ADR 0003, WORKFLOW §20). Le propriétaire ne doit **pas** avoir à intervenir sur le planning : triage, découpage, séquencement, parallélisation sont pris en autonomie **tant que ça reste dans le contrat**. Escalade **uniquement** sur le **drift**.

## 0. Charger le contexte (obligatoire)
`CLAUDE.md`, `LEARNINGS.md`, mémoire de statut projet, + specs du scope à venir. Ne jamais réinventer une décision verrouillée.

## 1. Synchroniser l'état

**1.0 — Verrou d'exclusion mutuelle (EN PREMIER, avant tout — #264 Option A / #290, ADR 0004).** Deux runs qui se recouvrent = merges parallèles + clôtures d'épic prématurées + worktrees écrasés + **revue bloquante contournée** (3 collisions réelles, #290). Le guard scanne **deux** verrous complémentaires :

1. **`agent-*` (build)** — un worktree de build verrouillé dont le **pid est VIVANT** appartient à un autre run.
2. **session pleine-durée (#298)** — `.session-lock.json` posé par CE playbook, qui couvre la fenêtre que le verrou `agent-*` ne voit pas : planning → choix de story → **merge** → rétro (entre deux builds, aucun worktree n'est verrouillé).

Au démarrage, AVANT de spawn le moindre subagent, **depuis la racine du dépôt principal** (le lock vit à côté du script ; un worktree a le sien) :
```bash
node .claude/skills/orchestrate/concurrency-guard.mjs   # check : verrous agent-* + lock de session
```
- **BLOCKED** (exit 3 — build `agent-*` vivant **et/ou** session vivante d'un autre run) → **YIELD** : ne démarrer **aucune** story, s'arrêter proprement, rapport court (« run concurrent actif sur <branche>, je cède »). Ne PAS tuer le process concurrent (destructif, domaine ops proprio) ; ne PAS re-programmer (le successeur one-shot du run actif prendra le relais, cf. §7).
- **STALE** (exit 0, verrou `agent-*` dont le **pid est MORT** = run crashé/coupé) → nettoyer l'orphelin (`git worktree remove --force .claude/worktrees/<name>`), puis continuer.
- **CLEAR** (exit 0) → continuer normalement.

**Poser / tenir / rendre le verrou de session — un verrou que personne ne tient ne protège rien.** Les trois sous-commandes ci-dessous sont **inertes tant qu'elles ne sont pas appelées aux points d'ancrage concrets** listés en §5/§6/§7 (le rappel générique ici ne suffit pas) :
```bash
node .claude/skills/orchestrate/concurrency-guard.mjs acquire --note="<épic/story en cours>"   # ICI, juste après un check CLEAR/STALE
node .claude/skills/orchestrate/concurrency-guard.mjs heartbeat                                 # §5 étapes 1, 2 et 4 (cf. ancrages)
node .claude/skills/orchestrate/concurrency-guard.mjs release                                   # les 6 sorties propres — énumération FERMÉE ci-dessous
```
- `acquire` sort en **3** si une session étrangère vivante détient déjà le lock → même conduite que BLOCKED (yield).
- **Où bat le cœur** : §5.1 (au retour du reçu de build), §5.2 (au retour du fan-out de review), §5.4 (après merge + rétro + checkpoint). Ce sont les seuls moments où le thread principal reprend la main assez longtemps pour battre — un build délégué ne bat pas.
- **Où le lock est rendu — ÉNUMÉRATION FERMÉE des terminaisons du run.** Un `release` oublié laisse un lock à pid **vivant** (le process `claude` survit au run) **et heartbeat frais** → le run suivant voit `BLOCKED` **à tort** et cède. **Invariant : toute terminaison du thread principal avec le lock posé rend le verrou** — la liste ci-dessous est **exhaustive** ; y ajouter un chemin d'arrêt sans `release` est un défaut.

| # | Terminaison du run | Où | Lock posé ? | Action |
|---|---|---|---|---|
| 1 | **Fin de scope** (épic clos, plus aucune story) | §5 clôture, étape 5 | oui | `release` |
| 2 | **Stop-drift** → issue `needs-owner` ouverte par ce run | §6 | oui | `release` |
| 3 | **Tout le scope dépend d'un `needs-owner` DÉJÀ ouvert** au démarrage | §6 (fin) | oui | `release` |
| 4 | **Quota-wall** (message de limite d'usage reçu) | §7 « Quota bas », étape 4 | oui | `release` |
| 5 | **Pause propre / mur de contexte / fin de session**, quota GO, scope restant | §7 auto-chaîne (note d'ancrage) | oui | `release` **avant** de programmer le successeur |
| 6 | **`startGuard.verdict = HOLD`** — aucune story démarrable | §7 START | oui | `release` |
| 7 | **Yield sur `BLOCKED`** au check de démarrage | §1.0 | **non** — `acquire` n'a pas encore été joué | rien à rendre |
| 8 | **`acquire` refusé** (exit 3, session étrangère vivante) | §1.0 | **non** — le lock appartient à l'autre run | rien à rendre (ne jamais voler) |
| 9 | **Crash / kill** (frontière propre jamais atteinte) | — | oui | **impossible par construction** → résidu borné par le TTL puis `MAX_AGE` (cf. tableau de résidu) |

Les cas **5 et 6 sont les plus fréquents** en boucle autonome longue, et les plus dangereux : le successeur démarre à `now + ~2 min`, **très en-deçà du TTL de 90 min**.

**Portée RÉELLE — ce que ce verrou ne fait PAS (#164, ne pas sur-revendiquer).** Ce n'est **pas** un « anti-collision garanti » : verrou **consultatif** (aucun verrou noyau, pas de `flock`, aucune sérialisation imposée), un run qui ne l'appelle pas n'est pas contraint, et deux `acquire` exactement simultanés peuvent se croiser. **Réutilisation de pid** : l'OS recycle les pids — un lock abandonné dont le pid a été réattribué à un process sans rapport rend la liveness vraie **à tort** (faux BLOCKED, borné par le TTL puis par `MAX_AGE`) ; aucun jeton d'identité de process n'est stocké, ce cas n'est pas détectable ici. Il est **FAIL-OPEN strict** : tout état incertain (pid indéterminable/mort, heartbeat périmé, âge > plafond dur, fichier corrompu) → **CLEAR**. Conséquence assumée : le pire cas d'un bug est « une collision non empêchée » = **le comportement d'aujourd'hui**, jamais un deadlock où tous les runs cèdent à jamais. Un verdict CLEAR **ne prouve donc pas** l'absence de run concurrent.

**⚙️ calibrables** (env, défauts dans `session-lock.mjs`) : `SESSION_LOCK_TTL_MIN` (**90**) · `SESSION_LOCK_MAX_AGE_MIN` (**360**) · `SESSION_LOCK_MAX_ANCESTOR_DEPTH` (8). **Escape-hatch manuel** : supprimer `.claude/skills/orchestrate/.session-lock.json` (gitignoré) libère immédiatement.

**Pourquoi ces valeurs, et ce qu'elles NE couvrent PAS (calibration honnête).** Le pid propriétaire est le process `claude` du run, qui **survit à la fin du run** (l'app reste ouverte) : la liveness du pid ne détecte donc **pas** un run terminé — seuls le TTL et `MAX_AGE` libèrent un lock abandonné. D'où la calibration sur la cadence réelle : le plus long intervalle **sans tour** de l'orchestrateur est un **build délégué** (20–60 min observés) → TTL **90 min** (marge ~1,5×) ; un run réel enchaîne des stories sur une fenêtre de quota de 5 h → `MAX_AGE` **360 min**. Résidu **assumé, non couvert** :

| Situation | Effet | Borne |
|---|---|---|
| Run **crashé / tué** sans `release` (cas 9), process `claude` toujours vivant | lock fantôme → un run légitime voit BLOCKED **à tort** et cède | ≤ **90 min** (TTL) |
| Run légitime **> 6 h** | son propre lock cesse de le protéger → un concurrent peut démarrer | `MAX_AGE` |
| Build délégué **> 90 min** sans aucun tour orchestrateur | idem : lock périmé pendant que le run est vivant | TTL |
| Playbook **non suivi** (`release` sauté sur une sortie 1→6) | même symptôme qu'un crash | ≤ **90 min** (TTL) |

**Une sortie NORMALE et prévue ne produit plus ce symptôme** : les six terminaisons propres (1→6) rendent le verrou explicitement — c'est l'objet de l'énumération fermée ci-dessus. Le lock fantôme est donc désormais un **accident** (crash, kill, playbook non suivi), plus un **mode nominal**. Ces trous restent le **prix assumé** du fail-open : allonger le TTL les réduirait au prix d'une fenêtre de faux BLOCKED plus longue. **Ne pas rattraper un câblage insuffisant par un TTL démesuré** — si un `heartbeat`/`release` manque à un ancrage, c'est l'ancrage qu'il faut corriger.

**Vérifier que le verrou n'est pas inerte** (un `CLEAR` ne prouve rien — il faut le voir dire BLOCKED sur un vivant connu) :
```bash
node .claude/skills/orchestrate/session-lock-selfcheck.mjs   # vrai process de fond → BLOCKED, puis kill → CLEAR
```

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
   → **au retour du reçu** : `node .claude/skills/orchestrate/concurrency-guard.mjs heartbeat` (le build délégué ne bat pas — c'est le plus long intervalle sans tour, cf. §1.0).
2. **Reviewers indépendants** (subagents, scope + PO, en // ; modèle/fan-out selon §7) → verdicts. **Front livré → VÉRIF VISUELLE des pixels (garde-fou dur, CLAUDE.md #170)** : l'orchestrateur **et** le reviewer Frontend **ouvrent la capture et regardent** que le changement est réellement visible (bon endroit, non recouvert) ; tout élément superposé (SVG/overlay/badge/`absolute`) exige **en plus** une **garde E2E de non-occlusion** (`boundingClientRect`). Panel de tests/reviews vert sur un front **jamais rendu visible** = **DoD non satisfait**.
   → **au retour du fan-out** : `node .claude/skills/orchestrate/concurrency-guard.mjs heartbeat`.
3. **Fixes de consensus in-contract** : renvoyer au **subagent de build** (via SendMessage — il a encore son worktree) « applique : … ». **Pas** dans le thread principal.
4. **Merge** (ADR 0003 : reviews+PO ✅ + CI verte + à jour) → **`retro`** → `LEARNINGS` → **checkpoint statut** (mémoire) → `node .claude/skills/orchestrate/concurrency-guard.mjs heartbeat` (frontière de story).

Router le hors-scope en issues `discovered`. **Re-trier** le backlog entre les merges. Répéter jusqu'à vider l'épic.

**Clôture d'épic — DRAIN obligatoire (avant de passer à l'épic suivant) :**
1. Re-trier **toutes** les `discovered` restantes (grille §2).
2. Les `backlog-hygiène` du scope de l'épic (durcissement / sécu / data non-bloquants — ex. #50/#82/#37/#44) → **regroupées en UNE story de durcissement** (`hardening`), passée par la boucle normale (§5) **avant** de démarrer l'épic suivant. Ne jamais clore un épic en laissant sa dette sécu/data en suspens.
3. Les `parké-playtest` et `gate-déploiement` restent sous leur milestone (non drainées ici, mais **visibles et assignées**).
4. **Avant de clore** : vérifier que la **VALEUR PRODUIT CENTRALE de l'épic atteint réellement l'enfant bout-en-bout** (câblage consommateur fait), pas seulement que chaque story a livré son mécanisme testé (CLAUDE.md #180) — gap vu par les reviewers **fidélité** (game-design + PO), jamais par l'ingénierie qui approuve le mécanisme. Une **story de câblage consommateur** manquante se planifie **avant** la clôture (pas en backlog-hygiène) ; tout owner-gate se **file en issue `needs-owner`**.
5. **Gate « Parcours d'acceptation bout-en-bout » (obligatoire, R0.2/#316, WORKFLOW §21)** : avant de clore, exécuter le **vrai parcours utilisateur** dans un vrai navigateur sur les **vrais assets** (jamais un fixture), en suivant le flow de la spec comme l'enfant, et produire un **playthrough narré** (captures analysées + verdict) confirmant que l'épic est conforme bout-en-bout. **game-design + PO signent ce playthrough** — c'est l'**artefact** qui rend le point 4 exécutable, pas une simple relecture. **Un épic ne se clôt pas sans cet artefact.**
6. Puis **clôturer l'épic** et revenir à l'étape 3. **Plus d'épic ni de story ouverte = fin de scope = sortie propre** → `node .claude/skills/orchestrate/concurrency-guard.mjs release` **avant** le rapport de complétion.

## 6. Escalade — SEULEMENT le drift
S'arrêter et demander le sign-off du propriétaire **uniquement** si une décision **modifierait une décision verrouillée** : modèle de données PLAN · pédagogie ENGINE · économie · sécurité · scope d'épic. **Sinon, jamais.** (ADR 0004.) Le subagent de build **escalade le drift** à l'orchestrateur (il ne tranche pas). Présenter le choix de drift clairement + option recommandée, attendre l'arbitrage.

**En run headless/programmé** (le proprio n'est pas là pour arbitrer en direct) : sur drift → **stop**, ouvrir/étiqueter une issue GitHub **`needs-owner`** avec la question de drift + option recommandée, checkpoint statut, **rendre le verrou de session** (`node .claude/skills/orchestrate/concurrency-guard.mjs release` — un stop-drift est une **sortie propre** : sans release, le lock survit avec un pid vivant et bloque à tort le run d'après jusqu'au TTL), et **NE PAS re-programmer** de reprise (attendre l'arbitrage à la prochaine session interactive). Au **démarrage**, si un blocage `needs-owner` est déjà ouvert → ne pas avancer dessus : le contourner, ou s'arrêter (voir juste en dessous).

**Arrêt parce que tout le scope en dépend** = **sortie propre** (cas 3 de l'énumération §1.0) → `node .claude/skills/orchestrate/concurrency-guard.mjs release` avant le rapport : le lock a déjà été acquis au démarrage (§1.0), sans quoi il bloquerait à tort le run suivant jusqu'au TTL.

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

> _Note de datation (#298)_ — le bloc ci-dessous a été rédigé le 2026-07-14, quand le **verrou pleine-durée était encore « à venir »**. Il est **livré depuis #298** et câblé en **§1.0** (`acquire` / `heartbeat` / `release` aux ancrages §5/§6/§7). Le résidu « crash / tir manuel qui chevauche » est donc désormais **couvert** — dans les limites **fail-open** documentées en §1.0 (un CLEAR ne prouve pas l'absence de concurrent).

> _Note d'ancrage `release` (#298) — s'applique à **TOUTES** les puces du bloc ci-dessous._ Chaque motif d'arrêt listé est une **sortie propre du thread principal avec le lock posé** → exécuter `node .claude/skills/orchestrate/concurrency-guard.mjs release` **AVANT** de programmer le successeur (ou avant le rapport final quand il n'y en a pas). C'est **vital pour la puce « Fin de session / mur de contexte / pause propre, quota GO »** (cas 5 de l'énumération §1.0), la sortie propre **la plus fréquente** de la boucle autonome : le successeur démarre à `now + ~2 min`, très en-deçà du TTL de **90 min** — sans `release` il verrait le lock de son prédécesseur avec un **pid vivant** (le process `claude` survit au run) **et un heartbeat frais**, rendrait `BLOCKED` et **céderait** → l'auto-chaîne se casse **en silence**, précisément le « projet gelé en silence » que ce verrou existe pour empêcher. **Seule exception : la puce « Crash »**, où la frontière propre n'est jamais atteinte — aucun `release` n'est possible (cas 9, résidu borné par le TTL).

**Auto-chaîne = SEUL réveil autonome (routine récurrente RETIRÉE — proprio #290 opt-3, 2026-07-14).** Plus de cron périodique qui relance l'orchestrateur → **toute pause propre avec du scope restant DOIT programmer son successeur en one-shot** (skill `schedule`, one-time, commande `continue multiplyz`), sinon la chaîne meurt = **projet gelé en silence**. C'est aussi le mécanisme **anti-collision cron** (#264/#290) : un seul successeur programmé à la fois → **jamais deux runs concurrents** (ferme le gap fenêtre planning/merge/retro du §1.0 côté cadence ; le **verrou pleine-durée fail-open** reste le fix durable pour un run crashé ou un tir manuel qui chevaucherait). Programmer le successeur **à la frontière propre** (après merge + rétro), selon le motif d'arrêt :
- **Quota-wall** (message de limite reçu) → au **reset de la fenêtre bloquante** (détail ci-dessous).
- **Fin de session / mur de contexte / pause propre, quota GO, scope restant** → one-shot **imminent** (`now + ~2 min`), `continue multiplyz` : le run suivant reprend direct.
- **Fin de scope** (plus d'épic/story ouverte) → **NE PAS** programmer (rapport de complétion).
- **Drift / `needs-owner` bloquant ouvert** → **NE PAS** programmer (attendre l'arbitrage interactif, cf. §6).
- **Crash** (frontière propre jamais atteinte) → aucun successeur = **chaîne rompue** → reprise **manuelle** (`continue multiplyz`) ; résidu couvert par le verrou pleine-durée à venir.

**Quota bas (message de limite reçu) → PAUSE PROPRE + reprise AUTO-PROGRAMMÉE :**
  1. Finir la story courante (**merge + rétro**), **checkpoint statut** (WIP + next + **chiffre MESURÉ** : `usedTokens` / `resetsInMin`, jamais un %). Ne jamais s'arrêter au milieu.
  2. **Parser QUELLE limite** dans le message (5-hour **vs** weekly) et lire son **heure exacte de reset** (à défaut fenêtre 5 h : `now + 5 h`).
  3. **Programmer un run UNIQUE** au **reset de la fenêtre bloquante** (`+ ~5 min`) via le skill **`schedule`** (one-time, pas de cron), commande **`continue multiplyz`**. Ce run bosse la fenêtre suivante puis **re-programme** le suivant → **chaîne auto**. ⚠️ Si le mur est **hebdo**, programmer au reset **hebdo** — **jamais** `+5 h` (sinon réveil dans le même mur = run gâché).
  4. **Rendre le verrou** (`node .claude/skills/orchestrate/concurrency-guard.mjs release`) — la pause quota est une **sortie propre**, et le successeur programmé doit trouver le champ libre : sans release il verrait `BLOCKED` (pid `claude` encore vivant) et céderait, **cassant la chaîne**. Puis **STOP** + rapport : « fait X / reste Y / **reprise programmée à HH:MM (fenêtre 5 h | hebdo)** ».
  - **Fin de scope** (plus d'épic/story ouverte) → **NE PAS** re-programmer ; rapport de complétion.
  - **Scheduling cloud indisponible** (gating plan) → ne pas programmer ; rapporter l'heure de reset + le chiffre mesuré pour reprise manuelle (`continue multiplyz`).
  - **Mur hebdo sans heure de reset exacte** → ne pas re-programmer une reprise qui retomberait dans le mur ; rapport + (si tout le scope est bloqué) issue `needs-owner`.
  - **Drift rencontré** (§6) → `needs-owner` + **ne pas** re-programmer.
  - **Ne pas démarrer** une story quand `startGuard.verdict = HOLD` (évite les branches orphelines). Si HOLD laisse le run **sans aucune story démarrable**, il s'arrête : c'est une **sortie propre** (cas 6 de l'énumération §1.0) → `node .claude/skills/orchestrate/concurrency-guard.mjs release` **avant** de programmer le successeur (au reset mesuré), sinon ce successeur verrait `BLOCKED` et céderait.

## Rapport (sans attendre d'aval)
Rapporter en continu, sobrement : tri du backlog, épic/story choisis + pourquoi, parallélisation, chaque merge, rétro. Le propriétaire lit ; il n'a pas à répondre (sauf drift).

## Interdits (en dur, jamais relâchés)
Force-push `main` · secrets · toucher la branch-protection · contourner CI/reviews/PO · sortir du scope de l'épic sans escalade drift.
