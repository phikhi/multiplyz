# 0006. Repli anti-niveau-vide en impasse de consolidation (`buildLevel`)

- **Statut** : accepted
- **Type** : pedago
- **Portée** : majeure (drift — décision propriétaire, cf. issue #108)
- **Liens** : issue [#108](https://github.com/phikhi/multiplyz/issues/108) · PR [#115](https://github.com/phikhi/multiplyz/pull/115) · spec(s) impactée(s) : `ENGINE.md` §4/§7, `PRODUCT.md` §5

## Contexte

`buildLevel` (`src/lib/engine/level.ts`) pouvait renvoyer un **niveau vide (0 question)**
— écran de jeu injouable — dans une **impasse** rencontrée sur la base réelle du profil
**Zoé** (`profile_id=1`, 2026-07-03 en soirée, cf. issue #108) :

- **DUE ∅** : les faits `mastery` ont tous une échéance dans le **futur** (`isDue` faux
  partout, espacement Leitner) ;
- **MAINT ∅** : aucun fait à `box = maxBox` (entretien) ;
- **capNew = 0** : la compétence active (`sub`) a **exactement `SEUIL_CONSO` (⚙️ 8)**
  faits fragiles (`box ≤ consolidationMaxBox`), donc le gate de consolidation force
  0 nouveau (`level.ts`, `capNew = weak >= consolidationThreshold ? 0 : newMaxPerLevel`).

Résultat : `due = []`, `pickNew` prend 0 (cap 0), `maint = []` → `picked = []` →
**niveau vide**. Le piège : le gate dit « consolide d'abord les 8 faits weak », mais ces
faits **ne sont pas encore dus** (échéance le lendemain matin). L'état s'auto-résorbe le
lendemain (les box-1 deviennent dus), mais l'enfant a un écran injouable ce soir-là —
une **régression du contrat no-fail** (PRODUCT §5 : « un niveau se termine toujours »),
visible pour le **vrai juge** (l'enfant).

Ce cas est **sibling** du bugfix #64 (`level.ts` — exclusion des faits NEW de `weak`)
mais **distinct** : #64 corrigeait un code qui **contredisait** la spec (des NEW sans
boîte comptés comme fragiles) ; #108 est une **conséquence émergente** de composants
tous **corrects selon la spec** (gate de consolidation + espacement Leitner). Corriger
exige donc d'**ajouter une règle pédagogique** nouvelle — d'où l'escalade en drift et
l'arbitrage propriétaire (l'issue conclut « probable ADR + màj ENGINE §4/§7 »,
« Priorité réelle = PO / propriétaire »).

## Décision

**Option 2** (tranchée par le propriétaire, commentaire sur #108) : quand la sélection
nominale produirait un niveau **vide** (impasse `DUE ∅ ∧ MAINT ∅ ∧ capNew = 0`), **remonter
les faits `box < maxBox` les plus proches de leur échéance** (plus petit `next_due − now`)
pour remplir le niveau jusqu'à `LEVEL_SIZE`.

- **Rationale** : consolide **exactement** les faits weak que le gate veut résorber
  (juste un peu en avance), **préserve l'espacement** des faits réellement dus (il n'y
  en a aucun dans l'impasse), n'introduit **aucun NEW** non planifié.
- **Invariant gravé** : **un niveau n'est JAMAIS vide** — sauf périmètre **sans aucun
  fait remontable** (scope vide, ou 100 % NEW / entretien non dus, cas structurellement
  non jouable ce tour, hors impasse de consolidation).
- **Portée du déclencheur** : le repli ne s'active **que** si `picked.length === 0` après
  la sélection nominale → **aucune régression** du cas nominal (un niveau non vide n'est
  jamais altéré).
- **Déterminisme** : tri stable par proximité d'échéance, tie-break sur la clé canonique
  du fait ; horloge `now` **injectée** (jamais `Date.now`) → reproductible en test.

Implémentation : helper pur `fillFromDeadlock` + comparateur `makeCompareByDueProximity`
dans `src/lib/engine/level.ts` (étape 5.b de `buildLevel`, entre le remplissage nominal
et l'ordonnancement). Réutilise les constantes/⚙️ existantes (`LEVEL_SIZE`, `maxBox`) —
aucune valeur en dur.

## Alternatives

- **Option 1 — ignorer le gate de consolidation** (injecter du NEW quand DUE∅ ∧ MAINT∅) :
  **rejetée**. Dilue l'intention de consolidation (introduit des faits jamais vus alors
  que le moteur veut justement résorber les fragiles existants) et casse le rythme
  prudent (⚙️ `NEW_MAX_PAR_JOUR`) sans nécessité — il y a déjà des faits weak à travailler.
- **Option 3 — accepter « reviens demain »** (comportement Leitner « intended ») :
  **rejetée**. C'est le comportement d'espacement correct pour un adulte, mais une
  **mauvaise UX enfant** (écran injouable, régression no-fail visible). Le contrat
  produit (PRODUCT §5) prime sur la pureté de l'espacement dans ce cas de bord.

L'option 2 est le **seul** compromis qui honore à la fois le no-fail (PRODUCT §5) **et**
l'intention de consolidation (ENGINE §7), au prix d'une révision **quelques heures en
avance** de faits déjà destinés à la consolidation — écart pédagogiquement négligeable.

## Conséquences

- **+** Invariant no-fail garanti : un niveau n'est plus jamais vide en impasse de
  consolidation. L'enfant peut toujours jouer.
- **+** Aucune dérive du rythme (pas de NEW non planifié) ni de l'espacement des faits
  réellement dus.
- **−** Un fait fragile peut être révisé **quelques heures avant** son échéance Leitner
  en cas d'impasse — écart assumé, borné à l'impasse (rare : exige DUE∅ ∧ MAINT∅ ∧
  8 faits fragiles non dus), réversible.
- **Specs mises à jour** : `ENGINE.md` §4 (pseudo-code `construireNiveau` + note repli) et
  §7 (note impasse de consolidation) documentent le repli comme contrat pédagogique
  canonique.
- **Garde testée à effet observable** (CLAUDE.md §Tests/CI, rétro #60/#61) : test moteur
  reconstruisant l'impasse (`8 faits sub box-1 non dus`) qui **asserte un niveau non
  vide** ET le **contenu/ordre** (faits les plus proches de l'échéance d'abord) — il
  **échoue** si le repli est retiré ou son comparateur muté. Test anti-régression : le
  repli **ne se déclenche pas** quand un niveau nominal non vide existe.
- **Suite** : le seuil `SEUIL_CONSO` (⚙️ 8) et la fréquence réelle de l'impasse restent à
  observer au **playtest** ; l'écart « quelques heures en avance » est un réglage
  pédagogique à surveiller, pas à figer davantage.
