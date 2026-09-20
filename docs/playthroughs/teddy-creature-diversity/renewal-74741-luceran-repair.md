# Monde 0 : avis favorable, six bébés conservés, Lucéran à distinguer

## Résultat réel et avis utilisateur

La passe `74741b07-c18e-4ead-8d83-1fe22b21bb13` est terminée : sept images, sept inspections, six verdicts positifs et un refus. **224 appels enregistrés / 15,05 € réservés / plafond cumulé 40 € déjà autorisé.**

L’utilisateur répond **« c’est bon »** après la commande des bébés. Cet avis visuel favorable est enregistré séparément dans `data/teddy-world-pilot/renewal/0/baby-visual-review.json`, lié au groupe exact. Il ne transforme pas le refus automatique en validation. Les six bébés acceptés et positifs en QA sont conservés : Mycélou, Tavelle, Orsil, Pivertin, Fougrette et Tormille. Aucune nouvelle validation artistique de ces six images à redemander.

Lucéran a `habitatMatches:true` mais `visuallyDistinct:false`, style 0 et règle `style_coherence`. La QA ne nomme pas le voisin concerné. La [comparaison locale avec Coquillette du monde 4](luceran-74741-coquillette.png) montre une construction proche : grosse tête séparée, antennes, ailes et abdomen lumineux. Le [groupe des sept bébés](renewal-74741-babies.png) et les anciens bébés du catalogue ont été ouverts et examinés. Aucune assertion que le dessin est une copie exacte.

## Correction préparée

Une seule nouvelle image de **Lucéran**, avec un corps de petit sauteur du sous-bois : silhouette basse et aplatie, quatre plaques dorsales, petite face crème intégrée à l’avant, six pieds, deux courtes antennes, éventail lumineux à l’arrière et fourche de saut repliée sous le ventre. Pas d’ailes ni de grosse tête ronde séparée. Les descriptions des trois âges développent progressivement ces mêmes structures et les proportions du corps. Son rôle reste lié aux passages du sous-bois humide ; son nom, sa rareté et sa correspondance restent conservés.

La recette distincte `renewal/0/baby-repair-plan.json` lie la correction au marqueur, au brouillon, au bilan, à l’avis visuel, à la trace et aux sept PNG sources. Le plan initial et toutes les images restent exacts, y compris l’ancien Lucéran refusé. Le chargement exige un seul refus de ressemblance, vérifie les six autres verdicts, et refuse des sources ou un catalogue modifiés.

Depuis `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-baby-repair
```

Plan réel sans API déjà vérifié : `--renewal-0-baby-repair-plan`. Les appels Gemini réels restent à lancer dans ce Terminal ; le réseau agent est toujours bloqué, aucun nouvel appel ni contournement tenté.

Coût maximal : **1 image + 7 inspections = 0,45 €**, **cumul 15,50 € / 40 €**. Le groupe complet tient dans le budget avant le départ. Lucéran est inspecté en premier contre le catalogue, le pilote accepté et ses six pairs. S’il échoue, la passe s’arrête après cette inspection : 0,15 € réservés, cumul 15,20 €. S’il passe, les six pairs sont réinspectés avec le nouveau dessin. `fullValidation:true` exige sept verdicts positifs ; aucun seuil ou refus ignoré.

Nouveau marqueur `renewal/0/baby-repair-started.json`. Brouillons, checkpoints, diagnostics et bilan sont enregistrés sous un nouvel identifiant dans le même dossier ; galerie `preview-renewal-0-baby-repair-<run>.html`. Un marqueur existant interdit un nouveau lancement, sans effacer le travail ni les dépenses. Aucune évolution ni publication dans cette passe.

La prévision complète de refonte reste 34,50 € avant cette correction ; avec sa validation maximale, **34,95 € cumulés**, hors autres corrections et appels de finalisation du pilote. Le plafond de 40 € est conservé.

## Contrôles réalisés

**16 tests ciblés distincts passent**, dont quatre nouveaux parcours de correction avec HTTP Gemini simulé : une seule génération, six références exactes conservées, contrôle prioritaire, arrêt après refus, refus ultérieur d’un pair, seuil budgétaire et mutation d’une image source bloquant avant API. Les parcours existants couvrent aussi interruptions, sauvegardes immédiates, absence de retry et suivi des passes. Les bases temporaires restent exactement inchangées.

Typage, lint et format passent. Le plan réel sans API recharge tous les fichiers sources. Préservation familiale : **26 tables inchangées, intégrité ok**. Aucun seed/migration/remplacement/restauration, aucune modification des sessions, possessions, surnoms, âges, reçus, arts de Teddy ou recalibrage. Aucun serveur ni nouveau parcours familial/WebGL ; anciens tests, adaptation, couverture globale et canari différés.

Suite : résultat et examen du seul Lucéran corrigé → évolutions du monde 0 → autres mondes autorisés → intégration du pilote et stabilisation/mise en service. Les six lignées du pilote et les six bébés positifs du monde 0 restent conservés.
