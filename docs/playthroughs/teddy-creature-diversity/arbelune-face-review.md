# Arbélune doit rester un compagnon reconnaissable

11 septembre 2026. Retour utilisateur : **« arbelune adulte n'a plus de visage par contre. c'est devenu un pont »**. L’image complète a été ouverte : deux minuscules yeux et une bouche existent au centre de l’arche, mais ils ne sont pas lisibles à la taille d’une vignette. Le retour utilisateur est fondé : l’adulte ressemble à un décor. Voir [la vignette réelle de 128 px](arbelune-adult-151-thumbnail.png). La consigne précédente exigeait un visage minuscule ; elle a trop réduit son importance.

Les inspections du groupe récupéré se sont terminées pendant ce retour : `cast-completion-inspections/96e0b44c-10d3-4295-b62e-3904d9b6d5db-result.json`, **rejected**, appels 134–151 HTTP 200. Dix-sept verdicts positifs ; seul Arbélune ado échoue (`identityMatches:false`, `growthVisible:false`, style 0). L’adulte passe automatiquement (style 0,88), ce qui ne remplace pas la validation artistique. **Son rejet utilisateur est conservé séparément**, dans `data/teddy-world-pilot/arbelune-user-review.json`, avec référence exacte et empreinte du PNG ; aucun ancien verdict réécrit.

**151 appels / 10,80 € réservés / plafond cumulé 40 € déjà autorisé.** Ne relancer ni les générations terminées, ni `--cast-completion-inspect`.

## Correction limitée aux deux âges d’Arbélune

Recette `arbelune-repair-plan.json`, rattachée à la récupération et à la QA terminale par empreintes. Deux nouveaux dessins, adulte puis ado, depuis des descriptions seules, méthode ayant donné les trois âges validés de Vrillou. Les **16 autres images** restent exactes : tous les bébés et les trois âges des cinq autres espèces. Les deux anciens dessins d’Arbélune restent archivés.

Les descriptions demandent un être vivant en bois enraciné, avec son visage au centre de l’arche proche, face au lecteur : zone crème contrastée, deux yeux brun foncé séparés avec reflets, sourcils doux et bouche souriante. Zone faciale d’environ un cinquième de la portée chez l’adulte, un quart chez l’ado. La croissance vient du corps étiré, des six racines articulées et des appuis développés ; elle ne doit pas faire disparaître le personnage. Même grande ouverture centrale et quatre ouvertures supérieures, deux de chaque côté du visage. Pas de tête humaine rapportée, de visage caché sur un côté, de mobilier, de cadre ou de panneau. Corps entier sur fond blanc aux bords dégagés.

La correction des cinq autres lignées n’est pas demandée ni lancée. Leur QA positive n’est pas présentée comme une approbation artistique de l’utilisateur. Aucun nouvel art réel d’Arbélune produit ici ; la qualité du résultat reste à établir.

## Contrôle explicite du visage

Un contrôle supplémentaire, activé pour les trois âges d’Arbélune dans cette passe, demande `faceReadable` obligatoire. L’inspecteur reçoit les pixels complets et une **vraie version du même portrait à 128 × 128**, après les références d’âge, avant les planches des autres créatures. Deux yeux expressifs et une bouche doivent être immédiatement lisibles sans zoom. Grains du bois, trous architecturaux, points gravés ou visage perceptible seulement sur la grande image ne suffisent pas. False ou doute rejette le stade ; champ absent ou non booléen arrête la passe. Les autres gardes de sécurité, texte, style, milieu, originalité, identité et croissance restent nécessaires. Les anciens assets n’exigeant pas ce nouveau signal gardent leur contrat ; aucune ancienne QA archivée n’est reclassée.

Les dix-huit images finales sont ensuite inspectées à neuf avec leurs vrais pairs : chaque ado entre bébé/adulte, chaque adulte au-delà du bébé et du nouvel ado. Tous les pairs finaux sont présents. Le visage plus grand ne suffit pas à prouver la croissance. Aucun verdict négatif ne déclenche de génération additionnelle ; aucune publication automatique.

## Commande prête et budget

Depuis `app/`, sous Node 22 dans le Terminal utilisateur :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --arbelune-repair
```

Plan réel `--arbelune-repair-plan` exécuté sans API : **2 images, 16 images conservées, 18 inspections**, **1,10 € supplémentaires**, cumul prévu **11,90 € / 40 €**. Marqueur distinct `arbelune-repair-started.json`, brouillons après chaque image, QA/bilan `arbelune-repairs/`, galerie `preview-arbelune-repair-<uuid>.html`. Gardes de sources, utilisateur, catalogue, progression, mois et budget maintenues avant chaque appel ; bases en lecture seule, réservations avant requête, aucun retry. Tout conserver en cas d’arrêt.

L’accès Gemini reste bloqué dans l’environnement de l’agent ; aucun nouvel appel ni contournement essayé. L’autorisation budgétaire existe déjà, ne pas la redemander. Cette correction ajoute 1,10 € à l’estimation précédente : **32,40 € cumulés** avec le socle 0–5 estimé à 20,50 €, hors autres corrections/conception payante.

## Vérifications et suite

**56 tests ciblés distincts passent** : 39 lignée/reprise/correction, 6 visage, 10 génération des âges, 1 suivi CLI. Onze nouveaux tests portent sur le visage obligatoire, un vrai PNG 128 px, les gardes maintenues, le rejet humain indépendant du verdict machine, deux seules images remplacées, les 18 QA et le budget complet. Typage/lint/format réussis, plan réel sans API vérifié. **26 tables familiales inchangées, intégrité ok**. Aucune écriture de base, seed, migration/restauration, ni changement des sessions/possessions/stades/reçus/recalibrage/Teddy.

Suite : résultat et examen visuel d’Arbélune → validation du groupe → renouvellement 0–5 déjà autorisé → stabilisation et mise en service familiale. Aucun nouvel essai familial/WebGL, aucun élargissement aux anciens tests/couverture/canari avant stabilisation.
