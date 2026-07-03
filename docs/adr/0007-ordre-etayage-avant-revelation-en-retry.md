# 0007. Ordre étayage → révélation numérique en re-essai (`FeedbackPanel`)

- **Statut** : accepted
- **Type** : product
- **Portée** : majeure (drift — flow verrouillé PRODUCT §2.2 / WIREFRAMES §3d, décision propriétaire cf. issue #100)
- **Liens** : issue [#100](https://github.com/phikhi/multiplyz/issues/100) · PR [#117](https://github.com/phikhi/multiplyz/pull/117) · spec(s) impactée(s) : `PRODUCT.md` §2.2, `WIREFRAMES.md` §3d, `ENGINE.md` §9

## Contexte

En phase `retry` du `FeedbackPanel` (`src/components/game/FeedbackPanel.tsx`), la
**révélation numérique** de la bonne réponse (« La bonne réponse : {n} ») était affichée
**AVANT / au-dessus** de l'**étayage visuel** (`VisualScaffold` : dix-cases `comp10`,
droite numérique `add`/`sub`, matrice `mult`), héritage du **contrat de fondation #93**
(épic #4).

Conséquence pédagogique (relevée en review de PR #99, story #94, game-design APPROVE
non-bloquant → **issue #100 discovered**, transverse à tout l'épic #4) : l'enfant lit le
**chiffre-résultat** avant de voir le modèle censé le lui faire **découvrir**. L'étayage
(dix-cases, droite numérique, matrice) sert à faire « **voir** » la réponse par la
représentation/manipulation (construction du sens) ; révéler le chiffre en premier le
**réduit à une illustration décorative après coup** plutôt qu'à un **outil de découverte**.
L'enjeu est **transverse** : le schéma est identique pour comp10 (#94), add/sub (#95),
mult (#96) — hérité de #93, hors scope de chaque story individuelle.

Le réordonnancement touche un **flow verrouillé** (PRODUCT §2.2 « expérience retry »,
WIREFRAMES §3d « ordre d'affichage ») → **pédagogie** → escalade en **drift**, non
absorbable dans #94/#95/#96 (anti-drift). D'où l'arbitrage propriétaire (issue #100).

## Décision

**INVERSER** (tranché par le propriétaire, commentaire sur #100) : en phase `retry`,
montrer l'**étayage visuel D'ABORD** (l'étayage-découverte fait « voir » le calcul par la
représentation), **PUIS la révélation numérique de la bonne réponse en synthèse APRÈS**.

- **Ordre visuel ET DOM** : `1) VisualScaffold` (premier, élément principal) → `2)`
  révélation numérique (conclusion, sous l'étayage).
- **No-fail INTACT** (ENGINE §9, PRODUCT §5) : la bonne réponse reste **toujours** montrée
  en re-essai (jamais retirée) — elle est **seulement déplacée après l'étayage**, jamais
  supprimée. Le re-essai reste **non compté** (`isRetry`), le calcul marqué faible.
- **Point d'ancrage unique** : l'ordre s'applique **uniformément aux 4 compétences** via
  le `FeedbackPanel` (seul lieu de rendu du couple étayage+révélation), **pas par-scaffold**
  — aucun `VisualScaffold` ni composant concret (`TenFrame`/`NumberLine`/`Matrix`) modifié.
- **Microcopy adaptée** (strings centralisées, voix de Teddy, tutoiement) : la révélation
  se lit désormais comme une **conclusion** (« Et voilà, ça fait {n} ! ») et non comme la
  réponse jetée en tête (« La bonne réponse : {n} »). Registre existant conservé.
- **Aucune extension du contrat serveur** : `LevelQuestion` inchangé, moteur intouché
  (comme toute l'épic #4).
- **A11y (contrat hérité #94)** : un seul `role="img"` sur `VisualScaffold` (scaffolds
  internes décoratifs, `aria-hidden`), le nom accessible porte l'info numérique.
  L'inversion d'ordre garde l'ordre de lecture lecteur-d'écran cohérent : message
  d'encouragement → étayage (nom accessible = info numérique) → révélation en synthèse.

## Alternatives

- **Statu quo (révélation d'abord, héritage #93)** : **rejetée** par le propriétaire —
  réduit l'étayage à une illustration décorative, contredit l'intention ENGINE
  (« l'étayage fait voir le calcul »).
- **Retirer la révélation numérique en re-essai** (ne montrer que l'étayage) : **rejetée**
  — casse le **no-fail** (PRODUCT §5 : la bonne réponse doit toujours être montrée en
  re-essai, ENGINE §9). Non envisagée par le propriétaire.
- **Réordonner par-scaffold** (chaque composant concret gère son ordre) : **rejetée** —
  disperse la règle sur 3 composants (dérive, incohérence possible entre compétences) au
  lieu du point d'ancrage unique `FeedbackPanel`.

## Conséquences

- **+** Valeur pédagogique de l'étayage maximisée : construction du sens **AVANT** le
  résultat, cohérent avec l'intention ENGINE (« l'étayage comme outil de découverte »).
- **+** Hiérarchie visuelle cohérente : l'étayage est l'élément **premier et principal**,
  la révélation lit comme une **synthèse** (« donc c'est … »).
- **+** No-fail préservé, contrat serveur intouché, a11y #94 préservée (un seul
  `role="img"`, ordre de lecture cohérent).
- **−** La révélation numérique n'est plus « au premier coup d'œil » — assumé : c'est
  précisément l'intention (découvrir par la représentation d'abord).
- **Specs mises à jour** (canoniques) : `PRODUCT.md` §2.2 (ordre étayage → synthèse),
  `WIREFRAMES.md` §3d (ASCII + bullet d'ordre d'affichage).
- **Garde testée à effet observable** (CLAUDE.md §Tests/CI) : test unitaire
  `FeedbackPanel.test.tsx` asserte que l'étayage **précède** la révélation dans l'ordre du
  document (`compareDocumentPosition` / `DOCUMENT_POSITION_FOLLOWING`) ET que la bonne
  réponse reste **toujours présente** (no-fail) — **échoue** si l'ordre est remis à
  l'ancien (mutation). Doublé en E2E (`e2e/auth.spec.ts`, capture
  `100-etayage-avant-revelation.png`), next-dev-loop indispo #24.
- **Suite** : l'effet réel de l'ordre sur la découverte reste à observer au **playtest**
  (le vrai juge) — l'ordre est un choix pédagogique validé par le propriétaire, à
  confirmer par la rétention/progrès de l'enfant.
