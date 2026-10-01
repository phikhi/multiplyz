# TEDDy — stabilisation et préparation Forge, 12 septembre 2026

## État accepté

Le propriétaire confirme que `http://127.0.0.1:3217` fonctionne et demande de considérer ce fonctionnement comme validé. **Cette validation utilisateur est retenue** ; l’accès navigateur agent n’est plus une condition à lui redemander. Aucun nouveau parcours navigateur agent ni playtest enfant n’est revendiqué.

Cible de mise en service précisée ensuite : **VPS OVH via Forge à créer**, domaine **teddy.phikhi.com**. Aucun serveur n’existe encore. [Dossier Forge préparé](../../deploy/forge/README.md) : stockage persistant, variables, proxy, démarrage protégé et bascule initiale. Aucun achat/provisioning, changement DNS, commit, push ou déploiement distant.

## Correctifs effectifs

- **Stockage partagé Forge** : reproduction de deux échecs avec une racine symbolique, puis correction de la résolution de cette seule racine. Lecture HTTP des images et écriture immuable passent ; traversées, fichiers symboliques et détournements de sous-dossiers restent refusés. Quatre tests isolés, aucune API.
- **15 assets historiques de décors** manquaient dans `app/public/generated/socle/1..5`. Ils existaient dans `multiplyz/public/generated` : copie exacte vers les seuls chemins absents, empreintes identiques aux originaux. Aucun art régénéré ni fichier existant remplacé.
- **5 expressions approuvées de Teddy** manquaient dans `app/storage/reference/teddy` : même réintégration exacte depuis l’origine. Le master et les arts existants sont inchangés.
- **Tests historiques adaptés** aux parcours déjà livrés : pages serveur asynchrones, diagnostic intégré, confirmations des codes et des mondes, sauvegardes confirmées par le serveur, carnet parent et navigation. Les vérifications de dénominateurs, états absents/zéro, reprise, propriété du profil et protections des mutations restent actives. Le helper de couleurs prend maintenant en compte les blocs de tokens ajoutés en fin de fichier.
- **Précontrôle de mise en service en lecture seule** : une base absente est refusée sans création ; contrôle d’intégrité, clés étrangères, schéma, journal, empreintes des tables et de tous les assets référencés. Quatre vérifications du CLI passent, dont refus d’une base absente, vide ou en mémoire. Le contrôle familial trouve **47 créatures, 168 assets, zéro placeholder**.

Le journal familial conserve une empreinte historique différente de la source pour `0005_curvy_sentinel`. Aucune correction du journal ou migration : le contrat Forge vérifie séparément le schéma réel conservé, les hashes enregistrés et les sources présentes. Ce contrat ne doit pas être régénéré automatiquement.

## Résultats et limites

- **2 971 tests réussis dans 196 fichiers**, exécution complète avec `DATABASE_PATH=:memory:` et deux workers. Les tests de stockage/migrations utilisent seulement leurs fixtures temporaires propres. Les timeouts de génération observés lors de la première passe concurrente ne se reproduisent pas avec deux workers.
- **Couverture globale encore refusée** : lignes/instructions **96,04 %**, fonctions **96,43 %**, branches **93,66 %** ; seuils conservés à **100 %**. Reste 927 lignes et 398 branches dans le rapport enregistré, notamment statut du pilote et parcours d’interface. Les tests réussis ne constituent donc pas un gate global vert.
- **Build webpack isolé et typage réussis après correctifs**, dans `.next-worlds-check`, sans remplacer le `.next` du serveur familial. Lint et format ciblés réussis ; diff-check propre. Le build isolé ne vaut pas essai du daemon Forge.
- **27 tables identiques** à la référence avant les tests, intégrité `ok`, zéro erreur de clé étrangère. Collections, surnoms, stades, monnaies, progression, sessions, reçus, recalibrage et catalogue préservés. Aucun remplacement/restauration/migration/seed de la base familiale, aucune sauvegarde réutilisée comme fixture.
- Aucun appel Gemini, worker ou génération. Contrôle du worker en lecture seule : clé de production, modèle QA et réservations par requête à configurer avant activation. Le lot artistique intégré et son budget restent inchangés.

L’ancien canari n’a pas été lancé : sa configuration historique remplace sa base E2E et exécute des migrations/seeds. Son adaptation doit utiliser un environnement neuf explicitement isolé, jamais les bases familiales, sauvegardes ou bases de contrôle existantes. Le refus de contrôle navigateur n’a pas été contourné.

## Suite

Terminer les lacunes de couverture et l’adaptation isolée du canari, puis configurer le nouveau VPS réel avec le dossier Forge. Préparer l’export de l’arbre de travail complet et, au moment de la bascule, un export cohérent de **la base active courante** vers une destination distante vide. Les sauvegardes restent des secours ; ne jamais rétablir un ancien état familial. Les vérifications HTTPS et reconnexion sur le nouveau domaine auront lieu après création du serveur.

La validation locale utilisateur, les 47 lignées et les tranches évolution/quotidien/parent sont acquises. Ne pas recommencer les générations ni réclamer ces validations.

## Preuves

- [Tests et couverture](teddy-stabilisation/20260912-final-checks.json), [lacunes détaillées](teddy-stabilisation/20260912-coverage-remaining.json).
- [Précontrôle Forge : tables et 168 assets](teddy-stabilisation/20260912-forge-preflight.json).
- [15 décors copiés à l’identique](teddy-stabilisation/20260912-missing-socle-assets.json), [5 expressions Teddy](teddy-stabilisation/20260912-missing-teddy-references.json).
- [Comparaison finale des 27 tables](teddy-stabilisation/20260912-final-after.json), [référence avant tests](teddy-stabilisation/20260912T095317Z-final-before.json).
- [Build final](teddy-stabilisation/20260912-final-build-webpack.log), [reproduction du stockage partagé](teddy-stabilisation/20260912-shared-storage-red.log).
- Première passe conservée : [état initial](teddy-stabilisation/20260912-status.json), [build initial](teddy-stabilisation/20260912-build-webpack.log).

Les journaux `.log` sont présents localement et ignorés par Git. Les JSON ne contiennent ni codes, ni jetons, ni contenu familial en clair.
