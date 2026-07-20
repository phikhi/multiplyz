# Gabarit — Parcours d'acceptation bout-en-bout

> Réutilisable pour **chaque** clôture de feature/épic (WORKFLOW §21.c). Copier ce fichier vers
> `docs/playthroughs/<epic>.md` (ex. `R1.md`, `R2.md`…), remplir chaque section, **committer** +
> **poster en commentaire sur l'issue épic** (condition matérielle de la signature — un playthrough
> qui ne vit que dans un contexte de conversation est un reçu invérifiable, #164).

## Métadonnées

| Champ | Valeur |
|---|---|
| Épic / feature | `#___` — nom |
| Date | AAAA-MM-JJ |
| Base testée | `main` `<sha>` (ou branche de la story de clôture) |
| Environnement | `pnpm dev` (préciser tout écart) + navigateur piloté (`agent-browser` / Playwright) |
| Profil enfant utilisé | nom, méthode de création (onboarding réel / seed) |
| Pilote | agent / proprio |

## Méthode (ne pas sauter d'étape)

1. **Lire d'abord** : `WORKFLOW.md §21`, les specs de la feature/épic concernée (`PRODUCT.md`,
   `ENGINE.md`, `MAP.md`, `ECONOMY.md`…), `LEARNINGS.md` (pièges connus).
2. **Piloter réellement l'app** dans un vrai navigateur, sur le **vrai art** (jamais un fixture de
   test — WORKFLOW §21.b), avec un `pnpm dev` (ou équivalent) qui tourne pour de vrai. Pas de
   lecture de code substituée à l'observation runtime.
3. Suivre le flow **comme l'enfant** : `login → carte (hub) → niveau → feedback → résultats →
   retour carte → collection` (PRODUCT §1.3). Documenter **où l'app atterrit réellement** à chaque
   transition, même quand ça diverge du flow spec.
4. **Capturer** (screenshot réel, jamais généré/imaginé) chaque écran significatif — succès ET
   défauts. Les captures vivent dans `docs/playthroughs/captures/<epic>/`.
5. **Analyser chaque capture** : ne pas se contenter de la générer — l'ouvrir, décrire ce qu'elle
   montre réellement (art vrai vs placeholder, Teddy présent/absent, occlusion, contraste…).
6. Remplir la **checklist nommée** ci-dessous avec un verdict par point, preuve à l'appui (capture
   n°, ligne de code, requête DB).
7. Conclure par un **verdict global honnête** — jamais une embellie. Un playthrough qui prétend que
   tout marche alors que ce n'est pas vécu par l'enfant est exactement le défaut que ce gate existe
   pour empêcher (CLAUDE.md #164/#180).

## Flow suivi

Documenter chaque étape réellement traversée (ajouter/retirer des lignes selon la feature) :

| # | Étape attendue (spec) | Ce qui s'est réellement passé | Capture |
|---|---|---|---|
| 1 | Login (choix profil + PIN) | | |
| 2 | Atterrissage post-login | | |
| 3 | Carte (hub) | | |
| 4 | Entrée dans un niveau | | |
| 5 | Feedback (bonne/mauvaise réponse) | | |
| 6 | Résultats (étoiles/pièces) | | |
| 7 | « Continuer » après résultats | | |
| 8 | Retour carte | | |
| 9 | Collection | | |

## Checklist nommée (WORKFLOW §21.c)

Chaque point = **vécu**, pas seulement testé. Verdict `OUI` / `NON` / `PARTIEL`, avec preuve.

- [ ] **Carte réellement atteinte par le flux normal** (login → carte hub), pas seulement `/carte`
      en accès direct.
- [ ] **Teddy visible dans la boucle de jeu** (accueil / feedback / résultats), pas juste une voix
      (ton d'écriture COPY ≠ personnage visible).
- [ ] **Art créature RÉEL affiché** en collection (pas `CreaturePlaceholder`/`placeholder://…`
      inconditionnel).
- [ ] **Boucle économique pièces→dépense bouclée** (les pièces gagnées ont un but réel — pas
      seulement accumulées).
- [ ] **Habillage / charte visuelle présent** sur les écrans de la feature (pas un scaffold nu —
      cartes blanches, étoiles Unicode, 0 décor).

## Captures analysées

Pour chaque capture jointe : chemin, ce qu'elle montre, et le verdict qu'elle appuie.

| Capture | Ce qu'elle montre | Appuie quel point de la checklist |
|---|---|---|
| `captures/<epic>/NN-nom.png` | | |

## Verdict baseline / delta

- Qu'est-ce que **cette** feature/épic a changé par rapport au playthrough précédent (citer le
  fichier `docs/playthroughs/<epic-précédent>.md`) ?
- La **valeur produit centrale** de la feature est-elle **atteinte par l'enfant bout-en-bout** ?
  (CLAUDE.md #180 — pas seulement chaque story individuellement verte).
- Trous restants → filer une **issue `discovered`/`needs-owner`** (jamais absorbés silencieusement).

## Signature (WORKFLOW §21.c)

Le playthrough est signé par **game-design** ET **product-owner** — distinct de la review
story-level. Chaque signataire ajoute son verdict + la date.

| Rôle | Verdict | Commentaire | Date |
|---|---|---|---|
| game-design | | | |
| product-owner | | | |

**Condition matérielle** : ce fichier committé dans `docs/playthroughs/` **et** posté en commentaire
sur l'issue épic correspondante.
