# Monde 0 : sept bébés validés, quatorze évolutions préparées

## Résultat et accord

La correction `8855a954-26ce-47d1-a746-3bc86298a774` est terminée : Lucéran a été remplacé dans le candidat et les six autres images sont restées exactes. **Sept inspections positives, `fullValidation:true`**, après les appels 225–232. Le nouveau Lucéran est sans ailes, avec une face crème intégrée à un corps cuivre bas et un éventail arrière. Ses pixels ont été ouverts et examinés. [Les sept bébés conservés](renewal-8855-babies-approved.png).

Le retour utilisateur **« ok : »**, joint au bilan positif après son accord sur les six autres bébés, est pris comme accord de poursuite sur le groupe corrigé. Il est enregistré dans `data/teddy-world-pilot/renewal/0/babies-approved.json`. Les anciens accords et refus restent séparés. Aucun monde ou compagnon n’est encore publié dans le jeu.

**232 appels / 15,50 € réservés / plafond cumulé 40 € déjà autorisé.** Aucun nouvel appel Gemini réel exécuté ici.

## Passe des trois âges

Depuis `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-growth
```

Le plan `--renewal-0-growth-plan` est vérifié sans API. Cette passe conserve les **sept bébés**, produit **sept adultes puis sept ados**, et inspecte les **21 images finales**. Réservations prévues : **2,45 € supplémentaires / 17,95 € cumulés**. Les évolutions du monde 0 sont déjà incluses dans le budget prévisionnel global **34,95 €** de la refonte ; ne pas les compter une seconde fois. Les 34 créatures des mondes 1–5 représentent encore 17 € hors corrections. Marge prévisionnelle 5,05 € sur 40 €, avant autres corrections/finalisation payante du pilote.

Les quatorze descriptions sont dans `renewal/0/growth-plan.json`. Elles décrivent les identités des pixels examinés, puis des proportions et structures distinctes pour chaque âge. La génération utilise des **descriptions seules**, méthode retenue sur le pilote ; aucune image bébé n’est utilisée pour figer les proportions de génération. Les images exactes restent obligatoires dans la QA.

| Créature | Transformation prévue |
| --- | --- |
| Mycélou | Stipe progressivement exposé puis haut, grand éventail plissé mature, même visage sous le chapeau |
| Tavelle | Corps plus long et bas, thorax distinct, six pattes articulées et palettes de fouissage développées |
| Orsil | Quatre sections qui s’allongent, huit coussinets qui soulèvent le ventre, visage proportionnellement plus petit |
| Pivertin | Cou et poitrine allongés, ailes repliées longues, pattes et queue d’appui développées |
| Fougrette | Longue fronde en S et folioles déployées ; visage conservé dans la boucle supérieure du bébé |
| Lucéran | Corps bas puis long, plaques étirées, pieds/fourche de saut développés et éventail arrière plus ouvert |
| Tormille | Tronc horizontal long sur quatre pattes-racines développées ; visage lisible à l’extrémité avant |

Chaque ado doit être nettement intermédiaire entre bébé et adulte. Les adultes développent aussi le corps et les structures au-delà de l’ado. Les poses, accessoires et changements d’échelle seuls ne sont pas des évolutions.

## Validation et conservation

Le chargement vérifie l’accord, le bilan complet positif, le marqueur, le brouillon, la trace et les sept PNG par empreintes, puis la chaîne de correction antérieure et l’inventaire familial. Aucun ancien lot refusé n’est promu. Les noms, identifiants, espèces, raretés et tirages restent liés aux correspondances actuelles.

La QA compare chaque ado au bébé **et à l’adulte**, chaque adulte au bébé **et à l’ado**. Elle examine aussi le catalogue existant et les dix-huit arts du pilote accepté, ainsi que les trois âges des six autres créatures du lot. Un contrôle du visage à 128 px est appliqué aux **21 images**, avec identité/croissance pour les quatorze âges suivants, milieu, originalité, texte et sécurité. Aucun seuil abaissé. `fullValidation:true` exige **21 verdicts positifs** ; le code partagé garde le même contrat pour les groupes de six du pilote.

Les bases familiale et pilote restent ouvertes en lecture seule. La passe utilise le verrou et le budget cumulatif existants ; elle refuse de commencer sans les fonds pour toutes les images et leurs inspections. Sources, budget et catalogue sont revérifiés avant chaque appel. Zéro réessai automatique.

Nouveau marqueur `renewal/0/growth-started.json`. Brouillon initial puis sauvegarde après chaque âge terminé (`<run>-draft-0.json` à `<run>-draft-14.json`), copie complète `<run>-draft.json`, diagnostics unitaires et bilan dans le même dossier. Les images brutes et les dépenses restent dans les journaux cumulés. Galerie progressive `preview-renewal-0-growth-<run>.html`, sept lignes bébé/ado/adulte. Après un arrêt, conserver tous ces fichiers ; ne pas effacer le marqueur pour relancer.

Le réseau Gemini reste bloqué pour l’agent ; les appels réels sont à lancer dans le Terminal utilisateur, comme les passes précédentes. Aucun contournement ni nouvelle tentative réseau ici. Aucune évolution réelle de ce lot n’a encore été produite.

## Contrôles de cette tranche

**78 tests ciblés distincts passent** : quatorze parcours de l’outillage de refonte (dont cinq nouveaux cas pour les évolutions), les 63 tests récents du pilote qui partagent l’inspecteur, et le suivi. La simulation de 35 requêtes HTTP vérifie les quatorze générations sans références, les 21 QA avec extrémités d’âge/visage/pairs complets, les sept bébés exacts, les quinze sauvegardes et les 21 images de la galerie. Un refus de croissance ou de visage empêche la validation ; interruption, budget incomplet, mutation d’un bébé approuvé et second lancement sont couverts. Les bases temporaires gardent exactement leurs octets.

Typage, lint et format passent. Le plan réel sans API recharge les sources actuelles. Préservation familiale : **26 tables inchangées, intégrité ok**. Aucun seed/migration/remplacement/restauration, serveur ni nouvel essai familial/WebGL. Sessions, possessions, surnoms, stades, reçus, arts de Teddy et recalibrage préservés. Anciens tests, adaptation, couverture globale et canari restent différés.

Suite : résultat réel et examen des trois âges du monde 0 → autres mondes autorisés → intégration du pilote → stabilisation/mise en service familiale. Les dix-huit arts acceptés du pilote restent conservés.
