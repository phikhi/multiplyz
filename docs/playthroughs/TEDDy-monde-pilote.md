# TEDDy — préparation du monde pilote et des trois stades

## État courant — catalogue approuvé intégré dans la base familiale

**47 créatures / 141 images intégrées**, autorisées par « tout est bon » puis « ok go ». 41 identifiants existants conservés ; noms, histoires et images renouvelés. Monde 6 magique actif avec les six lignées du pilote et la garde des mondes déjà réservés respectée. Friselot ado corrigé inclus. Collections/surnoms/stades, sessions, progression, monnaies, recalibrage et arts de Teddy préservés ; **25 tables familiales inchangées**, intégrité correcte. Aucune génération ni dépense supplémentaire : **29,65 € / 40 €**.

Livraison effective dans `app/data/multiplyz.sqlite`, jamais remplacée/migrée/seedée. Reçus `renewal-publication.json`, `renewal-serving-check.json`, `renewal-preservation-check.json` sous `app/data/teddy-world-pilot/`. Contrôles ciblés et 144 PNG servis exacts ; aucune nouvelle QA payante ni baisse des gardes automatiques. Ne pas rejouer les anciens pilotes ou leurs comparaisons au catalogue initial. [Livraison et reprise](TEDDy-integration-creatures.md).

**Serveur local à lancer dans le Terminal utilisateur** : le démarrage agent a été refusé (`listen EPERM`). Dans `app/`, Node 22 : `DATABASE_PATH=data/multiplyz.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217`. Jamais `pnpm dev`. Pas de nouveau parcours navigateur/essai familial revendiqué. Suite : stabilisation visuelle/runtime puis mise en service familiale ; tests globaux/canari à cette étape, sans recommencer les tranches livrées. Réponses courtes.

## Historique — Tavelle validé, second visage à corriger : Pivertin adulte

`--renewal-0-face-repair` terminé : `renewal/0/e596f313-b123-4e95-ad29-3dbffb8b8a81-result.json`, **21 arts / 21 QA / 20 positives**. Tavelle corrigé passe aux trois âges. Seul Pivertin adulte (`slot:3, stage:3`) reçoit `faceReadable:false`. Son PNG, ses références d’âge et sa vignette sont identiques à la passe précédente positive : verdict variable sur les mêmes pixels, une planche de pairs modifiée par Tavelle. Revue à 128 px : petite tête de profil, un seul œil visible ; le contrôle actuel exige deux yeux et une bouche lisibles. Aucun ancien verdict réutilisé pour ignorer le refus. **289 appels / 19,10 € réservés / plafond 40 € déjà autorisé.** Avis **« ok c’est bon »** enregistré dans `face-repair-2-review.json` ; conserver les vingt arts positifs, dont Tavelle corrigé. Pilote toujours validé, aucun monde publié.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-face-repair-2`**, app/ sous Node 22, Terminal utilisateur. **Une image, vingt conservées**, référence unique de Pivertin adulte ; tête légèrement élargie et tournée vers le spectateur, deux yeux et petit bec souriant, long cou/corps/plumage matures préservés. Trois QA de Pivertin d’abord, dix-huit autres seulement si sa lignée passe. **1,15 € maximum / cumul prévu 20,25 €** ; refus prioritaire = 0,25 € / 19,35 €. Plan réel sans API vérifié. Recette `face-repair-2-plan.json` liée à la première correction et aux 21 PNG ; nouveau marqueur `face-repair-2-started.json`, galerie/brouillons/bilan distincts. Ne relancer aucune ancienne passe ni supprimer de marqueur. Aucune boucle, retry/publication automatique ; mêmes gardes, deux bases en lecture seule. Gemini agent reste bloqué, aucun nouvel appel/contournement ici.

**22 tests ciblés, typage/lint/format et plan réel passent ; 26 tables familiales inchangées, intégrité ok.** Aucun nouveau dessin réel, seed/migration/remplacement/restauration, serveur ou essai familial. Sessions/possessions/stades/reçus/Teddy/recalibrage préservés. Prévision globale refonte 0–5 : **37,25 €**, hors autres corrections/finalisation payante. Suite : Pivertin → autres mondes autorisés → intégration du pilote → stabilisation/mise en service. Tests historiques/couverture/canari différés. Cet état prime sur les anciens ci-dessous. [Comparaison et seconde correction](teddy-creature-diversity/renewal-e596-pivertin-face.md).

## Historique — monde 0 terminé à 20/21 QA, visage de Tavelle à corriger

`--renewal-0-growth-resume` terminé : `renewal/0/b0279d02-1e82-4539-b2f4-1f03945a25d3-result.json`, **21 arts / 21 inspections / 20 QA positives**. Seul Tavelle adulte (`slot:1, stage:3`) a `faceReadable:false` ; identité/croissance/habitat/originalité vrais. Revue aux trois âges et à 128 px : visage de profil, un œil visible. **267 appels / 17,95 € réservés / plafond cumulé 40 € déjà autorisé.** Avis **« ok c’est bon pour moi »** conservé dans `renewal/0/growth-visual-review.json` ; il ne remplace pas le refus QA. Conserver les vingt autres arts, notamment Lucéran et Orsil détourés localement. Pilote toujours validé aux dix-huit arts exacts ; aucun monde publié.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-face-repair`**, app/ sous Node 22, Terminal utilisateur. Une image, **vingt arts réutilisés**, adulte exact comme unique référence ; corriger l’orientation/lisibilité de la tête en gardant le corps mature. Trois QA de Tavelle d’abord, dix-huit autres uniquement si la lignée passe. **1,15 € maximum / cumul prévu 19,10 €** ; arrêt après les trois QA prioritaires = 0,25 € / 18,20 €. Plan réel sans API vérifié. Recette `face-repair-plan.json` liée par empreintes au bilan/brouillon/trace/avis/21 PNG ; gardes revérifiées avant chaque appel. Nouveau marqueur `face-repair-started.json`, galerie et résultats séparés. Ne relancer aucune ancienne passe, ne supprimer aucun marqueur ; aucun retry/publication automatique. Gemini agent reste bloqué, aucun appel réel/contournement ici.

**20 tests ciblés, typage/lint/format et plan réel passent ; 26 tables familiales inchangées, intégrité ok.** Aucun nouveau dessin réel, seed/migration/remplacement/restauration, serveur ou essai familial. Les contrôles restent inchangés. Sessions/possessions/stades/reçus/Teddy/recalibrage préservés. Prévision globale refonte 0–5 : **36,10 €**, hors autres corrections/finalisation payante. Suite : Tavelle → autres mondes autorisés → intégration du pilote → stabilisation/mise en service. Tests historiques/couverture/canari différés. Cet état prime sur les anciens ci-dessous. [Résultat, comparaison et correction](teddy-creature-diversity/renewal-b0279-tavelle-face.md).

## Historique — six adultes récupérés, reprise des huit âges restants prête

`--renewal-0-growth` arrêté au détourage après les appels 233–238. Bilan `renewal/0/f1a1962c-b7d2-4893-bc7d-115894c4091c-result.json` conservé : cinq PNG sauvegardés, aucune QA. **238 appels / 16,10 € réservés / plafond cumulé 40 € déjà autorisé.** Lucéran adulte récupéré de la réponse 238 par retrait du cadre extérieur. Orsil adulte (235) avait aussi un cadre qui retenait un rectangle blanc : fond corrigé localement en conservant la silhouette colorée. Deux dérivés nouveaux, tous les originaux conservés, aucun appel payant ni seuil général changé. Recettes séparées `renewal/0/growth-recovery.json` et `growth-matte-repair.json`, groupe de **sept bébés approuvés et six adultes**. Les dix-huit arts du pilote restent validés et exacts. Aucun monde publié ; six adultes à examiner après QA, pas encore d’accord artistique sur ce lot.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-growth-resume`**, app/ sous Node 22, Terminal utilisateur. **Huit images restantes (Tormille adulte puis sept ados), treize images réutilisées, 21 inspections ; 1,85 € supplémentaires / cumul prévu 17,95 €.** Plan réel `--renewal-0-growth-resume-plan` vérifié sans API. Nouveau marqueur `growth-resume-started.json`, brouillons de 6 à 14 et galerie progressive séparée. Sources et empreintes revérifiées avant chaque appel ; même journal/verrou, deux bases en lecture seule, zéro retry/publication. Ne pas relancer `--renewal-0-growth`, ne supprimer aucun marqueur. Gemini agent reste bloqué, aucun appel réel/contournement tenté ici.

**22 tests ciblés, typage/lint/format et plan réel passent ; 26 tables familiales inchangées, intégrité ok.** Aucun seed/migration/remplacement/restauration, serveur ou nouvel essai familial. Visage lisible à 128 px, croissance, identité, habitat, originalité et autres QA restent requis sur les 21 arts. Sessions/possessions/stades/reçus/Teddy/recalibrage préservés. Prévision globale refonte 0–5 inchangée : **34,95 €**, hors autres corrections/finalisation payante. Suite : trois âges du monde 0 → autres mondes autorisés → intégration du pilote → stabilisation/mise en service. Tests historiques/couverture/canari différés. Cet état prime sur les anciens ci-dessous. [Diagnostic, images et reprise](teddy-creature-diversity/renewal-f1a196-cutout-recovery.md).

## Historique — sept bébés du monde 0 validés, évolutions prêtes

`--renewal-0-baby-repair` terminé : `renewal/0/8855a954-26ce-47d1-a746-3bc86298a774-result.json`, **7/7 QA positives**, `fullValidation:true`. Lucéran corrigé, six autres PNG exacts. Retour **« ok : »** joint au bilan pris comme accord de poursuite sur ce groupe ; accord séparé `renewal/0/babies-approved.json`. Nouveau Lucéran ouvert et examiné, planche `renewal-8855-babies-approved.png`. **232 appels / 15,50 € réservés / plafond cumulé 40 € déjà autorisé.** Les sept bébés et les dix-huit arts validés du pilote sont conservés ; aucun monde publié.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-growth`**, app/ sous Node 22, Terminal utilisateur. **14 nouvelles images (adultes puis ados), sept bébés exacts réutilisés, 21 inspections ; 2,45 € supplémentaires / cumul prévu 17,95 €.** Méthode de génération par descriptions seules, sans images de référence, reprise du pilote validé. Quatorze consignes distinctes dans `renewal/0/growth-plan.json`, identités décrites d’après les bébés examinés, notamment le visage de Fougrette conservé dans sa boucle supérieure. Pas de simple pose, accessoire ou redimensionnement pour simuler la croissance.

Plan réel `--renewal-0-growth-plan` vérifié sans API. Accord, correction précédente, marqueur/bilan/trace/brouillon/PNG liés par empreintes et revérifiés avant chaque requête ; deux bases en lecture seule. QA des ados contre bébé/adulte, des adultes contre bébé/ado, et de chaque identité contre anciens arts/pilote/pairs aux trois âges. **Visage lisible à 128 px exigé sur les 21 images.** Le contrôle partagé compte désormais la taille réelle du groupe : 21 verdicts positifs requis, contrat des six créatures du pilote préservé.

Même verrou et journal cumulatif ; budget complet avant départ, zéro retry/publication. Nouveau marqueur `renewal/0/growth-started.json`, brouillons de 0 à 14 après chaque âge, diagnostics et bilan séparés, galerie progressive `preview-renewal-0-growth-<run>.html`. Tout conserver après interruption/refus, ne pas relancer les anciennes passes ni supprimer un marqueur. Aucun âge réel de ce lot encore produit. Gemini toujours bloqué pour l’agent ; aucun nouvel appel réel ni contournement tenté ici.

**78 tests ciblés distincts, typage/lint/format et plan sans API passent ; 26 tables familiales inchangées, intégrité ok.** Aucun seed/migration/remplacement/restauration, serveur ou nouvel essai familial/WebGL. Données, sessions, possessions, surnoms, stades, reçus, Teddy et recalibrage préservés. Prévision globale avec refonte 0–5 : **34,95 €**, dont ces évolutions déjà comptées, hors autres corrections/finalisation payante. Suite : examen des trois âges du monde 0 → autres mondes autorisés → intégration du pilote → stabilisation/mise en service. Anciens tests/couverture/canari différés. Cet état prime sur les anciens ci-dessous. [Résultat et commande des évolutions](teddy-creature-diversity/renewal-8855-growth.md).

## Historique — bébés du monde 0 examinés, seul Lucéran à corriger

Retour utilisateur **« c’est bon »**, après `--renewal-0-babies` : avis visuel favorable enregistré dans `renewal/0/baby-visual-review.json`. Résultat réel `renewal/0/74741b07-c18e-4ead-8d83-1fe22b21bb13-result.json` : **sept bébés, six QA positives, seul Lucéran refusé pour ressemblance** (`visuallyDistinct:false`). **224 appels / 15,05 € réservés / plafond cumulé 40 € déjà autorisé.** Le retour visuel ne remplace pas ce verdict. Les six autres bébés sont désormais acceptés et conservés exactement ; les six lignées du pilote restent validées. Aucun monde publié.

Images ouvertes : groupe `renewal-74741-babies.png`, ancien catalogue et comparaison `luceran-74741-coquillette.png`. Lucéran partage la grosse tête, les ailes et l’abdomen lumineux de Coquillette du monde 4 ; le voisin est identifié par comparaison locale, pas nommé par la QA.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-baby-repair`**, app/ sous Node 22, Terminal utilisateur. Une nouvelle silhouette pour Lucéran : petit sauteur du sous-bois aplati, sans ailes, face intégrée, six pieds et éventail lumineux arrière. **Une image, six bébés exacts conservés.** Inspection prioritaire du corrigé ; six autres QA seulement s’il passe. Budget complet avant départ : **0,45 € maximum / cumul prévu 15,50 €** ; arrêt après refus prioritaire = 0,15 € / 15,20 €. Sept verdicts positifs requis pour `fullValidation:true`. Pas d’évolution ni publication.

Plan réel `--renewal-0-baby-repair-plan` vérifié sans API. Recette `renewal/0/baby-repair-plan.json` liée par empreintes au groupe et à son refus ; sources, catalogue, plafond et arts recontrôlés avant chaque appel. Même verrou et journal cumulatif. Marqueur distinct `baby-repair-started.json`, brouillons/diagnostics/bilan nouveaux, galerie `preview-renewal-0-baby-repair-<run>.html`. Aucun retry automatique, tous les anciens fichiers et réservations conservés ; ne pas relancer `--renewal-0-babies`. Gemini reste bloqué pour l’agent : aucun appel réel ni contournement ici.

**16 tests ciblés distincts, typage/lint/format et plan sans API passent ; 26 tables familiales inchangées, intégrité ok.** Aucun seed/migration/remplacement/restauration, serveur ou nouvel essai familial/WebGL. Données, sessions, possessions, surnoms, stades, reçus, Teddy et recalibrage préservés. Prévision globale avec refonte 0–5 et cette correction : **34,95 €**, hors autres corrections/finalisation payante. Suite : Lucéran corrigé → évolutions du monde 0 → autres mondes autorisés, intégration du pilote → stabilisation/mise en service. Anciens tests/couverture/canari toujours différés. Cet état prime sur les anciens ci-dessous. [Résultat et correction](teddy-creature-diversity/renewal-74741-luceran-repair.md).

## Historique — six lignées validées, premier lot de refonte 0–5 prêt

**« ok c’est bon aussi »** valide artistiquement les six lignées et leurs dix-huit arts. Le résultat `arbelune-study-inspections/8d7879f2-ddca-4953-bfa6-10e5a34185ce-result.json` passe **18/18 QA**, `fullValidation:true` : appels 193–210, **210 appels / 14 € réservés / plafond cumulé 40 € déjà autorisé**. Accord haché `validated-cast-approval.json`, lié à la trace, au bilan, au brouillon et aux dix-huit PNG. Ne redemander ni l’accord artistique ni le budget, ne régénérer aucune de ces six lignées. Aucun monde publié ; intégration complète du pilote encore à finaliser.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-babies`**, app/ sous Node 22 dans le Terminal utilisateur. Premier lot de la refonte 0–5 déjà autorisée : **sept bébés du monde 0 et sept inspections**, **1,05 € supplémentaire / cumul prévu 15,05 €**. Noms : Mycélou, Tavelle, Orsil, Pivertin, Fougrette, Lucéran, Tormille. Anatomie, habitat du sous-bois et transformation des trois âges écrits dans `renewal-world-0.json`. Seuls les bébés sont produits maintenant ; examiner leurs pixels avant les évolutions. Aucun dessin de ce lot encore généré.

Plan réel `--renewal-0-babies-plan` vérifié sans API. Outillage dédié en lecture seule sur les deux bases, correspondances par identifiant/espèce/rareté/tirage conservées, anciens arts et accord final revérifiés avant chaque appel. QA contre les anciens arts à tous leurs âges, le pilote accepté et les autres bébés. Même verrou et budget cumulé, zéro retry. Marqueur `renewal/0/babies-started.json`, brouillons après chaque dessin, diagnostics après chaque QA, galerie et bilan conservés même après arrêt. Ne rien supprimer pour relancer. Réseau Gemini agent toujours bloqué, aucun nouvel appel ni contournement tenté.

Inventaire actualisé `teddy-creature-diversity/renewal-a12556c1-99fd-49b1-b493-7d11d8e6bfb8/plan.json` : **41 créatures, 123 images, 164 inspections, 20,50 € à venir / cumul global prévu 34,50 €**, hors corrections et autres appels de finalisation du pilote. Évolutions du pilote déjà terminées exclues de cette dépense future. Seul le monde 0 a ses fiches complètes ; plans détaillés des mondes 1–5 encore à écrire.

**16 tests ciblés distincts, typage/lint/format et plan sans API passent ; 26 tables familiales inchangées, intégrité ok.** Sessions, possessions, surnoms, stades, reçus, Teddy, recalibrage et tous les changements locaux conservés. Aucun seed/migration/restauration, aucun serveur ni nouvel essai familial/WebGL. Anciens tests/couverture/canari différés. Suite : lot 0 puis autres mondes autorisés, intégration du pilote → stabilisation/mise en service familiale. Cet état prime sur les anciennes commandes ci-dessous. [Bilan et commande de refonte](teddy-creature-diversity/cast-8d7879-accepted-renewal.md).

## Historique — étude Arbélune acceptée, stades extraits et inspection prête

Retour utilisateur **« ok c’est bon »** avec le résultat `arbelune-study-anatomies/47ba20b1-8e18-44e6-9a3a-e338085ed7ed-result.json` : interprété comme accord visuel sur la planche, annoncé à l’utilisateur. Ne pas redemander le même choix. **192 appels / 13,10 € réservés / plafond cumulé 40 € déjà autorisé**. L’adulte a encore deux ouvertures visibles et des appuis regroupés ; constat signalé et conservé, aucun critère QA assoupli. Accord séparé `arbelune-study-visual-approval.json`, `qaPassed:false`.

**Deux stades extraits localement, sans génération** : rectangles distincts dans l’étude, anneaux blancs de 2 % vérifiés, détourage habituel puis centrage/mise en carré 1024 px avec 10 % de marge. Pixels ouverts et comparaison à 128 px examinée. Nouveaux PNG `world/6/runtime-9dd56138-1fad-49fe-832c-d8f4020fc9ed-legendary-{ado,adulte}.png`. Groupe `arbelune-study-stages/19f85ac3-35d5-4188-a79e-18d16c7b65ac-prepared.json`, recette `arbelune-study-stages.json`. Les seize autres arts et tous les originaux restent exacts. Aucun artRef en base changé. Galerie locale `preview-arbelune-study-stages-47ba20b1.html`, dix-huit images présentes.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-study-inspect`**, app/ sous Node 22, Terminal utilisateur. Plan réel sans API réussi : zéro génération, **3 QA d’Arbélune d’abord ; 15 autres seulement si sa lignée passe**, mêmes pairs finaux dès le premier appel. Visage et deux extrémités d’âge contrôlés. Coût 0,15 € si refus prioritaire (cumul 13,25 €), jusqu’à **0,90 € / cumul 14 €** pour dix-huit contrôles. Pas de double QA d’Arbélune. `fullValidation:true` exige dix-huit verdicts positifs ; aucun refus ignoré. Budget complet avant départ, réservations individuelles, aucun retry/publication. Marqueur `arbelune-study-inspect-started.json`, résultats `arbelune-study-inspections/`, galerie `preview-arbelune-study-inspect-<run>.html`. Ne relancer aucune ancienne commande, conserver tous les marqueurs. Aucun appel réel Gemini ici, réseau agent toujours bloqué, aucun contournement.

**67 tests ciblés distincts passent**, typage/lint/format et plan sans API réussis ; **26 tables familiales inchangées, intégrité ok**. Gardes, arts de Teddy, sessions, possessions, stades, reçus, recalibrage et toutes les réservations préservés. Aucun seed/migration/restauration, aucun essai familial/WebGL, anciens tests/couverture/canari différés. Suite : QA réelle → finalisation du pilote et refonte 0–5 autorisée → stabilisation/mise en service. Les autres nouvelles lignées attendent toujours leur accord artistique explicite ; ne pas l’inventer. Prévision initiale 34,50 € avec le socle 0–5, hors corrections/validations/intégration restantes, plafond 40 €. Cet état prime sur les anciennes commandes ci-dessous. [Extraction, comparaison et commande](teddy-creature-diversity/arbelune-47ba-extraction.md).

## État courant — visage d’Arbélune corrigé, un seul ado à reprendre

`--arbelune-repair` est terminé : `arbelune-repairs/79774b6d-5655-4661-b7b9-15d114b3d8d8-result.json` **rejected**, 17 QA positives et seul Arbélune ado refusé. **171 appels / 11,90 € réservés / plafond cumulé 40 € déjà autorisé.** Les trois âges ont `faceReadable:true`. Nouvel adulte : identité/croissance positives, style 0,90 ; conservé comme candidat QA positif, sans accord artistique utilisateur acquis. Ado : identité/croissance fausses, style 0 ; les pixels montrent un corps ovoïde fermé autour d’un trou, au lieu de l’arche ouverte du bébé/adulte. Images et planche `arbelune-79774-three-ages.jpg` ouvertes. Les seize autres arts restent exacts. Aucun monde publié, aucune base modifiée. Ne pas relancer cette passe ni les précédentes.

**Commande suivante prête : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-adolescent`**, app/ sous Node 22 dans le Terminal utilisateur. Un seul ado, **17 images conservées**, incluant bébé et nouvel adulte exacts d’Arbélune. La génération reçoit **deux images de référence réelles, bébé puis adulte**, pour conserver l’arche ouverte ; ce changement de méthode est limité à cet âge. Corps en U inversé ouvert jusqu’au sol, pas de barre inférieure/tranche de bois fermée, six racines intermédiaires, visage central lisible, quatre ouvertures hautes. La QA compare l’ado aux deux âges et réinspecte le groupe entier avec les pairs finaux ; visage 128 px obligatoire aux trois âges d’Arbélune. Pas de copie d’un âge ni simple redimensionnement acceptés.

Plan réel sans API vérifié : **1 image + 18 inspections, 1 € supplémentaire, cumul prévu 12,90 € / 40 €**. Aucun accord budgétaire à redemander. Recette hachée `arbelune-adolescent-plan.json` liée au bilan/marqueur/trace/brouillon/18 PNG de la dernière passe, seul ado refusé permis. Sources et gardes revérifiées avant chaque appel, deux bases en lecture seule, aucun retry/publication. Nouveaux marqueur `arbelune-adolescent-started.json`, brouillons/QA/bilan `arbelune-adolescents/`, galerie `preview-arbelune-adolescent-*.html`. Tout conserver après arrêt/refus. Aucun nouvel appel réel Gemini lancé ici, accès réseau agent toujours bloqué, aucun contournement tenté. Nouvelle image pas encore produite ni approuvée.

**52 tests ciblés distincts passent**, typage/lint/format réussis ; **26 tables familiales inchangées, intégrité ok**. Aucun seed/migration/restauration ni modification des sessions/possessions/stades/reçus/Teddy/recalibrage. Pas de nouvel essai familial/WebGL, anciens tests/couverture/canari différés. Prévision totale avec socle 0–5 : **33,40 €** hors autres corrections/conception payante, plafond 40 €. Suite : résultat/examen du nouvel ado et du groupe → refonte 0–5 déjà autorisée → stabilisation/mise en service. Cet état prime sur les anciennes commandes ci-dessous.

Lire [le résultat et la reprise du seul ado](../../docs/playthroughs/teddy-creature-diversity/arbelune-79774-review.md).

## État courant — visage d’Arbélune refusé, deux âges à corriger

Retour utilisateur : **« arbelune adulte n'a plus de visage par contre. c'est devenu un pont »**. Image réelle ouverte : minuscule visage visible seulement à pleine taille, illisible en vignette (`arbelune-adult-151-thumbnail.png`). Le retour utilisateur prime sur la QA positive de cet adulte. Rejet enregistré séparément `arbelune-user-review.json`, PNG/empreinte conservés ; aucun ancien verdict modifié.

Les **18 inspections sont terminées**, résultat `cast-completion-inspections/96e0b44c-10d3-4295-b62e-3904d9b6d5db-result.json` **rejected**. Dix-sept verdicts positifs ; Arbélune ado refusé pour identité/croissance. **151 appels / 10,80 € réservés / plafond 40 € déjà autorisé**. Ne relancer ni --cast-completion ni --cast-completion-inspect ni les anciennes passes.

**Commande suivante prête : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-repair`**, app/ sous Node 22, Terminal utilisateur. Plan réel sans API vérifié : **2 images (adulte puis ado d’Arbélune seulement), 16 arts conservés, 18 QA fraîches, 1,10 € supplémentaires, cumul 11,90 € / 40 €**. Bébé d’Arbélune, Vrillou complet et les autres créatures exacts conservés. Pas de nouvelle permission budgétaire. Descriptions seules, visage crème central contrasté avec yeux/bouche expressifs, corps et six racines développés, quatre ouvertures hautes ; pas de visage minuscule ou déplacé sur un bout du pont. Le contrôle `faceReadable` est obligatoire aux trois âges d’Arbélune, avec vraie vignette 128 px en plus des références d’âge. Absence/doute/false bloque ; identité/croissance/milieu/originalité/texte/sécurité restent nécessaires. Les autres anciennes QA gardent leur contrat, aucun seuil abaissé.

Recette hachée `arbelune-repair-plan.json` liée à la récupération, au bilan complet et au rejet utilisateur ; sources et gardes revérifiées avant chaque appel. Marqueur distinct `arbelune-repair-started.json`, brouillons/QA/bilan `arbelune-repairs/`, galerie `preview-arbelune-repair-*.html`. Aucun retry/publication ou changement de base, tous les originaux conservés. Aucun nouveau dessin réel produit ici, réseau Gemini agent toujours bloqué, aucun appel/contournement tenté. Qualité des deux futurs dessins à établir ; les cinq autres lignées passent la QA mais ne sont pas encore approuvées artistiquement par l’utilisateur.

**56 tests ciblés distincts passent**, typage/lint/format réussis ; **26 tables familiales inchangées, intégrité ok**. Aucun seed/migration/restauration ni modification des sessions/possessions/stades/reçus/Teddy/recalibrage. Pas de nouvel essai familial/WebGL, anciens tests/couverture/canari différés. Prévision globale avec socle 0–5 : **32,40 €** hors autres corrections/conception payante, plafond 40 €. Suite : examiner la correction d’Arbélune et le groupe, refonte 0–5, stabilisation/mise en service. Cet état prime sur les anciennes commandes ci-dessous.

Lire [le rejet du visage et la correction ciblée](../../docs/playthroughs/teddy-creature-diversity/arbelune-face-review.md).

## État courant — dix évolutions récupérées, inspections seules prêtes

`--cast-completion` est arrêté techniquement, résultat `cast-completions/e4dab1f0-a78d-468b-ab14-9fb4237277c4-result.json`. **133 appels / 9,90 € réservés / plafond cumulé 40 € déjà autorisé**. Dix réponses 124–133 HTTP 200 / STOP et dix images brutes présentes ; neuf dessins détourés sauvegardés. Dernier fichier (ado d’Arbélune) contient un cadre noir/gris : rejet du fond reproduit, aucune QA commencée. Ne pas relancer cette commande ni supprimer son marqueur/résultat.

**Récupération locale réalisée sans API** : rectangle blanc intérieur (120,120,784,784), marges blanches contrôlées puis détourage habituel, seuils inchangés. Créature non redessinée. Original 133 et neuf autres dessins conservés ; replay des neuf réponses brutes identique aux PNG enregistrés. Dérivé `world/6/runtime-745b665d-8174-46ef-b5b5-7313361f1f6c-legendary-ado.png`. Groupe complet `cast-completion-recoveries/a254022b-d3cc-45d0-9eb0-3acd20c673fd-prepared.json` ; recette liée aux empreintes `cast-completion-recovery.json`. Les dix-sept autres arts exacts sont conservés, notamment six bébés et Vrillou validés aux trois âges. Galerie prête `preview-cast-completion-recovered-e4dab1f0-a78d-468b-ab14-9fb4237277c4.html`, dix-huit images présentes. Pixels ouverts, planches `completion-e4dab1-recovered-{1,2,3}.jpg`. Proportions plus différentes, mais écarts d’identité à examiner (Nacélie yeux, Spirélis coquille, Arbélune ouvertures/visage). Aucune validation artistique des cinq nouvelles lignées.

**Commande suivante : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-completion-inspect`**, depuis app/ sous Node 22, Terminal utilisateur. Plan réel sans API vérifié : **zéro génération, dix-huit inspections fraîches, 0,90 € supplémentaires, cumul prévu 10,80 € / 40 €**. Pas de nouvelle permission budgétaire. Parcours sans générateur + garde HTTP contre requête image ; source/empreintes/catalogue/progression/accords/budget revérifiés avant chaque appel. Comparaisons bébé/ado/adulte et tous les pairs finaux, seuils inchangés. Aucun retry, correction ou publication automatique. Nouveau marqueur `cast-completion-inspect-started.json`, résultats dans `cast-completion-inspections/`, galerie `preview-cast-completion-inspect-*.html`. Conserver tout après arrêt/refus. Accès Gemini agent toujours bloqué, aucun nouvel appel ni contournement tenté.

**43 tests ciblés distincts passent**, typage/lint/format réussis ; **26 tables familiales inchangées, intégrité ok**. Aucune écriture des deux bases, aucun seed/migration/restauration, pas de changement des sessions/Teddy/possessions/recalibrage. Pas de nouvel essai familial/WebGL ; anciens tests/couverture/canari différés. Suite : QA du groupe récupéré et examen artistique, puis refonte 0–5 déjà autorisée, stabilisation et mise en service. Prévision 31,30 € avec le socle 0–5, hors corrections/conception payante, plafond 40 €. Cet état prime sur toutes les anciennes commandes ci-dessous.

Lire [le diagnostic et la reprise](../../docs/playthroughs/teddy-creature-diversity/completion-e4dab1-recovery-review.md).

## État courant — trois âges de Vrillou validés, plafond 40 €, cinq lignées préparées

L’utilisateur valide la lignée complète : **« c’est bon pour moi »**, après le résultat `growth-adolescent-clarifications/94113477-61d2-4085-8022-b433db9f3ef1-result.json`. Ado généré et trois QA réussies, pixels ouverts et planche `growth-lineage-941134-comparison.jpg` examinée. **Conserver les trois arts de Vrillou et les six bébés exacts ; ne pas redemander leur validation.** 123 appels, **8,90 € réservés**, aucune publication/écriture de base.

**Plafond 40 € désormais autorisé** (« augmente a 40 si besoin »), besoin établi par estimation globale 31,30 €. Accord ajouté `budget-authorization-40.json`, chaîne 5→10→30→40 et toutes les réservations conservées. Ne pas redemander. La nouvelle passe des cinq autres lignées est déjà couverte.

**Commande suivante prête : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-completion`**, app/ sous Node 22 dans le Terminal utilisateur. Plan réel sans API exécuté : **dix images** (adultes puis ados des cinq autres espèces), six bébés et les deux âges de Vrillou réutilisés, **dix-huit QA fraîches**, 1,90 € supplémentaires, **10,80 € cumulés / 40 €**. Génération depuis dix descriptions propres aux espèces, sans références image ; QA avec bébé/ado/adulte et catalogue complet/pairs finaux. Recette et accord hachés `cast-completion-plan.json` ; gardes/fichiers/catalogue/progression revérifiés avant chaque appel. Deux bases en lecture seule, aucun retry/publication. Nouveaux marqueur `cast-completion-started.json`, brouillons/QA/bilan `cast-completions/`, galerie `preview-cast-completion-*.html`. Conserver tout en cas d’arrêt ; ne relancer aucune ancienne passe ni effacer de marqueur. Aucune nouvelle image réelle de cette passe produite ici : réseau Gemini toujours bloqué, aucune tentative de contournement.

38 tests ciblés distincts passent, typage/lint/format passent ; 26 tables familiales identiques, intégrité ok. Aucun seed/migration/restauration, aucune modification de données/sessions/Teddy/gardes/recalibrage. Pas de nouvel essai familial/WebGL ni reprise des tests historiques/couverture/canari. Budget initial du socle 0–5 : 20,50 € pour 41 créatures/123 arts, total **31,30 €** après cette passe, marge **8,70 €** hors corrections sur le plafond 40 €. Suite : examiner le groupe produit puis refonte 0–5 en préservant thèmes, ids, possessions, surnoms, stades, reçus et sessions ; stabilisation/mise en service ensuite. Cet état prime sur tous les anciens budgets et commandes ci-dessous.

[Accord, nouvelles lignées et commande](teddy-creature-diversity/cast-completion-review.md).

## État courant — refus fournisseur de l’ado, diagnostic corrigé

`--growth-adolescent` est terminé **sans image et sans QA**. Résultat `growth-adolescents/2feea837-600e-4ecc-ac29-9d8b56a5f5aa-result.json`. Appel 119 : HTTP 200, **finishReason PROHIBITED_CONTENT**, masqué par le client sous « aucune inlineData ». Aucun mot précis incriminé par les données disponibles. **119 appels / 8,65 € réservés / plafond cumulé 30 €**, ancienne réservation de 0,10 € conservée. Bébé et adulte de Vrillou toujours validés par l’utilisateur, fichiers exacts conservés. Ne pas les faire revalider ni relancer --growth-proof/--growth-adolescent/anciennes passes.

Client corrigé : tous codes de fin explicites autres que STOP refusés avant lecture d’image, sans retry, diagnostic précis ; futures traces enrichies des détails fournisseur disponibles, sans clé. Seuils/modèles inchangés. Diagnostic 119 ajouté séparément, ancien résultat non réécrit.

**Commande distincte préparée : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-adolescent-clarification`**, depuis app/ sous Node 22 dans le Terminal utilisateur. Description explicite d’un gecko végétal imaginaire juvénile, mêmes critères d’âge/identité, mêmes filtres. Une formulation plus claire ne garantit pas l’acceptation fournisseur. Un seul nouveau dessin + trois inspections, bébé/adulte réutilisés ; **0,25 € supplémentaires, cumul prévu 8,90 € / 30 €**. Accord d’origine intact ; recette clarification liée aux empreintes du refus et de la trace, nouveaux marqueur/brouillon/bilan/galerie dans `growth-adolescent-clarifications/`. Refus d’un ancien échec QA ou d’une passe ayant déjà une image. Aucun élargissement, réessai ou publication automatique. Tout conserver après arrêt. Plan réel sans API vérifié, aucun nouvel appel Gemini lancé ici ; restriction réseau antérieure inchangée.

81 tests ciblés, typage/lint/format passent ; 26 tables familiales identiques, intégrité ok. Pas de seed/migration/restauration, données/Teddy/sessions/possessions/recalibrage préservés. Pas de nouvelle validation artistique ni essai familial/WebGL. Anciennes couvertures/tests/canari toujours différés. Après l’ado, examiner les trois âges et recalculer la suite ; les 29,40 € avec le socle 0–5 estimé restent **hors reprises des autres évolutions du pilote**. Cet état prime sur les commandes historiques ci-dessous.

[Diagnostic, correction et suite](teddy-creature-diversity/growth-adolescent-119-review.md).

## État courant — adulte de Vrillou validé, ado préparé

L’utilisateur valide explicitement le nouvel adulte : **« Oui, cette direction me convient »**, après signalement de son long cou/allure de petit dinosaure. Conserver cet adulte exact et le bébé approuvé ; ne pas demander à nouveau leur validation. Résultat `growth-proofs/df062e4c-5223-4a34-a0cb-6ccf8d4eee5d-result.json` : identité/croissance/milieu/originalité vrais, QA positive, **118 appels / 8,55 € réservés / plafond cumulé 30 € déjà autorisé**, aucune publication. Image réelle ouverte et comparaison `growth-proof-df062-comparison.jpg` examinée. Génération 117 sans référence image, QA 118 avec vraies références. La méthode fonctionne pour cet adulte ; autres espèces encore à établir.

**Commande suivante prête : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-adolescent`**, depuis app/ sous Node 22, Terminal utilisateur. Un seul ado depuis sa description, bébé ET adulte exacts conservés, trois QA fraîches. L’ado doit être visiblement entre bébé et adulte (`adultRef`), puis l’adulte est comparé au nouvel ado. Plan réel sans API vérifié : **0,25 € supplémentaires, cumul 8,80 € / 30 €**. Nouvel accord haché `growth-adolescent-approval.json`, nouveau marqueur `growth-adolescent-started.json`, fichiers/galerie dans `growth-adolescents/` et `preview-growth-adolescent-*.html`. Gardes, budget et deux bases en lecture seule. Aucun nouvel appel réel lancé ici, accès Gemini toujours bloqué dans cet environnement. **Ne relancer ni --growth-proof, ni --cast-growth, ni --cast-redesign ; conserver tous les marqueurs/arts/résultats.**

83 tests ciblés distincts, typage/lint/format passent ; 26 tables familiales identiques, intégrité ok. Aucun nouveau seed/migration/restauration, aucun changement de données/Teddy/possession/progression/recalibrage/session, aucune publication. Ado pas encore généré ni validé visuellement ; pas de nouvel essai familial/WebGL ni reprise des tests historiques/couverture/canari. Après l’ado, examiner la lignée complète avant extension et recalculer le budget restant : socle 0–5 initialement 20,50 €, total 29,30 € avec cet essai **hors reprise des autres âges du pilote**, donc pas une garantie de tout terminer dans 30 €. Cette section prime sur les états historiques ci-dessous.

[Comparaison réelle et prochaine étape](teddy-creature-diversity/growth-proof-df062-review.md).

## État prioritaire — deuxième passe refusée, essai sur un seul adulte

`--cast-redesign` est **terminé et refusé**, résultat `cast-redesigns/4092a831-7c45-4a54-b632-f024ddb585f6-result.json` : douze images, dix-huit QA, sept croissances insuffisantes. **116 appels / 8,40 € réservés / plafond cumulé 30 € déjà autorisé.** Ne pas relancer cette passe ni `--cast-growth`, ni effacer leurs marqueurs. Les dix-huit vrais pixels ont été ouverts dans `growth-inspection-4092-{1,2,3}.jpg` : copies de proportions bébé et changements de détails persistent, même parmi certains oui QA. Les nouvelles consignes ont bien été transmises dans les requêtes ; référence bébé trop contraignante = hypothèse à tester, pas cause démontrée. Six bébés validés conservés ; aucun nouveau signe d’approbation artistique des âges.

**Prochaine commande préparée : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-proof`**, depuis app/ sous Node 22, Terminal utilisateur. Un seul adulte de Vrillou dessiné depuis sa description **sans image de référence à la génération**, puis QA avec bébé canonique, ancien ado refusé et tout le catalogue/pairs. Aucun autre âge lancé, aucune publication. Nouveau marqueur/galerie/brouillon/bilan dans `growth-proofs/` ; tout conserver en cas d’arrêt. Gardes/budget/empreintes inchangés. Plan sans API exécuté : **0,15 € supplémentaires, cumul 8,55 € / 30 €**. Aucun nouvel appel réel ici : accès réseau Gemini toujours bloqué, pas de nouvelle tentative ou contournement. La qualité reste à établir sur la future image.

Socle 0–5 toujours autorisé, encore sans images/remplacement. Les 20,50 € estimés du socle + pilote déjà dépensé + essai = 29,05 €, **hors reprise encore nécessaire des autres âges du pilote** ; ne pas promettre que la marge 0,95 € finance toute la suite. Établir la méthode sur l’adulte, puis recalculer avant élargissement ; aucune hausse automatique. Aucun accord budgétaire nécessaire pour cet essai.

32 tests ciblés distincts, typage/lint/format passent. Plan et suivi CLI vérifiés sans API ; 26 tables familiales identiques, intégrité ok. Données/sessions/possessions/arts/Teddy/recalibrage conservés. Aucun seed/restauration, aucune publication ni modification du runtime familial. Pas de nouvel essai familial/WebGL, tests historiques/couverture/canari toujours différés. **Cette section prime sur tous les états et commandes historiques ci-dessous.**

[Examen des pixels et essai](teddy-creature-diversity/growth-redesign-4092-review.md).

## Dernier retour : toutes les évolutions à redessiner

L’utilisateur refuse artistiquement **tous les adolescents/adultes**, y compris les QA positives. Les six bébés restent validés. Résultat précédent conservé : douze arts générés/dix-huit QA, cinq refus automatiques, 6,30 € réservés cumulés. Les dix-huit images ont été examinées. **Plafond 30 € désormais accepté**, sans effacer aucun ancien budget ou résultat.

Suite prête : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-redesign`, dans app/ sous Node 22, Terminal utilisateur. Plan vérifié sans API : douze images + dix-huit QA, 2,10 € supplémentaires, cumul 8,40 €. Recettes propres aux douze stades, séparation identité/proportions, croissance et QA renforcées. Pas encore exécuté ici ; nouveaux PNG/brouillons/diagnostics/galerie et marqueur distinct à conserver même après arrêt. Aucun retry, remplacement ou publication. **Ne pas relancer --cast-growth**, ni le premier plan local à huit corrections, dépassé avant tout appel par la demande utilisateur.

[Compte rendu, plan et budget du socle](TEDDy-creatures-uniques.md). Total prévu avec refonte 0–5 : 28,90 € / 30 € ; aucun nouveau dessin du socle ni remplacement avant établissement du nouveau résultat de croissance. Les sections suivantes sont historiques.

## Dernier accord : identités validées, évolutions prêtes sous plafond 10 €

L’utilisateur valide les six identités, autorise leurs évolutions et augmente le plafond cumulé à 10 €. `--cast-growth-plan` vérifié sans API : douze nouvelles images et dix-huit inspections, six bébés exacts réutilisés, **2,10 € supplémentaires / cumul prévu 6,30 €**. Depuis le Terminal utilisateur dans app/ : `node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --cast-growth`. Aucun appel réel de cette passe encore lancé ici. Deux bases en lecture seule, anciens budgets/PNG/résultats conservés ; empreintes d’approbation, brouillons après chaque stade, diagnostics et galerie distincts. Ne pas effacer `cast-growth-started.json` en cas d’arrêt et ne pas relancer automatiquement.

Lire [l’accord, les contrôles et la nouvelle demande de refonte 0–5](TEDDy-creatures-uniques.md). 84 tests ciblés/typage/lint/format/build passent ; 26 tables familiales identiques. La refonte complète des 41 anciens compagnons demanderait 20,50 € supplémentaires (26,80 € cumulés avec le pilote et ses évolutions), au-delà des 10 € autorisés ; seule sa proposition est préparée. Les sections suivantes sont historiques.

## Dernier résultat : aperçu des six nouvelles identités réussi

L’utilisateur a terminé `--cast-preview` : six nouvelles images et six inspections, appels 45–56 tous HTTP 200. Résultat `passed-for-visual-review`, milieu/ressemblance confirmés, sans publication ni âges suivants. **4,20 € réservés sur 5 €, solde 0,80 €**. [Galerie réelle](../../data/teddy-world-pilot/preview-cast-af6e719c-5575-4e61-b3a7-75a85574653c.html) et [examen des six images, réserves et suite](TEDDy-creatures-uniques.md#résultat-réel--six-bébés-produits-et-inspectés). Avis artistique utilisateur attendu ; les douze âges suivants et leur QA dépassent le solde, aucun supplément autorisé.

Les six PNG ont été ouverts individuellement ; `--check-preservation` confirme 26 tables familiales identiques, intégrité ok. L’ancien monde reste buffered et son job failed, indépendamment de cet aperçu. **Conserver tous les marqueurs, PNG, résultats et budgets ; ne relancer aucune des passes ci-dessous, ni `--cast-preview`.** Les sections suivantes sont historiques.

## Dernier résultat : diagnostic complet, budget insuffisant, nouvelle conception prioritaire

`--refine` a terminé les 15 diagnostics manquants (appels 30–44, HTTP 200). Sept stades n’ont pas de croissance assez visible ; Braisille adulte change d’identité. **Huit corrections**, qui avec les 21 inspections finales demanderaient 1,85 € sur un solde de 1,70 €. Le script s’est arrêté **avant toute régénération** : 3,30 € réservés, plafond de 5 € conservé, 21 images et tous les bilans intacts. Résultat : `refinements/e143b1de-93ee-4b87-a717-1d00a11cbb25-result.json`. Aucune publication. `--status` expose maintenant aussi ce dernier bilan.

L’utilisateur signale parallèlement noms et silhouettes trop répétitifs et demande une faune authentique, visiblement adaptée au milieu. Cette demande devient la priorité : [nouveau parcours et proposition](TEDDy-creatures-uniques.md). Conception préalable et QA comparative raccordées pour les futurs mondes, testées sans API. **Ne pas redonner les commandes de reprise ci-dessous** ni effacer le marqueur pour réessayer. Le pilote reste un résultat à conserver. Aucun nouvel accord budgétaire ; un autre monde complet ne tient pas dans les 1,70 € disponibles.

Les sections suivantes décrivent la préparation puis les états antérieurs.

## État actuel : refus de croissance, correction ciblée prête

L’inspection seule a fonctionné : **six réponses HTTP 200**, appels 24–29 avec Gemini 3.8 Flash. Pistache adulte est refusé : identité reconnue, **croissance non visible** (`identityMatches:true`, `growthVisible:false`). Le score de style brut était 0,72 ; la comparaison négative le ramène à zéro pour conserver la garde. Le diagnostic détaillé est maintenant conservé dans le résultat parsé. Ce refus ne se reprend pas avec `--inspect`.

**Réservations actuelles : 2,55 € sur 5 €.** Six diagnostics connus, quinze images restantes. Le plan ci-dessous a été exécuté sur les vrais pixels et leurs références, en lecture seule, sans API :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --refine-plan
```

**Commande à lancer maintenant dans le Terminal utilisateur, depuis app/ avec Node 22 :**

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --refine
```

Cette passe unique procède ainsi :

1. Retrouver les diagnostics déjà reçus seulement si modèle, prompt, pixels et références ordonnées sont identiques ; compléter les quinze manquants. Ces archives servent au diagnostic, jamais à la validation finale.
2. Vérifier que les refus concernent seulement le style, l’identité ou la croissance des stades ado/adulte. Un problème de sécurité, texte ou image de base arrête la passe pour examen.
3. Avant toute régénération, vérifier le budget nécessaire aux corrections **et** aux 21 inspections finales. Le solde permet jusqu’à six corrections : 0,75 € de diagnostic + 0,60 € de corrections + 1,05 € de validation, donc 4,95 € cumulés avec les 2,55 € déjà réservés. Au-delà, arrêt avant correction ; plafond inchangé.
4. Générer une seule version par stade refusé, depuis son bébé canonique et l’ado pour l’adulte. Le prompt demande une croissance du corps, préserve motifs et type/nombre d’appendices, interdit de simuler l’âge par pose ou décoration. Détourage et refus des copies identiques conservés.
5. Archiver les nouveaux PNG et le nouveau manifeste, puis inspecter à nouveau les **21 images**, références actualisées comprises. Tous les verdicts doivent passer les règles existantes. Un succès laisse le monde `buffered` et le job `done` dans la copie ; aucune créature publiée. Un refus conserve le candidat/échec d’origine et archive la nouvelle révision.

Nouveaux fichiers : `refinement-started.json`, `refinements/<id>-{diagnostic,validation,result}.json`, `preview-refinement-<id>.html`. Le marqueur interdit toute deuxième passe automatique, même après interruption. Ne pas l’effacer ni réinitialiser les données/budgets. Les réponses HTTP et images brutes restent dans le journal existant ; chaque tentative est réservée avant envoi, sans réessai automatique. La garde de progression est vérifiée avant les corrections/inspections finales et lors de l’enregistrement atomique. Le contexte familial actif n’est pas ouvert en écriture.

**Contrôles : 47 tests ciblés passent**, HTTP simulé, SQLite en mémoire et PNG temporaires ; typage, lint et format passent. Le harnais reproduit le verdict de Pistache sans perdre son motif de refus, vérifie les correspondances des archives, l’immuabilité du candidat, le budget, l’absence de publication et la protection d’un monde atteint pendant la QA. **26 tables actives identiques, intégrité ok.** Aucun appel payant ni nouvelle image réelle pendant cette préparation ; le blocage réseau connu de cet environnement n’a pas été retenté. Les corrections visuelles restent à produire puis examiner. Le fond blanc de Teddy et les contrôles WebGL restent ouverts, ainsi que la stabilisation finale. Aucun nouvel essai familial rapporté.

Les sections suivantes sont historiques.

## Dernier état : 21 images produites, première inspection HTTP 404

L’utilisateur a achevé la reprise : les deux premières images ont été réutilisées, les 19 restantes produites (appels 4–22). Le premier appel vision (23) répond **404**. Le modèle n’a donc inspecté aucune image ; ce n’est pas un refus de contenu. Monde 6 conservé `buffered`, job 1 `failed`, `qaAttempts:1`, 41 anciens compagnons seuls au catalogue. **2,25 € réservés** au total, y compris l’appel interrompu et la requête vision échouée ; plafond toujours 5 €. Galerie réelle : `data/teddy-world-pilot/preview.html`.

Le précontrôle précédent vérifiait uniquement `models.get` : sa réussite ne garantissait pas l’accès effectif à `generateContent`. La [page officielle des retraits](https://ai.google.dev/gemini-api/docs/deprecations) n’annonce pas de retrait de `gemini-2.5-flash` à la date consultée ; ne pas présenter son retrait comme la cause prouvée. L’ancien journal ne conservait pas le message fournisseur du 404. Ce diagnostic et le nom du modèle sont maintenant enregistrés, avec suppression de la clé.

**Commande de suite : inspection seule, aucun appel au générateur d’images.** Dans le Terminal utilisateur, depuis `app/`, Node 22 :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --inspect
```

Le pilote utilise maintenant `gemini-3.8-flash`, dont la [fiche officielle](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) documente entrées images et sorties structurées. Le corps de requête suit le [guide generateContent](https://ai.google.dev/gemini-api/docs/generate-content/latest-model) : ancien paramètre `temperature` omis, `thinkingLevel:low`, sortie bornée à 8192 tokens. Réservation conservée de 0,05 € par inspection, soit au plus 1,05 € pour les 21 images dans cette passe (3,30 € cumulés prévus si la passe complète réussit). Montants de réservation, pas facture fournisseur ; [tarif consulté](https://ai.google.dev/gemini-api/docs/pricing).

Cette voie accepte seulement un échec technique d’inspection, vérifie la présence du manifeste et de tous les fichiers, puis inspecte le candidat exact. Elle conserve le budget, les fichiers, le manifeste et le bilan initial. Un refus de sécurité/style/identité/croissance reste bloquant et ne peut pas être effacé par `--inspect`. Après réussite, seul le job passe `done` : monde toujours `buffered`, aucun ajout au catalogue, validation parent encore nécessaire. Le bilan d’inspection et une nouvelle copie de la galerie sont créés sous des noms distincts ; l’ancien aperçu indiquant l’échec 404 reste conservé. Aucun contenu n’entre dans la partie familiale.

**Vérifications de la correction : 33 tests ciblés passent** (30 runtime dont trois cas de reprise d’inspection, deux cache et un suivi), typage/lint/format passent. Le harnais reproduit le 404 puis confirme l’inspection des 21 mêmes images, sans génération ni publication ; refus de contenu et monde atteint en cours de QA restent bloquants. Le lancement `--inspect` a été tenté ici : `ENOTFOUND` avant toute inspection payante ou mutation du job. **L’accès réel du nouveau modèle reste à confirmer dans le Terminal utilisateur.** Base familiale : 26 tables inchangées, intégrité `ok`.

### Première inspection visuelle des fichiers réels

Les trois planches ont été ouvertes : [décor, tuiles et Teddy](teddy-world-pilot/inspection-1.jpg), [compagnons 1–3](teddy-world-pilot/inspection-2.jpg), [compagnons 4–6](teddy-world-pilot/inspection-3.jpg). Il s’agit des PNG effectivement produits, pas d’un rendu WebGL ni d’un essai familial.

- Teddy conserve visage et proportions du master avec une cape. Son fond blanc reste visible : détourage à traiter avant usage en superposition 2D.
- Coquillette bébé/ado et Réglisse ado/adulte montrent une croissance peu lisible, à revoir avant validation artistique.
- Braisille adulte passe d’ailes à plumes à des ailes membraneuses : point de continuité d’identité à examiner.
- La palette et les personnages sont doux à l’examen des planches ; cela ne remplace pas la QA complète. Aucune illustration modifiée pour forcer un passage des contrôles.

Suite : terminer la QA, confronter ses verdicts à ces observations, corriger les arts réellement non conformes dans le budget restant, puis contrôle WebGL et stabilisation. Les sections suivantes sont historiques.

## Dernière reprise : essai interrompu par Ctrl+C

L’utilisateur a lancé le pilote dans son Terminal le 11 septembre à 07:01 UTC, puis confirme l’avoir interrompu. **Deux images réelles sont conservées** (fond et tuiles). Le troisième appel, pour Teddy, n’a pas de réponse enregistrée. Trois réservations de 0,10 €, soit **0,30 €**, restent comptées ; aucun remboursement supposé de l’appel interrompu. Le job de la copie est resté `running`, sans monde assemblé ni bilan. Le message « cet essai a déjà démarré » provenait du marqueur conservé. La base familiale garde zéro job, zéro monde généré et ses 41 compagnons.

Le script propose désormais une **reprise explicite après interruption confirmée**, qui réutilise les images dont prompt et empreintes des références correspondent exactement. Les images brutes et anciens fichiers restent conservés ; seuls des fichiers de nouvelle tentative sont ajoutés. La QA complète est rejouée, sans cache de verdict. Le job de la copie revient `pending` uniquement après réussite du contrôle réseau. Aucun seed, aucune remise à zéro de la copie, aucun changement dans la base active.

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --resume
```

Un verrou de processus empêche les lancements simultanés. Les réservations déjà effectuées restent dans le même journal et le plafond reste 5 €. La reprise est refusée si un bilan existe, après échec QA ou en cas de changement de mois nécessitant de revoir le cumul. Un historique des reprises est ajouté sans remplacer le marqueur original. Des messages s’affichent à chaque image, puis toutes les 15 secondes pendant l’attente de Gemini. Ctrl+C conserve les images et libère le verrou du processus.

`--generate` affiche maintenant l’état si un essai a déjà commencé. Pour consulter cet état sans appel API :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --status
```

**Contrôles de cette correction : 30 tests ciblés passent**, dont conservation du budget du troisième appel, absence de double réservation des images réutilisées, inspection des 21 images et refus d’un cache corrompu/différent. Typage, lint et format passent. Le message initial a été reproduit puis remplacé par le bilan précis sur la copie réelle, sans appel API. `--resume` a été tenté ici : contrôle préalable encore bloqué par `ENOTFOUND`, avant toute mutation de job ou nouvelle réservation. **26 tables familiales inchangées**, intégrité `ok`. Les deux images produites n’ont pas encore été inspectées visuellement. La suite immédiate est de lancer `--resume` dans le Terminal de l’utilisateur, puis d’examiner la galerie complète.

Les sections ci-dessous décrivent la préparation antérieure à ce premier lancement.

11 septembre 2026, après « ok allons-y ». **Préparation terminée et contrôlée ; génération réelle bloquée par l’accès réseau de l’environnement.** Aucun nouveau monde ni aucune nouvelle illustration produits, aucun appel payant, aucun job dans la base familiale. Le retour positif précédent concernait l’aperçu des mondes ; aucun nouvel essai familial ou contrôle des pixels WebGL.

## Trois stades raccordés

Le runtime génère désormais les bébés, puis les adolescents ancrés sur leur bébé et les adultes ancrés sur bébé + adolescent. Les concepts, noms, raretés, thèmes et progression restent ceux du catalogue. Seuls les nouveaux candidats sont concernés ; les 41 compagnons et leurs 82 arts livrés ne sont jamais réécrits.

Les nouvelles créatures sont détourées depuis un fond blanc connecté aux bords. Les marques claires enfermées dans la silhouette restent opaques. Fond inattendu, silhouette presque vide ou copie identique d’un stade → refus. L’inspecteur reçoit les pixels des références et doit confirmer identité et croissance réelle, en plus des règles existantes. Un verdict absent ou négatif empêche toute publication. Le contrôle automatique devra encore être confronté aux images réelles ; les tests ne valident pas leur qualité artistique.

Le manifeste contient les trois références ; `maxStage: 3` et `artRefStages` sont publiés avec les créatures dans la transaction d’activation existante. L’aperçu parent expose les trois âges. La garde d’évolution sait lire les nouvelles images dans `storage/generated`, en conservant les vérifications de présence et de différence et la lecture des arts existants dans `public/generated`. Aucun changement de coût d’évolution, de reçu, de progression ou de session.

## Pilote préparé

[Plan enregistré](teddy-world-pilot/plan.json) : monde d’index **6** (septième monde), thème **magique**, **six compagnons**, donc **21 images** (trois images de monde + 18 arts de compagnons), au plus 21 inspections vision.

- Copie cohérente existante : `data/teddy-world-pilot/multiplyz.sqlite`, créée par SQLite backup depuis la base active, sans seed ni migration. Elle conserve les données et sessions copiées.
- Référence Teddy approuvée copiée dans ce dossier, même empreinte SHA-256 que l’original. Aucun remplacement de master.
- Modèles préparés : `gemini-2.5-flash-image` et `gemini-2.5-flash` pour la vision structurée. Leur disponibilité effective sera vérifiée par lecture de métadonnées avant toute génération.
- Réservations : 0,10 € par image, 0,05 € par inspection, **3,15 € prévus**, plafond de **5 €**. Il s’agit de réservations conservatrices du programme, pas d’une facture ou d’une garantie tarifaire du fournisseur. Aucun réessai HTTP/QA automatique et un seul monde.
- Validation parent forcée uniquement dans la copie après le contrôle préalable réussi. Aucun accès au catalogue familial. Un marqueur exclusif interdit de recommencer automatiquement un essai déjà démarré.
- Les requêtes sont tracées sans clé : prompts, empreintes des références, verdicts ; les images brutes sont archivées avant détourage. Après génération, une galerie locale est écrite dans `data/teddy-world-pilot/preview.html`.

La clé Gemini existe dans `../multiplyz/.env`. Le script ne lit que `GEMINI_API_KEY` depuis ce fichier (ou l’environnement), sans importer ses autres réglages ni son chemin de base. Il ne l’affiche ni ne la recopie. **Le contrôle de métadonnées échoue actuellement avec `ENOTFOUND` sur `generativelanguage.googleapis.com`.** Le marqueur de lancement, les jobs et les appels payants restent absents. [Constat](teddy-world-pilot/network-check.json).

## Reprendre l’essai réel

Dans un terminal ayant accès à l’API, depuis `app/`, avec Node 22 :

```sh
export PATH='/Users/philippekhill/Library/Application Support/Herd/config/nvm/versions/node/v22.23.0/bin':"$PATH"
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --generate
```

Cette commande utilise **la copie déjà préparée**. Elle ne démarre pas Next et n’écrit jamais la base active. Ne pas relancer une préparation en supprimant la copie, le journal ou les jobs. Si un essai payant échoue, conserver ses fichiers et examiner sa cause avant de décider d’une nouvelle tentative.

Après une génération achevée, ouvrir la galerie, vérifier Teddy, les six identités, la croissance bébé → adolescent → adulte, le détourage, le cadrage et la sécurité, puis examiner les verdicts. Cette galerie n’est pas un rendu 3D du monde. **Ne jamais recopier la base du pilote sur la base familiale** ; une éventuelle mise en service sera effectuée sur la base active conservée, avec ses gardes.

Commandes sans génération :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --prepare
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --check-preservation
```

`--prepare` affiche le plan si la copie existe déjà. `--check-preservation` compare les 26 tables actives au point de départ ; une activité familiale ultérieure doit être conservée et examinée, jamais restaurée à l’ancien état.

## Contrôles et suite

**62 tests ciblés passent** : runtime 26, nouveau détourage/croissance 5, garde d’évolution 30, projection parent 1. SQLite uniquement en mémoire dans les tests ; PNG temporaires et HTTP simulé. Présence des trois stades, références vision, refus de croissance/identité, manifeste corrompu, route d’image ado/adulte, publication atomique, garde de progression et budget vérifiés. Le test de fond coloré a détecté puis fait corriger un risque de suppression de la silhouette ; le refus est désormais explicite avant détourage.

Typage, lint/format ciblés et build production webpack réussis. Base familiale : **26 tables identiques, intégrité `ok`**, aucun seed, remplacement ou migration. Point de comparaison : [source-baseline.json](teddy-world-pilot/source-baseline.json), preuve horodatée `teddy-world-pilot/preservation-*.json`. Toutes les modifications restent locales et non commitées.

Restent ouverts : génération réelle et inspection de ses images, vérification WebGL des accessoires/décors dans un navigateur autorisé, puis stabilisation globale et mise en service familiale. Les anciens tests à adapter, couverture globale et ancien canari restent différés jusque-là. Ne pas recommencer les tranches évolution, quotidien et parent.
