# TEDDy — accessoires et raccordement de la génération

> **Suite prioritaire : [monde pilote et trois stades](TEDDy-monde-pilote.md).** Les futurs arts ado/adulte sont maintenant raccordés et contrôlés avec HTTP simulé. Copie cohérente préparée, clé Gemini retrouvée dans l’origine, mais API inaccessible (`ENOTFOUND`) : aucune génération payante ni mise en service. Le compte rendu ci-dessous décrit la livraison précédente.

11 septembre 2026. Suite du retour « ok ça marche, c’est pas mal », du rappel des accessoires et de l’accord pour poursuivre. L’appréciation concerne l’aperçu précédent ; aucun nouvel essai familial ni rendu des accessoires n’est revendiqué.

## Livré

Teddy conserve corps, visage, étiquette et articulations. `public/forest/teddy-accessories.js` habille ce même modèle : masque transparent et tuba (océan), foulard (les deux forêts), cape étoilée (magie), casque transparent (galaxie), nœud rayé (bonbons), bonnet à pompon (neige). Le choix suit le thème réellement résolu, y compris le checkpoint repris. L’[aperçu autonome](teddy-worlds/preview.html) est régénéré.

`scripts/worldgen-worker.ts` raccorde le worker existant au stockage et à un inspecteur Gemini asynchrone, via `runtime.ts`. Aucun lancement automatique depuis Next, aucune migration ni aucun seed dans ce script. Les dépendances factices historiques restent disponibles pour les anciens tests ; le point d’entrée opérationnel est ce script.

- Deux mondes d’avance selon la progression du foyer, le monde ouvert par un boss et les aventures sauvegardées. Socle et mondes déjà ouverts préservés. Les essais épuisés ne sont pas remis indéfiniment dans la file.
- Thèmes du catalogue existant, en évitant les deux thèmes précédents réels, socle familial compris. Un thème déjà enregistré reste stable au réessai.
- Vrais PNG sous `storage/generated/world/<index>/`, noms immuables `runtime-<uuid>-…` par tentative. La route `/generated/world/[world]/[file]` sert les images apparues après le démarrage de Next. Images publiques existantes conservées.
- Inspection de chaque image écrite : texte parasite, contenu inapproprié/effrayant, cohérence de style ; Teddy comparé au master approuvé. Réponse absente, bloquée, illisible ou scores hors bornes → refus. Seuils existants conservés. Aucune donnée enfant transmise.
- Catalogue candidat dans un manifeste sur disque. **Les créatures n’entrent dans `characters` qu’avec l’activation**, dans la même transaction : aucun art en attente/rejeté dans les œufs, éclats ou récompenses. L’aperçu parent lit le manifeste après QA ; approbation et rejet restent gardés. Une collision d’identité annule toute la publication.
- Garde après génération puis après inspection, dans les transactions. Si l’enfant atteint entre-temps le monde de secours, le candidat ne remplace pas son parcours. Même protection à l’approbation parent tardive.
- Réservation budgétaire persistée **avant chaque requête HTTP**, erreurs/réessais compris, dans `storage/worldgen/budget/<mois UTC>/`. Montants configurés selon les modèles : ce journal borne les réservations du worker, ce n’est pas une facture ni une garantie sur la tarification externe. Plafond mensuel existant conservé.
- Processus unique avec verrou exclusif à côté de la base. Arrêt SIGINT/SIGTERM après le travail en cours. Reprise des jobs interrompus au démarrage ; après un arrêt brutal laissant le verrou, vérifier que le processus est mort avant d’enlever ce verrou. Aucune suppression automatique hasardeuse.

Le master approuvé manquait dans `app/storage/`. Recopié **sans remplacement** depuis la copie d’origine : `storage/reference/teddy/teddy-master.png`, SHA-256 `6a4bca962e9bf2dadcec99a1d484cac4f88a51c5d3c59ccc226405f87b907264`. Aucune nouvelle image ni approbation de Teddy produite.

## Vérification et limites

**22 nouveaux tests de runtime passent**, SQLite exclusivement en mémoire, vrais PNG temporaires, transport HTTP simulé. Ils couvrent écriture/lecture des images, scène issue d’un monde actif, inspection complète et référence Teddy, trois règles QA et réponses malformées, parent/aperçu, refus tardif, publication atomique, conservation des 41 compagnons, buffer, budget persistant, reprise de job et sessions. La route HTTP est appelée directement ; ce n’est pas un parcours réseau navigateur.

Avec checkpoint/scènes/aperçu parent : **50 tests ciblés distincts passent**. Typage, lint/format ciblés et build production webpack passent. Anciens tests/adaptation, couverture globale et ancien canari restent différés.

Le contrôle Three.js exerce six accessoires distincts en volumes, identité du corps/visage inchangée, pause/reprise, mouvements réduits, déterminisme et libération. Le HTML livré démarre et expose sept décors/cartes sous jsdom. [Géométrie](teddy-worlds/scene-check.json), [démarrage](teddy-worlds/preview-startup-check.json).

**Chromium reste bloqué** : `MachPortRendezvousServer … Permission denied (1100)`. Aucun contournement ni nouvelle capture WebGL inspectée. Pixels des accessoires, lisibilité depuis la caméra et performances restent à vérifier dans un navigateur autorisé.

## Mise en route préparée, non exécutée

Depuis `app/`, Node 22. Contrôle sans effets de bord :

```sh
DATABASE_PATH=data/multiplyz.sqlite node --env-file-if-exists=.env.local --conditions=react-server --import tsx scripts/worldgen-worker.ts --check
```

Le [contrôle effectué](teddy-worlds/runtime-plan.json), sans fichier d’environnement chargé, trouve six mondes socle, dernier index réservé 5 et cibles 6/7. Il manque dans l’environnement du worker : `GEMINI_API_KEY`, `WORLDGEN_QA_MODEL` (images + JSON sur `generateContent`), `WORLDGEN_IMAGE_RESERVATION_EUR` et `WORLDGEN_QA_RESERVATION_EUR` (réservations prudentes par requête selon les modèles retenus).

`IMAGE_MODEL`, paramètres de génération et réglage parental restent ceux de la configuration existante. Nouvelles variables décrites dans `.env.example`. Contrat REST vérifié dans la documentation officielle de [generateContent](https://ai.google.dev/api/generate-content) et des [réponses structurées](https://ai.google.dev/gemini-api/docs/migrate-to-interactions#structured-output). **Compatibilité et qualité du modèle choisi restent à confirmer par un essai réel borné.**

Après configuration, les commandes qui consomment l’API sont :

```sh
DATABASE_PATH=data/multiplyz.sqlite node --env-file-if-exists=.env.local --conditions=react-server --import tsx scripts/worldgen-worker.ts --once
DATABASE_PATH=data/multiplyz.sqlite node --env-file-if-exists=.env.local --conditions=react-server --import tsx scripts/worldgen-worker.ts --daemon
```

`--once` traite au plus un job ; `--daemon` maintient le buffer avec intervalle de 30 secondes. Sauvegarder ensemble `storage/generated`, `storage/worldgen/budget` et la base. En déploiement, Nginx doit laisser atteindre la route Next pour les nouveaux `/generated/world/…` ; une règle servant uniquement `public/generated` doit être ajustée. Démarrage Next familial : commande directe documentée, **jamais `pnpm dev`**.

**Aucun appel payant, aucun job familial et aucun daemon lancé pendant cette tranche.** Préparation technique livrée ; génération réellement observée, contrôle visuel et mise en service restent ouverts. Les scènes 3D restent des compositions par thème avec placement déterministe : cette API ne produit pas de nouvelle géométrie 3D. Génération des futurs arts ado/adulte non ajoutée ; les 82 arts existants sont préservés.

## Données et suite

Base active `data/multiplyz.sqlite` jamais remplacée, migrée ou seedée. **26 tables identiques avant/après ; intégrité `ok`**. [Preuve](teddy-worlds/runtime-data-preservation.json). Secours avant : `data/backups/teddy-before-world-runtime-20260911T062739Z.sqlite`. Après : `data/backups/teddy-world-runtime-delivered-20260911T063917Z.sqlite`, SHA-256 `b49aa697b584ffbb1c034e5e5dd6900d6e51e1c81897462efc7d1fb651086bc9`. Ne jamais les recopier sur la base active ni perdre une activité ultérieure.

Tout reste local, non commité, sans PR/merge/déploiement. Suite : inspecter les accessoires, configurer/éprouver la génération réelle, terminer les contrôles navigateur et la stabilisation familiale. Ne pas recommencer évolution, quotidien ou espace parent.
