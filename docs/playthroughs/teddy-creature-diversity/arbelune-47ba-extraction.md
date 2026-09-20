# Arbélune — deux stades extraits, inspection prioritaire prête

11 septembre 2026. Retour utilisateur : **« ok c’est bon »**, accompagné du résultat de la correction anatomique `47ba20b1-8e18-44e6-9a3a-e338085ed7ed`. Interprété comme accord visuel sur cette planche, annoncé à l’utilisateur. Ne pas lui redemander le même choix. L’accord visuel est conservé séparément dans `arbelune-study-visual-approval.json`, lié aux pixels, au résultat et à la trace. Il ne remplace pas les verdicts QA.

**192 appels / 13,10 € réservés / plafond cumulé 40 € déjà autorisé.** La correction est une étude, zéro inspection, `qaPassed:false`, aucune publication. Son adulte garde deux ouvertures visibles plutôt que les quatre demandées, et des appuis encore regroupés. Ce constat a été signalé ; aucune anatomie prétendue corrigée à tort, aucun critère d’identité supprimé et aucun ancien verdict changé. Les images acceptées sont soumises telles quelles à la QA.

## Préparation locale réalisée

[Comparaison des trois âges, avec vignettes à 128 px](arbelune-47ba-extracted-three-ages.png). [Galerie des six lignées](../../../data/teddy-world-pilot/preview-arbelune-study-stages-47ba20b1.html).

La planche source reste intacte. Rectangles revus : ado `(0,0,550,1024)`, adulte `(550,0,474,1024)`, séparés dans le blanc central. L’anneau blanc de 2 % est vérifié sur chaque rectangle avant tout détourage : aucune racine coupée pour gagner une marge. Le détourage habituel garde ses seuils ; le fond et l’ouverture centrale deviennent transparents, les détails clairs enfermés restent conservés. Les deux résultats sont centrés avec 10 % de marge puis mis en carrés de 1024 px. Cela rééchantillonne les pixels de la demi-planche, sans nouvelle génération ni redessin ; la résolution de détail reste celle de l’étude.

Les deux PNG ont été ouverts, puis leur comparaison à taille de vignette. Nouveaux candidats immuables :

- `world/6/runtime-9dd56138-1fad-49fe-832c-d8f4020fc9ed-legendary-ado.png`
- `world/6/runtime-9dd56138-1fad-49fe-832c-d8f4020fc9ed-legendary-adulte.png`

Groupe préparé : `arbelune-study-stages/19f85ac3-35d5-4188-a79e-18d16c7b65ac-prepared.json`, recette `arbelune-study-stages.json`. Seuls les deux emplacements d’Arbélune dans ce nouveau fichier candidat changent. Seize autres arts exacts conservés, notamment le bébé d’Arbélune et Vrillou approuvé aux trois âges. Aucun artRef en base modifié. Tous les anciens PNG restent présents et leurs empreintes sont vérifiées.

## Commande suivante

Depuis `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-study-inspect
```

Plan réel `--arbelune-study-inspect-plan` vérifié sans API : **zéro génération**, les **trois âges d’Arbélune inspectés d’abord**, puis les **quinze autres images uniquement si les trois premiers verdicts sont positifs**. Chaque image est comparée au groupe final et au catalogue historique ; l’ado est confronté au bébé et au nouvel adulte, l’adulte au bébé et au nouvel ado. Le visage doit être lisible aux trois âges d’Arbélune. La description d’inspection conserve les traits d’identité attendus, dont quatre ouvertures et six racines ; aucun passe-droit fondé sur l’accord visuel.

Si Arbélune est refusé : trois diagnostics conservés, arrêt avant les autres créatures, **0,15 € réservés en plus**, cumul **13,25 €**. S’il passe : quinze inspections supplémentaires, **0,90 € maximum pour les dix-huit**, cumul **14 €**. Le budget maximal est vérifié avant la première requête, puis chaque appel est réservé individuellement. Pas de double inspection d’Arbélune. Un signal manquant ou une panne arrête la passe immédiatement, avec les diagnostics déjà reçus conservés. Aucun accord budgétaire à redemander.

Une validation positive exige dix-huit verdicts positifs : `fullValidation:true`. Un arrêt après la lignée ou un refus ultérieur donne `fullValidation:false`, `outcome:rejected` pour un refus QA, `published:false` dans tous les cas. `inspectedImages` indique le nombre effectivement contrôlé quand la passe retourne un bilan QA. L’absence de génération est aussi imposée par une garde HTTP.

Marqueur distinct `arbelune-study-inspect-started.json`, brouillon/checks/bilan dans `arbelune-study-inspections/`, galerie `preview-arbelune-study-inspect-<run>.html`. Conserver tous les fichiers après arrêt ; ne relancer aucune ancienne passe ni effacer un marqueur. Références, accords, catalogue, progression, mois et budget revérifiés avant chaque requête. Bases en lecture seule. Aucun retry ou publication automatique.

Aucun appel réel lancé par l’agent : accès Gemini toujours bloqué, aucun contournement tenté. Les verdicts réels restent à obtenir. Les nouveaux fichiers et la commande sont prêts.

## Vérifications

**67 contrôles ciblés distincts passent** : 63 lignée/reprise/étude, 3 détourage/récupération et 1 suivi CLI. Huit nouveaux contrôles couvrent l’extraction reproductible et la conservation des seize autres arts, les recadrages coupants et chevauchants, la modification des pixels dérivés, le refus prioritaire malgré l’accord visuel, les dix-huit inspections avec bonnes références d’âge, le plafond complet avant requête et le refus d’un pair après une lignée positive. Typage, lint et format passent.

Plan sans API réussi ; dix-huit liens d’images de galerie présents, sources et nouveaux PNG vérifiés. **26 tables familiales inchangées, intégrité ok**, contrôle en lecture seule. Aucun seed/migration/restauration, aucune modification de sessions/possessions/stades/reçus/Teddy/recalibrage. Pas de nouvel essai familial/WebGL ; anciennes couvertures/tests/canari différés.

Suite : résultat réel de cette validation, puis finalisation du pilote et refonte des créatures 0–5 déjà autorisée ; stabilisation/mise en service ensuite. Les autres nouvelles lignées ont des QA antérieures positives mais pas encore d’accord artistique explicite acquis. Estimation initiale avec les 20,50 € du socle 0–5 et la validation maximale : **34,50 €**, hors autres corrections/validations/intégration ; ce n’est pas une garantie de coût final.
