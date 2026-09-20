# TEDDy — diversité des mondes

**Suite du 11 septembre :** l’utilisateur confirme que l’aperçu corrigé fonctionne (« c’est pas mal »), puis rappelle les accessoires et approuve la poursuite. Accessoires par monde désormais portés par Teddy 3D ; générateur raccordé côté code, avec stockage réel, inspection, aperçu parent et publication atomique. **Pas de génération API réelle ni de nouveau parcours familial.** Lire [le compte rendu actualisé](TEDDy-generation.md) avant les constats historiques ci-dessous.

11 septembre 2026 · Implémentation locale dans `app/`, branche `feat/teddy-first-slice`. **Contrôles source et géométrie réalisés ; inspection des pixels et parcours navigateur à terminer.** Aucun nouvel essai utilisateur/familial n’est rapporté. Évolution, quotidien et parent ne sont pas recommencés.

## Décors et raccordement

Le thème **enregistré** pilote maintenant la scène, les titres, l’introduction, le gardien et la conclusion, sur la carte et dans le passage. La première forêt garde sa géométrie, son Teddy et son cadrage de référence. Les cinq autres thèmes utilisent des géométries propres, et la seconde forêt familiale reçoit une clairière distincte :

| Thème enregistré | Scène | Composition |
|---|---|---|
| Forêt, premier monde | Passage des lucioles | Géants, voûte de branches, champignons, racines — référence préservée. |
| Forêt, mondes ultérieurs | Clairière des lanternes | Saules plus bas, bassins, fleurs, lanternes et porte de pierre. |
| Magie | Jardins suspendus | Îlots, pont, cristaux, lanternes suspendues, tours et nuages en contrebas. |
| Neige | Lanternes du grand blanc | Vallée, congères, sapins, pics, glace et aurores. |
| Bonbons | Promenade des délices | Dalles de biscuit, rubans de caramel, collines, sucettes en spirale et porte de brioche. |
| Océan | Jardin des perles | Sable, coraux ramifiés, algues, coquillages, bulles et surface ondulée au-dessus. |
| Galaxie | Pont des constellations | Dalles suspendues, roches lunaires, planètes, grand anneau et constellations. |

La base familiale contient, dans l’ordre : **forêt, magie, neige, bonbons, forêt, océan**. La galaxie est disponible pour le catalogue/générateur existant, sans réaffecter un monde familial. Les 41 compagnons et leurs 82 arts ado/adulte restent inchangés. Les variantes locales de placement restent déterministes depuis l’index du monde. Un thème futur inconnu utilise une narration neutre et le gabarit des jardins suspendus comme repli, sans prétendre être un thème inédit relu.

`public/forest/biomes.js` construit les nouveaux environnements en volumes. `world.js` conserve le Teddy, la caméra, l’avancement et le rendu partagés. Ce sont des décors procéduraux dans le langage 3D accepté, **pas de nouveaux bitmaps IA**. Les polices et Three.js restent locaux. Les décors n’inventent aucun compagnon de collection ; Lumo reste limité au premier gabarit de forêt, hors acquisition.

`presentAdventureWorld` lit le monde de **l’index du checkpoint**, y compris pour un reçu de boss antérieur à la carte désormais débloquée. La présentation `worldTheme` est ajoutée aux réponses serveur et n’est jamais persistée dans la session. Les commandes, révisions, règles d’aide, moteur, gains, recalibrage et priorité de la partie active ne sont pas modifiés. Une palette illisible ou un socle visuel absent rend un décor neutre sans transformer une réponse déjà enregistrée en erreur réseau ; les autres erreurs opérationnelles restent propagées.

Le résolveur `resolveWorld` garde la priorité des mondes `active`, le repli pour `buffered`/`rejected` et le catalogue socle. **Aucun pipeline de génération, statut, approbation ou asset familial n’est réécrit.** Les fonds 2D validés restent disponibles derrière la scène en repli WebGL via `AssetImage`, avec sa garde d’URL et son repli de fichier absent. Le décor 3D normal utilise le thème et le placement déterministe, pas les anciens fonds comme textures du terrain. Les anciens assets tuiles/Teddy restent conservés et visibles dans les aperçus parent ; le Teddy 3D validé reste le personnage en jeu. Aucune génération réelle ni nouvelle approbation parent n’a été effectuée ici. Worker, QA d’images et service familial demeurent dans la stabilisation.

Les titres et commandes ont un fond opaque pour rester lisibles devant la neige, le ciel et les perles. La scène respecte la préférence système, la préférence locale existante `teddy:reduced`, la pause, les envois et les erreurs réseau transmis par l’aventure. Correction de présentation : une scène montée **déjà en pause** calcule sa caméra et son avancement avant de figer le rendu ; elle ne s’affiche plus depuis une caméra non initialisée. Changement de monde et démontage libèrent les ressources. La perte de contexte WebGL laisse le jeu et son fond de repli disponibles.

## Contrôles réalisés

**119 tests ciblés passent, dont 27 nouveaux** : 10 présentation/serveur, 11 composition/narration, 6 repli/contrastes. Les contrôles voisins conservés couvrent les références d’assets, le résolveur et les statuts, la reprise quotidienne et le recalibrage monotone, les aides. Plusieurs lectures sont exercées avec SQLite `query_only`. Les fixtures de tests sont en mémoire ou dans les répertoires temporaires des tests existants ; aucun seed n’est lancé sur une base de fichier familiale ou de parcours.

`scripts/check-worlds-scene.mjs` exécute la **vraie construction Three.js et la boucle de scène** avec un rendu GL factice : sept géométries distinctes (couleurs exclues de l’empreinte), plus un repli ; sommets finis, déterminisme, reprise à 3/6 déjà en pause, progression à 4/6, fin/recommencement, Teddy dans le cadre géométrique final, arrêt en pause/mode réduit et libération. [Rapport](teddy-worlds/scene-check.json). **Ce contrôle n’a produit aucun pixel et ne mesure ni contraste peint, ni occultation, ni performance GPU.** Les paires de tokens opaques passent en clair/sombre ; cela ne vaut pas inspection de leur implantation à l’écran.

TypeScript, lint/format ciblés et build production **webpack** passent. Build isolé `.next-worlds-check` sous `TEDDY_CHECK_BUILD=worlds`, avec le chemin de la base parent de contrôle existante ; aucune migration ou seed. Les anciennes bases de parcours ne sont pas réinitialisées.

Un lancement initial des anciens `AdventureScreen.test.tsx` a retrouvé **8 échecs de harnais** : `invariant expected app router to be mounted` (le composant utilise déjà le routeur depuis la tranche quotidienne). Ils ne sont pas adaptés ici. Le nouveau fichier `WorldScenes.test.tsx` fournit le contexte simulé adéquat pour les contrôles de cette tranche. **Anciens tests, adaptation, couverture globale et canari historique restent différés, sans abaissement de gate.**

## Vérification visuelle bloquée dans cet environnement

- Le démarrage direct de Next sur `127.0.0.1:3218` est refusé par le bac à sable : `listen EPERM`.
- Chromium via Playwright est refusé par macOS dans le bac à sable : `MachPortRendezvousServer … Permission denied (1100)`.
- Aucun navigateur connecté n’est disponible ; l’outil de contrôle natif a refusé Safari : `Computer Use was not approved to use Safari`.

Aucun de ces refus n’a été contourné. **Pas de capture navigateur nouvelle ni d’inspection des pixels revendiquée.** La passe 1280/1024/390/320, les occultations, la fluidité, les erreurs réelles WebGL, les changements de thème et la reprise réseau en navigateur restent à effectuer avant de clore cette tranche et passer à la stabilisation finale. La route familiale n’a pas été visitée et aucun nouveau calcul n’a été joué.

## Aperçu et reprise des contrôles

**Correction après signalement utilisateur de l’aperçu vide (11 septembre).** Le HTML livré levait `ReferenceError: process is not defined` avant tout montage React. Reproduction sur le fichier complet par jsdom ; reproduction minimale avec le seul import de `next/link`, tandis que React seul démarrait. Le bundle autonome importait le routeur Next, qui lit des variables `process.env.__NEXT_*` normalement fournies par Next. Le générateur remplace désormais **uniquement pour cet artefact** `next/link` par des ancres dont la navigation est neutralisée. Le code de navigation de l’application n’est pas changé.

Régression : `node scripts/check-worlds-preview.mjs` exécute le **HTML produit**, exige titre et trois sélecteurs, parcourt les sept décors et leurs cartes (11 nœuds), vérifie la navigation neutralisée et l’absence d’exception. Le contrôle était rouge avec l’artefact précédent, puis passe après régénération. [Résultat](teddy-worlds/preview-startup-check.json). Ce test jsdom vérifie démarrage/interactions ; la vérification des pixels WebGL reste distincte et à terminer. Aucun accès à une base n’est nécessaire au correctif.

[Aperçu autonome](teddy-worlds/preview.html), environ 1 Mo, construit à partir des composants réels. Ouvrir ce fichier local dans un navigateur : choisir le décor, la carte ou le passage, l’avancée, le mouvement et la pause. **Atelier d’art uniquement, sans partie, base, gain ou progression** ; liens de la carte inertes. Cet artefact ne présente pas un état de jeu familial. `scripts/build-worlds-preview.mjs` assemble React, scène, CSS et polices ; il remplace uniquement le chargement du module de scène par son inclusion dans le bundle local.

La route `/atelier/mondes` propose le même atelier en développement ou dans le build de contrôle `worlds` ; elle répond `notFound` dans un build familial de production ordinaire. Aucun lien n’est ajouté au parcours de l’enfant. La route hérite du layout normal (lectures de réglages), tandis que le fichier autonome ne touche aucune base.

Depuis `app/`, avec Node 22 :

```sh
node scripts/build-worlds-preview.mjs
node scripts/check-worlds-preview.mjs
node scripts/check-worlds-scene.mjs
node scripts/check-teddy-worlds.mjs
```

La dernière commande attend un environnement autorisant Chromium. Elle prépare les captures et vérifie débordement, cibles et arrêt de l’animation ; **ouvrir ensuite les images et inspecter les pixels**, puis vérifier la vraie carte/partie en cours sur une copie cohérente de la base de contrôle déjà jouée, sans seed. L’atelier ne remplace pas ce dernier raccordement navigateur. Les scripts navigateur n’ont pas encore achevé une exécution et pourront nécessiter un ajustement de sélecteurs.

La commande familiale autorisée reste, après vérification du serveur :

```sh
DATABASE_PATH=data/multiplyz.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

**Jamais `pnpm dev`.** Le serveur n’a pas pu être relancé depuis cet environnement.

## Données

La base active est toujours **`data/multiplyz.sqlite`**, jamais remplacée, migrée ou seedée. Sauvegarde cohérente avant les travaux : `data/backups/teddy-before-worlds-20260911T055818Z.sqlite`. **Les 26 tables sont identiques avant/après, intégrité `ok`.** Sauvegarde après contrôles : `data/backups/teddy-worlds-delivered-20260911T061302Z.sqlite`, SHA-256 `b49aa697b584ffbb1c034e5e5dd6900d6e51e1c81897462efc7d1fb651086bc9` (identique au début). Comparaison complète : [preuve de préservation](teddy-worlds/data-preservation.json). La sauvegarde reste un secours, jamais une base à recopier par-dessus l’état familial courant.

Tout reste local et non commité. Prochaine action : terminer la vérification visuelle de cette implémentation, corriger les défauts effectivement observés, puis stabilisation et mise en service familiale. Ne pas recréer les scènes ou les tranches précédentes.
