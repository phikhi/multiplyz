# 12. Contrat de calcul des agrégats de l'espace parent (reporting)

- **Statut** : accepté
- **Type** : product (sémantiques de reporting) — dérivé, ne modifie aucune décision moteur
- **Portée** : mineure (architect-review autonome — in-contract, aucune décision ENGINE/PLAN verrouillée touchée)
- **Liens** : issue #215 (story 7.2) · spec [PLAN.md](../../PLAN.md) §Espace parent :79-84 · [ENGINE.md](../../ENGINE.md) §2/§5/§9 · [PRODUCT.md](../../PRODUCT.md) §1.4/§5

## Contexte

L'espace parent (PLAN §Espace parent) affiche quatre indicateurs **alimentés uniquement par
`attempts` + `mastery`** (PLAN :77/:113) : **justesse**, **rapidité/fluence**, **carte de maîtrise**,
**à revoir**. Les specs **figent les indicateurs** (leur liste, PLAN :79-84) et **verrouillent le
modèle pédagogique** (maîtrise `box ≥ 4` ENGINE §2 ; justesse = la **correction**, pas la vitesse,
PRODUCT §5 :138 / ENGINE §5). Mais les specs **ne figent pas les sémantiques de reporting** :
qu'est-ce qu'une « semaine », comment calculer une « tendance », quels faits sont « à revoir »,
quelles fenêtres/seuils. Sans contrat, chaque story (7.2 data, 7.7 UI) risquerait de diverger.

Ces sémantiques doivent être **dérivées** du moteur — le rapporter fidèlement, jamais le réinventer —
et **centralisées en config ⚙️** (calibrables au playtest, jamais en dur).

## Décision

On fige le **contrat de calcul** consommé par `src/lib/parent/stats.ts` (agrégats purs, read-only).
Toutes les valeurs sont dans `ReportingConfig` (`src/config/server-config.ts`), le moteur restant la
source de la **maîtrise** et de la **fluence** (`EngineConfig`, réutilisé, jamais redéfini).

1. **Justesse** = `1ʳᵉˢ réponses justes / total des 1ʳᵉˢ réponses`, global + par compétence. Les
   **re-essais** (`attempts.is_retry = true`) sont **exclus** : ce sont une « pratique **non
   comptée** » (ENGINE §9), exactement comme pour la maîtrise. Aucune 1ʳᵉ réponse → `null` (pas de
   `0 %` trompeur). C'est la **correction**, pas la vitesse (PRODUCT §5).

2. **Rapidité/fluence** = **moyenne des `response_ms`** des 1ʳᵉˢ réponses (`is_retry = false`),
   global + par compétence — **même population** que `mastery.avg_response_ms` (parité avec la
   fluence stockée par le moteur). Arrondie à l'entier. `null` si aucune 1ʳᵉ réponse.

3. **Tendance** (« semaine glissante ») = comparaison de la fenêtre **courante** `(now − N j, now]`
   à la **précédente** `(now − 2N j, now − N j]`, `N = trendWindowDays` (⚙️, défaut 7). Une fenêtre
   sans donnée → tendance **indécidable = stable** (jamais inventée). Une **zone morte** ⚙️
   (`trendAccuracyDelta` en points de justesse, `trendSpeedDeltaMs` en ms) évite de sur-interpréter
   le bruit. **Polarité par indicateur** : justesse **monter = s'améliorer** ; rapidité **baisser =
   s'améliorer** (automatisation, ENGINE §2).

4. **Carte de maîtrise** = par compétence, `skillMasteryRatio` (ENGINE §2, faits à `box ≥ 4`) sur
   **tout l'univers Tier 1** de la compétence — les faits **jamais vus comptent au dénominateur
   comme non maîtrisés**, exactement comme les gates ENGINE §2/§7/§8 (interleaving, déclencheur de
   Tier). Classement par seuils ⚙️ : `≥ masteredMinRatio` → **maîtrisé** ; `≥ inProgressMinRatio` →
   **en cours** ; sinon **faible**.

5. **À revoir** = faits **déjà vus**, **non maîtrisés** (`box < 4`) et **problématiques** — au moins
   **ratés** (`wrong_count > 0`) ou **lents** (`avg_response_ms >` le **seuil de fluence du moteur**
   de la compétence, `EngineConfig.fluenceThresholdsMs`). Triés par priorité de remédiation (boîte
   croissante, puis erreurs décroissantes, puis lenteur décroissante, départage déterministe par
   clé), puis **bornés** à `reviewListSize` (⚙️).

**Ces définitions sont DÉRIVÉES et ne changent AUCUNE décision ENGINE/PLAN verrouillée** : la
maîtrise reste `box ≥ 4`, la justesse reste la correction, les seuils de fluence restent ceux du
moteur. `ReportingConfig` ne pilote **que** l'affichage parent. Les valeurs par défaut échoient
intentionnellement des seuils moteur familiers (maîtrisé 0.85 = déclencheur de Tier ENGINE §8 ; en
cours 0.4 = bascule interleaving ENGINE §7) mais restent **calibrables indépendamment**.

## Alternatives

- **Justesse incluant les re-essais** → rejeté : sur-/sous-estime la justesse par rapport à ce que le
  moteur note (1ʳᵉ réponse), infidèle à ENGINE §9 (« pratique non comptée »).
- **Maîtrise d'une compétence sur les seuls faits vus** (dénominateur = faits rencontrés) → rejeté :
  divergerait des gates du moteur (une compétence à 1 fait vu et maîtrisé afficherait « 100 %
  maîtrisée ») — over-claim de maîtrise, infidèle à ENGINE §2/§7/§8.
- **Seuil « lent » propre au reporting** → rejeté : réinventerait la fluence ; on réutilise
  `EngineConfig.fluenceThresholdsMs` (source unique).
- **Tendance sans zone morte / sans polarité** → rejeté : rapporterait du bruit comme une tendance,
  et « rapidité en hausse » (temps qui monte) serait lu à tort comme un progrès.

## Conséquences

- **+** Contrat unique et fidèle au moteur, consommable identiquement par 7.2 (data) et 7.7 (UI).
- **+** Toutes les sémantiques sont des ⚙️ centralisés (`ReportingConfig`) → calibrables au playtest
  sans toucher la logique (CLAUDE.md « params centralisés »).
- **+** Read-only strict : les agrégats n'écrivent jamais en DB (aucun impact runtime enfant).
- **−** Un nouveau bloc de config (`ReportingConfig`) à maintenir ; couplage assumé des agrégats sur
  `EngineConfig` (sens correct : le reporting lit le modèle, ne le redéfinit pas).
- **Spec** : PLAN §Espace parent reste la référence des indicateurs ; cet ADR **précise** leur calcul
  (aucune décision verrouillée modifiée → pas de réécriture de spec, ADR canonique du reporting).
- **Suite** : story 7.7 (UI dashboard) consomme `loadParentStats` ; calibrage des ⚙️ au playtest
  (issue de suivi playtest-⚙️).
