# Arbélune : visage rétabli, arche de l’ado à retrouver

11 septembre 2026. Passe `--arbelune-repair` terminée, résultat `arbelune-repairs/79774b6d-5655-4661-b7b9-15d114b3d8d8-result.json` : **17 images positives en QA, seul Arbélune ado refusé**. Deux dessins (152–153), dix-huit inspections (154–171), tous HTTP 200. **171 appels / 11,90 € réservés / plafond cumulé 40 € déjà autorisé.** Aucun personnage publié, aucun changement des bases. Ne pas relancer cette passe.

## Examen réel

Les nouveaux PNG ont été ouverts individuellement, ainsi que le bébé et [la planche des trois âges](arbelune-79774-three-ages.jpg). Le visage est maintenant lisible aux trois âges (`faceReadable:true`). L’adulte reprend une arche ouverte, six supports développés et un visage central contrasté : identité, croissance, milieu/originalité positifs, style 0,90. Il est **conservé comme candidat positif en QA**, sans prétendre que l’utilisateur l’a déjà approuvé artistiquement.

L’ado est une masse de bois ovoïde fermée autour d’un trou circulaire. Le bois rejoint le bas du trou, comme une tranche de bûche ou une rondelle sur pattes ; ce n’est plus l’arche ouverte du bébé et de l’adulte. Son visage passe, mais `identityMatches:false` et `growthVisible:false`, style 0. Le refus est justifié visuellement. Les seize autres images n’ont pas changé ; leurs QA restent positives, sans nouvelle approbation artistique utilisateur.

## Un seul dessin préparé

Nouvelle recette `arbelune-adolescent-plan.json`, distincte du résultat/plan précédents : **un ado**, nouveau marqueur et nouveaux fichiers. Les **17 autres images** sont conservées, y compris l’adulte d’Arbélune issu de l’appel 152, le bébé approuvé et Vrillou complet. Sources liées aux empreintes du bilan, du dernier brouillon, du marqueur, de la trace et des dix-huit PNG. La charge vérifie que seul cet ado était refusé et que le bébé/adulte avaient un visage lisible ; elle refuse un changement des références ou des verdicts.

Cette fois, la génération reçoit **les deux images réelles, dans l’ordre bébé puis adulte**, et non seulement une description. Elles fixent l’espèce et la structure de l’arche, sans imposer un âge identique. Consigne de milieu : U inversé ouvert jusqu’au sol, aucune barre de bois fermant le bas, passage large sous le corps, bande arquée fine, six racines de développement intermédiaire, visage lisible, quatre ouvertures hautes. Aucun nouveau personnage, décoration ou correction des autres espèces. Copier les pixels d’un âge source est refusé avant inspection ; la QA refuse aussi une simple copie de pose/taille ou un stade insuffisamment intermédiaire.

Les dix-huit images finales sont inspectées à neuf avec tous les pairs et les références de croissance. Visage obligatoire à 128 px aux trois âges d’Arbélune, ado comparé au bébé ET à l’adulte, adulte comparé au bébé et au nouvel ado. Aucun seuil abaissé, aucun verdict ancien réécrit, aucune nouvelle génération en boucle après refus.

## Commande et budget

Depuis `app/`, sous Node 22, Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-adolescent
```

Plan réel sans API exécuté : **1 image, 2 références réelles de génération, 17 images conservées, 18 inspections**, **1 € supplémentaire**, cumul prévu **12,90 € / 40 €**. Le budget comprend toute la QA et se vérifie avant la génération. Gardes de progression/catalogue/sources/accords/budget avant chaque appel, deux bases ouvertes en lecture seule, images et réservations anciennes préservées. Aucun nouveau besoin d’accord budgétaire.

Marqueur `arbelune-adolescent-started.json`, brouillons et résultats `arbelune-adolescents/`, galerie `preview-arbelune-adolescent-<uuid>.html`. Conserver tout en cas d’interruption/refus ; ne relancer ni `--arbelune-repair`, ni les anciennes passes. Aucun nouvel appel Gemini exécuté ici : restriction réseau de l’agent inchangée, aucun contournement tenté. Le résultat artistique de cette méthode à deux références reste à établir.

## Vérification et suite

**52 tests ciblés distincts passent** : 45 lignée/reprise (dont 6 nouveaux pour cet ado), 6 visage en vignette, 1 suivi CLI. Vérifiés : un seul appel image avec les bons pixels bébé/adulte dans le bon ordre, dix-sept arts et tous les anciens fichiers conservés, refus de copie des deux références, budget complet préalable, nouvelle QA des dix-huit images avec tous les pairs, rejet conservé sans retry, source/adulte/slot/verdicts modifiés refusés. Typage/lint/format réussis, plan réel sans API vérifié. **26 tables familiales inchangées, intégrité ok**, aucun seed/migration/restauration, sessions/possessions/stades/reçus/recalibrage/Teddy conservés.

Suite : examiner le futur ado et le groupe → refonte des mondes 0–5 déjà autorisée → stabilisation et mise en service familiale. Pas de nouvel essai utilisateur familial/WebGL ni reprise des tests historiques/couverture/canari. Prévision avec le socle 0–5 (20,50 € initiaux) : **33,40 €**, hors corrections/conception payante supplémentaires, plafond 40 €.
