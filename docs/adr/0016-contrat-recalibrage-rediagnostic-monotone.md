# 16. Contrat de recalibrage : re-diagnostic MONOTONE (max-merge)

- **Statut** : accepté
- **Type** : pedago (contrat du modèle de maîtrise) — **précise** le contrat, ne modifie **aucune** décision verrouillée
- **Portée** : majeure (drift pédagogie arbitré par le propriétaire — issue #237 → **Option A**)
- **Liens** : issue #237 (drift ENGINE) · issue #219 (story 7.6) · PR (cette story) · spec [ENGINE.md](../../ENGINE.md) §2/§3 · [PRODUCT.md](../../PRODUCT.md) §3.6 :30/:38/:108 · [DETAILS.md](../../DETAILS.md) §3 :29

## Contexte

`DETAILS.md` :29 et `PRODUCT.md` :30 prévoient un contrôle parent **« Recalibrer : relancer un
mini-diagnostic »**. Mais c'est une **description d'UI**, pas un **contrat moteur** : `ENGINE.md` §3
(`diagnostic.ts:seedDiagnosticMastery`) ne spécifie que l'**amorçage INITIAL** d'un profil **vierge**
(box amorcées {3 juste-rapide / 2 juste-lent / 0 faux}, fait non testé → pas de ligne). **Aucun
passage ne dit ce qui arrive à un `mastery` DÉJÀ établi lors d'une relance** (reset total ? partiel ?
ré-amorçage par-dessus ? conservation ?).

Le modèle de maîtrise porte un **invariant VERROUILLÉ** : **progression monotone, jamais de
régression** (`ENGINE.md` §2, `PRODUCT.md` :38 « Progression monotone (jamais de régression) »).
Plusieurs comportements de recalibrage **violeraient** cet invariant (rétrograder une boîte 5
acquise). Choisir le comportement = **trancher une sémantique pédagogique du modèle verrouillé** →
hors autonomie orchestrateur (ADR 0004) → escaladé en **drift** (issue #237). Le propriétaire a
tranché : **Option A**.

## Décision

On fige le **contrat de recalibrage** = **re-diagnostic MONOTONE (max-merge)**. Le parent **arme** un
drapeau ; à la prochaine partie l'enfant **re-joue** le même mini-diagnostic (~18 faits représentatifs,
sélection `selectDiagnostic` inchangée) ; à la soumission, les réponses sont **fusionnées** avec la
maîtrise courante **sans jamais rétrograder**. **0 changement de la sémantique de maîtrise, 0
violation d'invariant.**

1. **Déclencheur parent** — une action « Recalibrer » (Réglages parent, sous garde de session
   parent) **arme** un drapeau `profiles.recalibration_requested` sur **le profil enfant du foyer**
   (v1 mono-profil ; résolu comme `session.profileId`, même résolution que le tableau de bord). Elle
   n'écrit **que** le drapeau (jamais `mastery`/`attempts`) : la maîtrise ne bouge qu'après que
   l'enfant a re-joué le diagnostic.

2. **Re-présentation à l'enfant** — le gate de diagnostic (`diagnosticPlanAction`) présente le
   mini-diagnostic si `needsDiagnostic` (1ʳᵉ session, `mastery` vide) **OU** `recalibration_requested`
   (armé), **même** quand `mastery` est non vide. Le plan posé est **le même** `selectDiagnostic`
   déterministe (ENGINE §3).

3. **Fusion MONOTONE (max-merge)** — pour **chaque fait re-sondé** (`seed = seedBox(réponse)` : 3
   fluent / 2 lent / 0 faux, **même** classement `isFluent` que l'amorçage) :
   - **aucune ligne courante** (jamais amorcé) → **CREATE** : ligne **identique à l'amorçage initial**
     (`seedMasteryRow`, box = seed, compteurs 1, `avg = response_ms`, `next_due = now + délai(seed)`,
     `last_seen = now`) — `[0 → seed, monotone]` ;
   - **ligne courante, `seed > box_courant`** → **RAISE** : `box := seed`, `next_due := now +
     délai(seed)`, `last_seen := now`. Les **compteurs** (`correct/wrong_count`) et `avg_response_ms`
     restent **INCHANGÉS** — la sonde de calibrage ne doit **pas** polluer la justesse/rapidité
     rapportées (les agrégats parent dérivent du vrai jeu `attempts`, ADR 0012/0014) ;
   - **ligne courante, `seed ≤ box_courant`** → **AUCUNE écriture** (« keep ») : jamais de rétrograde,
     jamais de perturbation de l'espacement d'un fait déjà mieux placé ;
   - **fait non re-sondé** → **INCHANGÉ**.
   La **correction VERS LE BAS** (enfant surestimé) reste gérée par le **rétrograde Leitner normal**
   (`−demoteBoxes` sur faux, `PRODUCT.md` :108) **pendant le jeu**, **jamais** par le recalibrage.

4. **Atomicité** — la fusion (`seedRecalibration`) applique les upserts `mastery` **PUIS** efface le
   drapeau (`recalibration_requested := false`) dans **UNE** transaction synchrone (better-sqlite3,
   anti-TOCTOU). La demande est consommée **exactement une fois** ; si l'effacement échoue, toute la
   fusion est **annulée** (rollback), aucun état partiel. Une **garde « armé »** (re-lue dans la
   transaction) rend un re-seed hors demande un **no-op** strict → idempotent, TOCTOU-safe.

5. **Écritures** — le recalibrage n'écrit **QUE** `mastery` + le drapeau `profiles` — **jamais**
   `attempts` (parité exacte avec le diagnostic initial, sonde hors comptage de justesse/fluence).

## Alternatives (rejetées, cf. #237)

- **Option B — reset total** (efface `mastery`, re-diagnostic comme un profil neuf) → **rejetée** :
  **viole la monotonie** (perte des boîtes 21 j acquises), frustrant. N'aurait été acceptable qu'avec
  un amendement EXPLICITE de l'invariant ENGINE §2.
- **Option C — ré-amorçage par-dessus** (`box := seedBox` inconditionnel) → **rejetée** : peut
  **rétrograder** → viole la monotonie.
- **Option D — recalibrer seulement des paramètres moteur** (tiers/seuils, garder `mastery`) →
  **rejetée** : ne correspond pas à « relancer un mini-diagnostic », aucun paramètre per-profil exposé.
- **Écrire `attempts` pour la sonde de recalibrage** → **rejetée** : polluerait la justesse/rapidité
  rapportées (ADR 0012/0014) ; le diagnostic initial ne les écrit pas non plus.

## Conséquences

- **+** **Invariant monotone préservé** (ENGINE §2) : le recalibrage devient un « coup de pouce
  correctif » pour un diagnostic initial trop bas — jamais une régression. **0 décision verrouillée
  modifiée** (cet ADR **précise** le contrat, il ne le change pas).
- **+** Le contrat est **DÉRIVÉ** de l'amorçage existant : la création réutilise `seedMasteryRow`
  (source unique), le classement réutilise `isFluent`/`seedBox`, les délais réutilisent `boxDelayMs`
  — aucun barème réinventé.
- **+** Fonction pure `recalibrateMastery` (testable, déterministe) + service transactionnel
  `seedRecalibration` (atomicité, garde armé) ; le drapeau `profiles.recalibration_requested` est un
  **paramètre opérationnel** (bool), pas un ⚙️ de calibrage.
- **−** Une **colonne additive** sur `profiles` (`recalibration_requested`, NOT NULL DEFAULT false,
  migration 0014 — sûre sur table peuplée, #105) et un nouveau chemin de seed à maintenir.
- **Spec** : `ENGINE.md` §3 gagne un paragraphe « re-diagnostic monotone » ; `PRODUCT.md` §3.6 et
  `DETAILS.md` :29 renvoient à ce contrat (ADR **canonique** du recalibrage).
- **Suite** : calibrage éventuel au playtest (fréquence d'usage réelle du recalibrage par le parent) ;
  multi-profil (v2) recalibrera par profil ciblé (le drapeau est déjà per-profil).
