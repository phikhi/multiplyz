# 15. Rejeter un monde en attente — nouveau statut `rejected`

- **Statut** : accepté
- **Type** : data (contrat `worlds.status`) — additif, ne modifie aucune décision moteur/éco verrouillée
- **Portée** : mineure (architect-review autonome — in-contract, aucune décision WORLDGEN/ECONOMY verrouillée touchée)
- **Liens** : issue #231 (story 7.9) · spec [WORLDGEN.md](../../WORLDGEN.md) §6 · frère de l'ADR 0008 (pipeline mondes IA, story 6.1) · consomme le mécanisme `approveWorld` (6.5)

## Contexte

La story 7.9 livre l'écran parent d'approbation des mondes `buffered` (WORLDGEN §6 « validation
parent optionnelle »). `approveWorld` (posé en 6.5, `src/lib/worldgen/worker.ts`) transitionne
`buffered` → `active`. L'issue #231 demande aussi une action **« Rejeter »** — WORLDGEN §6 ne
documente que l'auto-filtre QA (rejet → régénération) et l'approbation parent ; elle ne spécifie
**aucune** sémantique de rejet **parent** explicite.

Sans mécanisme de rejet, un monde `buffered` qu'un parent juge inapproprié reste indéfiniment en
file d'attente (aucun moyen de le retirer de l'écran d'approbation) — la seule alternative est de
l'ignorer, ce qui laisse la file encombrée sans jamais purger l'intention du parent.

`worlds.status` est une colonne `text` **sans contrainte `CHECK` SQL** (schema.ts : `text("status")
.$type<WorldStatus>()`, le typage `WorldStatus` n'est qu'un contrat **TypeScript**, jamais sérialisé
dans le snapshot/SQL généré par drizzle-kit). Élargir cette union est donc **structurellement
gratuit** côté migration (`db:generate` reste un no-op, vérifié).

## Décision

On ajoute un **troisième statut** `"rejected"` à `WorldStatus` (`"buffered" | "active" |
"rejected"`, `src/lib/db/schema.ts`), et un mécanisme miroir d'`approveWorld` :

```
rejectWorld(db, worldId): void
```

- Transitionne `buffered` → `rejected` (jamais l'inverse, jamais depuis `active` — un monde déjà
  actif ne peut pas être rejeté par ce mécanisme minimal, hors scope).
- Garde : le monde doit **exister** et être **`buffered`** (sinon `WorldModerationError`, même
  classe d'erreur qu'`approveWorld`).
- **Aucune identité stockée** (pas de colonne `rejected_by`) — contrairement à `approveWorld`, qui
  enregistre `approvedBy` (donnée déjà exposée ailleurs, WORLDGEN §6). Minimal in-contract : aucun
  changement de colonne, aucune migration. Symétrique de `deleteProfile` (7.5), qui ne trace pas non
  plus l'identité de l'agent de suppression.

### Correction post-review (Backend, PR #247) — garantie terminale RÉELLE, pas un invariant supposé

La version initiale de cet ADR affirmait qu'un monde `status = buffered` avait **toujours** déjà
passé la QA (« un job n'atteint `done` qu'après QA réussie ») et omettait donc la garde
`worldPassedQa` sur `rejectWorld`, la jugeant redondante (#143). **Cette affirmation était fausse** :
`generateWorld` (6.3) écrit `status = buffered` **À LA GÉNÉRATION**, dans sa propre transaction
committée, **AVANT** que `processNextJob` n'évalue la QA — un monde `buffered` peut donc être
**pré-QA ou mi-QA** (job encore `pending`/`running`, aucun job `done` pour son index). Sans garde,
un parent pouvait :

1. voir un monde `buffered` pré-QA/mi-QA dans l'écran d'approbation (le filtre `status = buffered`
   seul ne suffit pas à l'exclure) ;
2. le **rejeter** (`rejectWorld` acceptait n'importe quel `buffered`) ;
3. voir ce rejet **silencieusement écrasé** quand le même job finissait par réussir sa QA sur un
   retry ultérieur — la finalisation de `processNextJob` (`tx.update(worlds).set({status:
   targetStatus}).where(eq(worlds.index, worldIndex))`) n'avait **aucune condition de statut**, donc
   réécrivait `rejected` → `active`/`buffered` sans erreur ni log.

**Fix — trois couches, chacune mutation-prouvée** :

1. **Finalisation gardée** (`worker.ts`, transaction de `processNextJob`) : l'`UPDATE worlds` de
   finalisation est désormais conditionné sur `and(eq(index, worldIndex), eq(status, "buffered"))`
   — si le monde n'est plus `buffered` (déjà `rejected` par le parent), l'écriture devient un no-op
   (0 ligne). **C'est CETTE garde qui réalise la garantie terminale `rejected`**, pas un invariant
   sur `rejectWorld`.
2. **Lecture filtrée** (`world-approval.ts`, `listPendingWorlds`/`countPendingWorlds`) : ne montre
   au parent QUE les mondes `buffered` **ET** QA-validés (`worldPassedQa`) — un monde pré-QA/mi-QA
   n'est **jamais exposé**, donc jamais rejetable/approuvable depuis l'écran.
3. **Garde directe sur `rejectWorld`** (défense en profondeur, symétrique d'`approveWorld`) :
   `worldPassedQa(db, world.index)` requis, sinon `WorldModerationError` — protège le chemin d'appel
   direct même si la couche 2 était un jour contournée/régressée.

**Aucun changement à `resolveWorld`** (`src/lib/worldgen/socle.ts`) : le résolveur filtre déjà
strictement `status = active` — un monde `rejected` tombe automatiquement dans le même repli socle
qu'un monde `buffered` non encore approuvé (aucune branche neuve, comportement déjà couvert par le
test existant « un monde `buffered` n'est pas servi → fallback socle »).

**Aucun changement à `ensureBuffer`/`worldExists`** : un monde `rejected` occupe toujours sa ligne
`worlds` à son `world_index` → cet index ne sera **jamais régénéré** (même comportement qu'un monde
resté `buffered` indéfiniment sans jamais être approuvé — ce n'est **pas une régression introduite
par cette décision**, c'est le comportement préexistant de tout monde non-`active`). La position de
carte correspondante retombe **définitivement** sur le socle de secours pour cet index — acceptable
en v1 (WORLDGEN §7 : le socle garantit toujours un monde jouable) ; une éventuelle « re-génération
après rejet » est un raffinement hors scope, non demandé par #231.

L'écran parent (`app/parent/(espace)/mondes`) liste les mondes `WHERE status = 'buffered'` — un
monde `rejected` **disparaît** naturellement de la file dès la transition (pas de requête
supplémentaire, pas de filtre `NOT IN (...)` à maintenir).

## Alternatives

- **DELETE la ligne `worlds`** au lieu d'un statut `rejected` → **rejetée** : perdrait la trace
  (prompt/seed/palette, WORLDGEN §7 « reproductibilité ») et **libérerait `world_index`**, ce qui
  romprait l'unicité `worlds.index` invoquée ailleurs (`worldExists`, `ensureBuffer`) — un
  `DELETE` ferait croire au buffer que l'index est libre, risque de **double génération** au même
  index (violerait l'idempotence #82, décision verrouillée). Le statut additif est strictement
  plus sûr, sans toucher au contrat d'idempotence.
- **Table de modération séparée** (`world_moderation_log`) → **rejetée** : sur-ingénierie pour v1 —
  aucune consommation actuelle de l'historique des décisions, ajouterait une table + migration
  pour un besoin non exprimé par l'issue. Réévaluable si un futur AC demande un historique.
- **Stocker `rejectedBy`** (colonne miroir d'`approvedBy`) → **rejetée pour cette story** : demandé
  nulle part dans #231 ni WORLDGEN §6 ; ajouterait une colonne nullable (migration additive à faible
  risque, mais scope non minimal) pour une donnée non consommée. Réévaluable si un futur besoin
  d'audit émerge.
- **Ré-enqueue automatique du `world_index` rejeté** (le libérer pour régénération) → **rejetée** :
  toucherait `worldExists`/`ensureBuffer` (mécanisme verrouillé, budget mensuel WORLDGEN §2) pour un
  comportement non demandé — un monde rejeté retombant sur le socle est un état terminal acceptable
  en v1 (même repli que WORLDGEN §7 pour l'IA indisponible).

## Conséquences

- **+** Additif pur : `WorldStatus` élargi, **zéro migration** (colonne `text` sans `CHECK`,
  `$type<>` est un contrat TS seul — vérifié `pnpm db:generate` no-op).
- **+** `resolveWorld`/`ensureBuffer`/`purgeFailedWorldAssets` restent **inchangés** — un monde
  `rejected` se comporte, pour tout le reste du pipeline, exactement comme un monde resté
  `buffered` indéfiniment (déjà couvert par les tests existants, aucune branche neuve à risque).
- **+** Mécanisme symétrique d'`approveWorld` (même fichier, même classe d'erreur, même garde
  d'existence/statut) → surface de review réduite, cohérence de style.
- **−** Un monde rejeté **fige définitivement** son `world_index` sur le repli socle (jamais
  régénéré) — acceptable en v1, documenté comme limite connue plutôt que silencieuse.
- **Spec** : WORLDGEN §6 mis à jour avec une ligne décrivant `rejected` (ADR canonique, aucune
  réécriture profonde — la validation parent optionnelle reste inchangée, ce n'est qu'un
  complément).
- **Suite** : si un besoin de « réactiver un monde rejeté » ou de « régénérer l'index libéré »
  émerge au playtest, il fera l'objet d'un futur ADR (touche potentiellement le budget/`ensureBuffer`,
  décision verrouillée).
- **Correction (PR #247)** : la garantie « `rejected` est terminal » est réalisée par la **garde de
  statut sur la finalisation** de `processNextJob` (fix 1 ci-dessus), pas par un invariant supposé
  sur `worldPassedQa`/`rejectWorld` — sans cette garde de finalisation, un job réussissant sa QA
  **après** un rejet parent aurait pu écraser silencieusement la décision. Les trois couches
  (finalisation gardée + lecture filtrée + garde directe) sont **chacune** mutation-prouvée
  (`worker.test.ts`/`world-approval.test.ts`).
