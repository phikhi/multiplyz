# multiplyz — Moteur pédagogique

> Le cœur du jeu. Complément de [PLAN.md](./PLAN.md) (tables `mastery`/`attempts`) et [PRODUCT.md](./PRODUCT.md).
> Toutes les valeurs chiffrées sont **à calibrer au playtest** (notées `⚙️`).

---

## 0. Principes (verrouillés)

- **Maîtrise par calcul** (Leitner) + **révision espacée** + **fluence** (juste **ET** rapide).
- **No-fail**, erreur douce + étayage, **temps mesuré en silence**.
- **Rythme prudent** : peu de nouveaux calculs à la fois, on consolide.
- **Nombres add/sous** : v1 dans **20**, puis **élargissement auto** vers 100. **Division hors scope.**

---

## 1. Univers des faits

Un **fact** = 1 calcul atomique, clé stable. Commutatif → clé **canonique triée** (mais présenté dans les 2 ordres).

| Compétence | Domaine v1 | Clé (ex.) | ~ nb |
|---|---|---|---|
| Compléments à 10 | `a + ? = 10`, a ∈ 1..9 | `comp10_3` | ~9 |
| Addition | `a + b`, a,b ∈ 1..10 (≤ 20) | `add_3+8` (trié) | ~55 |
| Soustraction | `a − b`, a ≤ 20, b ≤ a | `sub_15-6` | ~ borné ⚙️ |
| Multiplication | `a × b`, a,b ∈ 1..10 | `mult_6x8` (trié) | ~55 |

- **Priorité initiale** : compléments à 10 + multiplication **1..8** (ses lacunes), puis 9/10.
- **Tiers d'élargissement** (échelle sans fin, cf. §8) : add/sous dans 100, puis mult 2-chiffres × 1-chiffre. **Pas de division.**

---

## 2. Modèle de maîtrise (Leitner + fluence)

**Force = boîte 0..5** (`mastery.strength`). Chaque boîte → délai de réapparition (`next_due`) :

| Boîte | Délai (≈) | Sens |
|---|---|---|
| 0 | même session | à apprendre / raté |
| 1 | 1 j | fragile |
| 2 | 2 j | en cours |
| 3 | 4 j | presque su |
| 4 | 9 j | su |
| 5 | 21 j | maîtrisé (entretien) | ⚙️

**Transitions** (sur la **1ère réponse** d'un fact dans un niveau) :
- **Juste + rapide** → `box = min(5, box+1)` (promotion).
- **Juste mais lent** → reste (`box` inchangé), `next_due` court (encore à automatiser). Pas de promotion.
- **Faux / « je ne sais pas »** → `box = max(0, box−2)` (rétrograde fort, revient vite).

**« Rapide »** = `response_ms ≤ seuil_fluence[compétence]` (ex. compléments/add 3 s, sous/mult 4 s ⚙️). `avg_response_ms` = moyenne glissante par fact.

**Définitions** :
- **Fact maîtrisé** : `box ≥ 4`.
- **Maîtrise d'une compétence** : % de ses facts à `box ≥ 4`.
- Un fact **ne peut pas atteindre la maîtrise via QCM seul** : QCM only à `box ≤ 1`, et la maîtrise exige du **rappel** (pavé) juste+rapide (cf. §6). → garde-fou anti-devinette.

---

## 3. Diagnostic de départ (~18 calculs, déguisé)

- **Répartition** : ~4–5 par compétence, sur des facts **représentatifs** (facile / moyen / difficile).
- **Adaptatif léger** : si les premiers d'une compétence sont tous ratés → on n'enfonce pas, on amorce bas ; si tous justes+rapides → on sonde 1–2 plus durs.
- **Amorçage des forces** :
  - juste + rapide → `box 3`
  - juste + lent → `box 2`
  - faux → `box 0`
  - non testé → **pas de ligne** (= « nouveau », sera introduit tôt selon le rythme).
- **Aucun score affiché.** Cadre : « on prépare ta carte ! ».

---

## 4. Composition d'un niveau (~10 questions)

**Pools** (dans le périmètre actif) :
- **DUE** : facts avec `next_due ≤ maintenant` et `box < 5`, triés par **faiblesse** (box croissant) puis **retard** (next_due le plus ancien).
- **NEW** : facts **jamais vus** (pas de ligne), dans la/les compétence(s) active(s).
- **MAINT** : facts `box 5` dont l'entretien arrive (réapparition ~21 j).

**Mix cible** : ~**70 % DUE/faibles** + ~**30 % NEW/MAINT**, sous **cap de nouveaux** (rythme prudent, §7).

```text
construireNiveau(profil):
  scope   = compétencesActives(profil)        # §7 bloqué→interleaving
  due     = pool DUE ∩ scope, trié(faiblesse, retard)
  weak    = nb facts box≤1 dans scope
  capNew  = (weak >= SEUIL_CONSO ? 0 : NEW_MAX_PAR_NIVEAU)   # ⚙️ ex. SEUIL_CONSO=8, NEW_MAX=2
  items = []
  items += prendre(due, 7)                     # priorité consolidation
  items += prendre(NEW ∩ scope, capNew)        # introduit peu de nouveaux
  items += prendre(MAINT ∩ scope, reste)       # entretien
  si len(items) < 10:                          # début de jeu : peu de DUE
     items += prendre(NEW ∩ scope, jusqu'à 10, en respectant capNew)
  si items == []:                              # IMPASSE : DUE ∅ ∧ MAINT ∅ ∧ capNew=0
     items += repliImpasse(scope)              # box<5 les plus proches de l'échéance (§7, ADR 0006)
  ordonner(items): facile → un peu plus dur → finir sur un presque-su  # finir sur une victoire
  garantir: pas 2× le même fact d'affilée ; pas de doublon (sauf re-ask après erreur)
  garantir: **un niveau n'est JAMAIS vide** (no-fail, cf. repliImpasse ci-dessous)
  return items[:10]
```

- **Re-ask intra-niveau** : un fact raté **revient une fois** plus loin dans le même niveau (renforcement court terme), sans recompter la maîtrise.
- **Repli d'impasse — un niveau n'est JAMAIS vide** (no-fail, PRODUCT §5 ; ADR 0006, issue #108). La combinaison **DUE ∅ ∧ MAINT ∅ ∧ `capNew = 0`** (tous les faits `box ≤ 1` fragiles ont atteint `SEUIL_CONSO`, mais **aucun n'est encore dû** par l'espacement, et rien n'est en entretien) rendait un niveau **vide** — injouable. `repliImpasse` remonte alors les faits **`box < 5`** les **plus proches de leur échéance** (`next_due − now` le plus petit), jusqu'à 10 : consolide **exactement** les faits weak que le gate veut résorber (juste un peu en avance), **préserve l'espacement** des faits réellement dus (il n'y en a aucun), n'introduit **aucun NEW** non planifié. Ne se déclenche **que** si la sélection nominale est vide (aucune régression du cas nominal). Seul un périmètre **sans aucun fait remontable** (scope vide, ou 100 % NEW / entretien non dus) reste vide.

---

## 5. Étoiles & fin de niveau

- Étoiles selon **justesse** de la 1ère réponse (pas la vitesse) : ex. ≥60 % = ⭐, ≥85 % = ⭐⭐, 100 % = ⭐⭐⭐ ⚙️.
- Récompenses : cf. [ECONOMY.md](./ECONOMY.md). Aucun « échec » : on termine toujours.

---

## 6. Format QCM ↔ pavé + distracteurs

- **Choix du format** : `box ≤ 1` → **QCM 4 choix** ; `box ≥ 2` → **pavé** (rappel libre).
- **Distracteurs QCM** = erreurs **typiques** (jamais aléatoires), 3 plausibles, uniques, ≥ 0, proches de la réponse :

| Compétence | Distracteurs typiques |
|---|---|
| Multiplication `a×b` | `a×(b±1)` (ligne voisine), `a+b` (confusion d'op), chiffres inversés du résultat, table voisine |
| Addition `a+b` | `±1`, `±10`, `a−b` (confusion), résultat aux chiffres inversés |
| Soustraction `a−b` | `a+b` (confusion), `±1`, `b−a` inversé |
| Compléments à 10 | nombre qui **ne** fait pas 10, `±1` |

```text
distracteurs(fact):
  cands = règlesTypiques(fact)         # selon compétence
  cands = filtrer(cands: ≠ bonneRéponse, ≥0, plausibles)
  uniques, compléter si <3 avec ±1/±2 valides
  return mélange([bonneRéponse] + 3 distracteurs)
```

---

## 7. Bloqué → interleaving (mélange progressif) + rythme

- **Départ = BLOQUÉ** : un niveau = **1 compétence** (la plus faible / en rotation douce). Rassurant.
- **Bascule interleaving** quand maîtrise globale du périmètre actif ≥ ~**40 %** de facts à `box ≥ 3` (⚙️) → niveaux mêlent **2** compétences, puis **3–4** à mesure que la maîtrise monte. On garde un **léger focus sur la plus faible**.
- **Rythme prudent** :
  - `NEW_MAX_PAR_NIVEAU` ≈ **2**, `NEW_MAX_PAR_JOUR` ≈ **5** ⚙️.
  - Si `nb facts box≤1 ≥ SEUIL_CONSO` (⚙️ ~8) → **0 nouveau**, consolidation pure jusqu'à résorption.
  - **Impasse de consolidation** (ADR 0006, issue #108) : le gate `0 nouveau` peut, combiné à l'espacement Leitner, produire une **impasse** — les faits fragiles ont atteint `SEUIL_CONSO` (donc `capNew = 0`) **mais ne sont pas encore dus** (échéance future), et rien n'est en entretien → **DUE ∅ ∧ MAINT ∅ ∧ capNew = 0** → niveau vide. Le **repli d'impasse** (cf. §4) remonte alors les faits `box < 5` les plus proches de leur échéance : la consolidation n'a de sens que s'il y a du DUE à consolider **maintenant** ; à défaut, on avance de quelques heures la révision des mêmes faits weak plutôt que de rendre un niveau vide (**no-fail** prime). Aucun NEW introduit, espacement des faits réellement dus préservé.

---

## 8. Échelle d'élargissement (sans fin)

| Tier | Contenu | Déclencheur |
|---|---|---|
| 1 (v1) | compléments10 · add ≤20 · sous ≤20 · mult 1..10 | — |
| 2 | add/sous dans **100** (2 chiffres ±1, puis ±2 chiffres) | ≥ **85 %** des facts Tier 1 à `box ≥ 4` ⚙️ |
| 3 | mult **2 chiffres × 1 chiffre** | ≥ 85 % Tier 2 maîtrisé ⚙️ |

- **Division : hors scope** (volontaire).
- **Entretien à vie** : les tiers maîtrisés continuent de réapparaître (box 5 ~21 j) → pas d'oubli.

---

## 9. No-fail, « je ne sais pas », anti-triche

- **1ère réponse** = celle qui compte pour la maîtrise. Faux / « je ne sais pas » → rétrograde + étayage + **re-essai** (pratique, non comptée).
- `response_ms` = du moment où la question s'affiche à la 1ère réponse.
- **Anti-triche** : réponse **très rapide** (< ~600 ms ⚙️, **juste ou fausse**) = martèlement/devinette → **jamais** de promotion (détecté via fluence, cf. §2 : une réponse sous ce seuil n'est jamais comptée fluente). Rapide et faux reste faux (rétrograde) ; rapide et **juste** reste compté **juste** mais retombe sur « juste mais lent » (boîte inchangée, sans crédit de maîtrise) — pas de traitement punitif, seulement pas de promotion. La transition **QCM→pavé** empêche d'« inflater » la maîtrise en devinant.

---

## 10. Données touchées (cf. PLAN)

- `attempts` : 1 ligne / réponse (`fact_id, skill, correct, response_ms, is_retry, created_at`).
- `mastery` : `strength`, `avg_response_ms`, `correct/wrong_count`, `last_seen`, `next_due` mis à jour sur la 1ère réponse.
- Toute la logique **côté serveur** (source de vérité), **online-first** (cf. [SYNC.md](./SYNC.md)).

---

## 11. Paramètres à calibrer (`⚙️`)

| Param | Départ |
|---|---|
| Délais boîtes (j) | 0 · 1 · 2 · 4 · 9 · 21 |
| Seuil fluence | compléments/add 3 s · sous/mult 4 s |
| Promotion | juste+rapide → +1 ; faux → −2 |
| `NEW_MAX_PAR_NIVEAU` / jour | 2 / 5 |
| `SEUIL_CONSO` (box≤1) | 8 |
| Bascule interleaving | 40 % à box≥3 |
| Déclencheur Tier suivant | 85 % à box≥4 |
| Seuils étoiles | 60 / 85 / 100 % |
| Anti-mash | < 600 ms |
| Diagnostic | ~18 calculs |

---

## 12. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Modèle | Leitner 6 boîtes + révision espacée + **fluence** |
| Maîtrise | **Juste + rapide** (automatisation réelle) |
| Add/sous | Dans **20**, élargissement auto vers 100 |
| Rythme | **Prudent** (cap nouveaux + consolidation forcée) |
| Diagnostic | **~18** calculs, déguisé, sans score |
| Format | QCM (box≤1) → pavé (box≥2) ; pas de maîtrise via QCM seul |
| Mélange | Bloqué → interleaving (progressif) |
| Élargissement | Tiers sans fin ; **division hors scope** |
