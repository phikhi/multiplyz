# 14. Contrat de calcul de la régularité de l'espace parent (reporting dérivé)

- **Statut** : accepté
- **Type** : product (sémantiques de reporting) — dérivé, ne modifie aucune décision moteur/data/SYNC
- **Portée** : mineure (architect-review autonome — in-contract, aucune décision ENGINE/PLAN/SYNC verrouillée touchée)
- **Liens** : issue #217 (story 7.4) · spec [PLAN.md](../../PLAN.md) §Espace parent :83 · [WIREFRAMES.md](../../WIREFRAMES.md) §7 · [DETAILS.md §3 (Temps d'écran)](../../DETAILS.md) · frère de l'ADR 0012 (contrat de calcul justesse/rapidité/maîtrise/à-revoir)

## Contexte

L'espace parent affiche un indicateur de **régularité** (PLAN §Espace parent :83, WIREFRAMES §7) :
**jours joués**, **temps de jeu/jour**, **série de jours** (« 🔥 5 jours »), **respect des 15-20 min**.
Comme pour les quatre indicateurs de l'ADR 0012, ces valeurs doivent être **alimentées par la seule
matière première du moteur** — ici le journal `attempts` (PLAN :77 ; la colonne `created_at` est
d'ailleurs documentée « régularité / tendances » dès le schéma).

Le problème : **aucune notion de « minutes jouées/jour », de « série » ou de « respect 15-20 min »
n'est persistée**. Seul `attempts.createdAt` (instant de chaque réponse) existe. Deux voies :

- **Option A — dériver de `attempts.createdAt`** (aucune table, aucune écriture runtime, pur reporting).
- **Option B — matérialiser des sessions** (table `sessions`/heartbeat mesurant la durée réelle).

L'Option B **touche le contrat d'écriture runtime / SYNC** (décision verrouillée) : elle ajouterait
une écriture pendant que l'enfant joue. L'Option A reste **strictement read-only** et **in-contract**.
La spec **autorise explicitement l'approximation** du temps par « fenêtres d'activité » (brief 7.4).
On retient donc **l'Option A**.

## Décision

On fige le **contrat de calcul de la régularité** consommé par `src/lib/parent/regularity.ts`
(agrégats **purs, read-only**, composés par `stats-source.ts` dans `ParentStats.regularity`). Toutes
les valeurs calibrables sont dans `RegularityConfig` (`src/config/server-config.ts`, ⚙️).

1. **Engagement, pas correction** — la régularité mesure la **présence** (l'enfant a-t-il joué,
   combien de temps). Elle compte donc **TOUTES les réponses**, **re-essais inclus** — contrairement à
   la justesse/rapidité (ADR 0012) qui ne comptent que les 1ʳᵉˢ réponses (ENGINE §9). Un re-essai est
   du temps de jeu réel.

2. **Jour calendaire = date locale dans un fuseau ⚙️** (`dayTimeZone`, défaut `"Europe/Paris"`), jamais
   UTC brut : le « jour » d'une réponse est sa date murale dans le fuseau de la famille (française),
   fidèle au vrai jour vécu de l'enfant. Un instant est réduit à un **ordinal de jour entier**
   (`Date.UTC(y, m, d) / MS_PER_DAY` sur les composantes locales) — **DST-indépendant** : deux jours
   calendaires consécutifs diffèrent toujours de 1.

3. **Jours joués** = nombre de jours calendaires **distincts** portant au moins une réponse (historique).

4. **Temps de jeu/jour = amplitude bornée** (approximation assumée) : `min(dernier − premier attempt
   du jour, maxDayAmplitudeMinutes)` (⚙️, défaut `75` min — resserré depuis `240` min = 4 h par
   l'issue #235, calibration game-design sur la fourchette recommandée 60-90 min). **Libellé honnête
   (#164, correction #235)** : ce plafond borne le **nombre de minutes affiché** pour un jour à
   artefact multi-session (ex. une réponse isolée du matin + une du soir), il ne change **jamais** le
   classement `under`/`within`/`over` du point 6 — tant qu'il reste `> respectWindowMaxMinutes` (20 par
   défaut — vrai pour les défauts calibrés ici, mais **non garanti par une validation croisée** : un env
   abaissant ce plafond sous la fenêtre saine romprait cette propriété), tout jour dont l'amplitude BRUTE
   dépasse la fenêtre saine reste classé **over** quelle que soit sa valeur ; seul le nombre affiché
   diminue. Un jour à **une seule** réponse a une amplitude nulle → 0 min (une question isolée ≈ temps
   négligeable). Ce n'est **pas** une durée de session mesurée : c'est un **repère** dérivé, calibrable
   au playtest.

5. **Série de jours** — deux jours joués appartiennent à la même série si leur écart d'ordinaux est
   **strictement inférieur** à `streakBreakGapDays` (⚙️, défaut `2` : écart 1 continue, écart ≥ 2
   rompt = jours consécutifs stricts). **Série courante** = longueur du run consécutif finissant au
   dernier jour joué, **vivante** seulement si `todayOrdinal − dernier < streakBreakGapDays`
   (aujourd'hui pas encore fini ne casse pas la série d'hier) ; sinon `0`. **Record** = plus long run
   consécutif de tout l'historique.

6. **Respect des 15-20 min** = classement du temps/jour vis-à-vis d'une **fenêtre saine ⚙️**
   (`respectWindowMinMinutes`/`respectWindowMaxMinutes`, défaut `15`/`20`, DETAILS §3 (Temps d'écran)) : `< min` →
   **en-dessous** ; `> max` → **au-dessus** ; **bornes incluses** entre les deux → **dans la fenêtre**.

**Ces définitions sont DÉRIVÉES et ne changent AUCUNE décision ENGINE/PLAN/SYNC verrouillée.** Elles
ne pilotent **que** l'affichage parent (0 écriture, 0 impact runtime enfant). En particulier, le
**respect des 15-20 min et le temps/jour sont un repère de REPORTING** — la story 7.4 **n'enforce
rien**. Le nudge de session et le verrou dur de temps d'écran (`ParentControlsConfig`, stockés par
foyer en 7.3) et leur **enforcement** (story 7.8 #229) sont un **axe distinct** : la fenêtre saine de
reporting (15-20, fixe DETAILS §3 (Temps d'écran)) reste **indépendante** du réglage de temps d'écran du foyer.

## Alternatives

- **Option B — table de sessions / heartbeat** (durée réelle mesurée) → **rejetée** : ajoute une
  **écriture runtime** pendant le jeu de l'enfant = touche le contrat SYNC/écriture (décision
  verrouillée = drift). Non nécessaire : la spec autorise l'approximation.
- **Jour en UTC brut** → rejeté : la frontière de minuit UTC ne correspond pas au jour vécu de
  l'enfant (une session du soir en France bascule de jour) → séries/jours joués faux.
- **Temps/jour = somme des intervalles inter-réponses plafonnés par session** (segmentation en
  fenêtres) → plus fidèle mais **plus de ⚙️** et de complexité pour un **reporting** ; l'amplitude
  bornée est l'approximation la plus simple sanctionnée par le brief. Raffinement possible au playtest
  (le contrat isole le calcul dans une fonction pure → substituable sans toucher les consommateurs).
- **Respect indexé sur le réglage de temps d'écran du foyer (7.3)** plutôt que sur une fenêtre fixe →
  rejeté ici : le nudge foyer est un **plafond d'enforcement** (7.8), pas la **fourchette saine**
  (15-20, DETAILS §3 (Temps d'écran)) que le wireframe affiche ; les coupler mélangerait reporting et enforcement.

## Conséquences

- **+** Contrat unique et fidèle, consommable identiquement par 7.4 (data) et 7.7 (UI dashboard).
- **+** Read-only strict : dérive de `attempts.createdAt`, aucune écriture, aucune migration, aucun
  impact runtime enfant. `ParentStats` gagne un champ `regularity` composé par `loadParentStats`.
- **+** Toutes les sémantiques (fuseau, plafond, écart de série, fenêtre saine) sont des ⚙️ centralisés
  (`RegularityConfig`) → calibrables au playtest sans toucher la logique.
- **−** Le temps/jour est une **approximation** (amplitude bornée), pas une mesure exacte de session —
  documenté comme tel ; à calibrer/raffiner au playtest si besoin.
- **Spec** : PLAN §Espace parent reste la référence des indicateurs ; cet ADR **précise** le calcul de
  la régularité (aucune décision verrouillée modifiée → pas de réécriture de spec, ADR canonique).
- **Suite** : story 7.7 (UI dashboard) consomme `loadParentStats().regularity` ; calibrage des ⚙️ au
  playtest (issue de suivi playtest-⚙️) ; l'**enforcement** du temps d'écran reste la story 7.8 #229.
