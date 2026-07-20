# 18. Contrat de calcul de la justesse QUOTIDIENNE (sparkline, reporting dérivé)

- **Statut** : accepté
- **Type** : product (sémantiques de reporting) — dérivé, ne modifie aucune décision moteur/data
- **Portée** : mineure (architect-review autonome — in-contract, aucune décision ENGINE/PLAN/SYNC verrouillée touchée)
- **Liens** : issue #241 (discovered en review PR #239, story 7.7) · spec [WIREFRAMES.md](../../WIREFRAMES.md) §7 (sparkline `▁▃▅▆▇`) · frère de l'ADR 0012 (contrat justesse/rapidité/maîtrise/à-revoir) et de l'ADR 0014 (contrat régularité)

## Contexte

Le wireframe de l'espace parent (WIREFRAMES §7) montre une **sparkline de justesse** :
`▁▃▅▆▇` — une **forme**, pas seulement un signe. Le contrat ADR 0012 (`stats.ts`, `AccuracyStats`)
n'expose qu'un point **courant** et un point **précédent** (semaine glissante `trendWindowDays`) —
aucune série par jour. La story 7.7 (PR #239) l'a **honnêtement documenté** : elle a substitué la
sparkline par un **delta signé texte** (« +5 % ») et réalisé la métaphore « historique » dans le
bloc **Régularité** (vraies données journalières, ADR 0014) — substitution validée in-contract par
game-design et PO (pas un drift). L'issue #241 a été filée à cette review, classée `playtest-⚙️`
(non bloquante), pour ajouter — **si le playtest le justifie** — un agrégat de justesse **quotidienne**
qui réalise la vraie sparkline.

Cette story consomme #241 : elle ajoute la série sans toucher au contrat ADR 0012 existant.

## Décision

On fige le **contrat de calcul de la justesse quotidienne**, consommé par le module **séparé**
`src/lib/parent/accuracy-daily.ts` (fonction pure, read-only, isolée — **jamais** dans `stats.ts`).
`ParentStats` (dans `stats.ts`) gagne un champ **sœur** `accuracyDaily`, exactement comme il avait
gagné `regularity` en 7.4/ADR 0014 — `AccuracyStats` (justesse hebdo `current`/`previous`) reste
**inchangée à la lettre**.

1. **Fidélité au modèle (réaffirmée, jamais réinventée)** : la justesse quotidienne ne compte que
   les **1ʳᵉˢ réponses** (`isRetry = false`, ENGINE §9) — **exactement** le même filtre que
   `computeAccuracyStats` (ADR 0012). La fonction réutilise `accuracyOf` (exportée de `stats.ts`
   pour cette réutilisation) plutôt que de recalculer un second ratio.

2. **Jour calendaire = même découpage que la régularité** (ADR 0014) : réutilise `makeDayOrdinal`
   (`regularity.ts`, fuseau ⚙️ `RegularityConfig.dayTimeZone`) — jamais un second découpage de jour
   inventé. Une réponse d'un jour donné y compte pour la justesse quotidienne de CE jour, dans le
   MÊME sens que « ce jour est joué » pour la régularité.

3. **Un jour n'apparaît dans la série QUE s'il porte au moins une 1ʳᵉ réponse** (même discipline
   que `regularity.days`, qui n'inclut que les jours avec au moins une réponse — engagement). Un
   jour où l'enfant n'a fait QUE des re-essais (aucune 1ʳᵉ réponse) n'a rien à montrer côté justesse
   et n'apparaît **pas** — l'`accuracy` d'un point de la série n'est donc **jamais** `null`.

4. **Fenêtre d'affichage = l'⚙️ EXISTANT `ReportingConfig.trendWindowDays`** (ADR 0012, défaut `7`,
   la MÊME « semaine glissante » que le titre « Justesse (semaine) ») — **aucun second réglage de
   largeur inventé**. La série pure (`computeAccuracyDailySeries`) retourne l'historique **complet**,
   triée par ordinal croissant ; le **composant** (`AccuracySparkline`, `ParentDashboard.tsx`)
   tranche les `trendWindowDays` **derniers points AVEC données** — même séparation que
   `RegularitySection`, qui tranche elle-même ses derniers jours JOUÉS (pas les derniers jours
   calendaires).

5. **Aucune horloge (`now`) requise** par la fonction pure : contrairement à `regularity.ts` (série
   courante comparée à « aujourd'hui »), cette série est un simple regroupement HISTORIQUE par
   jour — rien n'y est comparé à l'instant présent.

**Ces définitions sont DÉRIVÉES et ne changent AUCUNE décision ENGINE/PLAN verrouillée** : la
justesse reste la correction (PRODUCT §5), le filtre 1ʳᵉ-réponse reste ENGINE §9. `AccuracyStats`
(ADR 0012) n'est ni modifiée ni réinterprétée — cette série est un agrégat **additionnel**, à côté.

## Alternatives

- **Étendre `AccuracyStats.trend` avec une série** (au lieu d'un champ `ParentStats` séparé) →
  rejeté : toucherait le contrat ADR 0012 gelé (« NE MODIFIE PAS le contrat 7.2/ADR 0012 »),
  agrandirait la surface d'un type déjà consommé ailleurs pour un usage hors de son périmètre
  (tendance hebdo courant/précédent).
- **Justesse quotidienne incluant les re-essais** (comme la régularité) → rejeté : la justesse
  mesure la **correction**, pas l'engagement (PRODUCT §5, ENGINE §5) — inclure les re-essais
  romprait la parité avec `AccuracyStats`/`mastery` et sur-estimerait la justesse réelle.
- **Un jour sans 1ʳᵉ réponse affiché à `accuracy: null`** (au lieu d'être omis) → rejeté :
  complexifierait le rendu (branche `null` par barre) pour un cas qui, par construction, ne peut
  survenir qu'avec des re-essais isolés (rare) — omettre le jour est plus simple et cohérent avec
  `regularity.days` (qui n'inclut que les jours avec activité).
- **Second réglage de largeur de sparkline** (⚙️ dédié) → rejeté : `trendWindowDays` existe déjà et
  porte exactement la même sémantique de fenêtre (« semaine glissante » de justesse) — l'écho est
  voulu (la sparkline EST la décomposition quotidienne du même nombre hebdo affiché juste au-dessus).

## Conséquences

- **+** Contrat unique et fidèle, réalisant honnêtement la métaphore sparkline du wireframe avec de
  VRAIES données (jamais une série fabriquée) — ferme #241 sans dette résiduelle.
- **+** `AccuracyStats`/ADR 0012 restent **inchangées à la lettre** — 0 risque de régression sur les
  consommateurs existants (delta texte « +5 % », tendance hebdo).
- **+** Read-only strict, aucune écriture DB, aucun impact runtime enfant — même garantie que
  `stats-source.ts` (spies insert/update/delete, comptes de lignes inchangés).
- **+** Réutilise deux mécanismes déjà éprouvés (`accuracyOf`, `makeDayOrdinal`) — 0 duplication de
  logique (CLAUDE.md).
- **−** Un nouveau fichier (`accuracy-daily.ts`) + un nouveau champ `ParentStats` à maintenir —
  compromis assumé pour ne PAS toucher le fichier gelé par l'ADR 0012.
- **Spec** : WIREFRAMES §7 reste la référence visuelle (sparkline `▁▃▅▆▇`) ; cet ADR précise son
  calcul de données (aucune décision verrouillée modifiée → ADR canonique, pas de réécriture de spec).
- **Suite** : calibrage éventuel au playtest (classe `playtest-⚙️` de l'issue d'origine #241) — la
  fonction pure reste substituable sans toucher les consommateurs si le modèle affiné (ex. fenêtre
  glissante au lieu de « derniers jours joués ») s'avère nécessaire.
