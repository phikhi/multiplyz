# TEDDy — préparation Forge

Pour la procédure opératoire complète, suivre [MISE-EN-PROD.md](MISE-EN-PROD.md),
qui distingue les actions locales, l’interface Forge et le terminal SSH.

Cible confirmée : **nouveau VPS OVH géré par Forge**, **teddy.phikhi.com**. Aucun serveur n’existe encore. Aucun achat, provisioning, DNS, transfert ou déploiement distant effectué. Le fonctionnement local sur `127.0.0.1:3217` est accepté par le propriétaire.

## Configuration préparée

- Node **22**, pnpm **10.0.0** ; dépendances natives réinstallées sur Linux depuis `pnpm-lock.yaml`. Ne pas envoyer `node_modules` ou un build macOS.
- Un processus web, en utilisateur du site, sur **127.0.0.1:3217**, derrière HTTPS Nginx. Commande du processus : `bash deploy/forge/start.sh`, répertoire de travail = release active contenant `package.json`, `src/`, `public/`, `scripts/`.
- [Variables](env.example), [proxy Nginx](nginx-location.conf), [démarrage protégé](start.sh), [précontrôle en lecture seule](../../scripts/forge-preflight.mjs).
- [Script de release](deploy.sh) : installation verrouillée, build et précontrôle, sans migration ni seed.
- Forge gère les processus avec Supervisor. Configurer un arrêt gracieux par SIGTERM ; relever l’identifiant du processus avant de préparer son redémarrage ciblé. [Documentation Forge](https://laravel.com/forge/docs/resources/background-processes).

## Stockage persistant

Le dépôt Git actif correspond à `app/`. Si l’export contient lui-même un sous-dossier `app`, ajuster tous les chemins et le répertoire de travail ensemble.

| Chemin dans la release | Destination stable proposée | Contenu conservé |
| --- | --- | --- |
| `data/` | `/home/forge/teddy.phikhi.com/data/` | Base courante, WAL/SHM, sessions, reçus et verrous |
| `storage/` | `/home/forge/teddy.phikhi.com/storage/` | Images immuables, références Teddy, futurs journaux budgétaires |
| `public/generated/` | `/home/forge/teddy.phikhi.com/generated/` | Assets historiques réellement servis |
| `.env` | Fichier partagé privé Forge | Configuration et secrets |

Les nouveaux sites Next.js Forge utilisent des releases et des chemins partagés. Ajouter **les dossiers entiers**, en particulier `data/`, pour que SQLite et ses fichiers WAL/SHM restent ensemble. Adapter les destinations aux chemins effectivement créés par Forge. Le correctif de stockage autorise la racine partagée et conserve les refus de liens détournant les sous-dossiers/fichiers. [Déploiements et chemins partagés Forge](https://laravel.com/forge/docs/sites/deployments).

Permissions : l’utilisateur du daemon peut écrire dans `data/` et `storage/` ; les secrets et la base ne sont pas lisibles par les autres utilisateurs. Nginx ne doit servir aucun de ces dossiers privés. Racine documentaire éventuelle : `public/`. Faire passer `/generated/world/…/runtime-….png` par Next ; une règle statique générique sur les PNG ne doit pas intercepter cette route.

## Préparer puis vérifier une release

Les changements sont encore locaux, suivis et non suivis. **Un clone de la branche ou `git archive HEAD` seul ne contient pas la livraison.** Préparer un export inventorié de l’arbre de travail courant, puis le comparer avant transfert. Exclure `.git`, `.env*`, `node_modules`, `.next*`, les bases, sauvegardes, photos privées et captures ; transférer séparément les dossiers persistants. Inclure les sources, configurations, `drizzle/`, `scripts/`, `deploy/`, `public/forest/`, les polices et le lockfile. Aucun nettoyage ou reset de l’arbre local.

Depuis une release neuve sur le VPS, sous Node 22 :

```sh
pnpm install --frozen-lockfile
node node_modules/next/dist/bin/next build --webpack
node --env-file=.env scripts/forge-preflight.mjs --runtime > preflight.json
```

Dans Forge, utiliser `bash deploy/forge/deploy.sh` comme script de déploiement (le
répertoire courant doit être la release ; sinon définir `FORGE_RELEASE_PATH`). Le
script échoue si Node n'est pas en version majeure 22. Il ne touche jamais à
`data/`, `storage/` ni à la base familiale.

Sur un VPS Ubuntu neuf, Forge fournit le système et Nginx. Vérifier seulement
avant la première release :

```sh
node --version                 # v22.x
corepack enable
corepack prepare pnpm@10.0.0 --activate
pnpm --version                 # 10.0.0
```

Si le serveur n'a pas la toolchain native, installer `python3`, `make` et `g++`
avant `pnpm install` (pour `better-sqlite3` et `sharp`). Ne pas transférer
`node_modules` ni `.next` depuis macOS.

Ne pas installer avec `--prod` avant le build : Tailwind, TypeScript, `sharp` et `tsx` sont nécessaires. Ne pas lancer `pnpm dev`, de migration, seed ou publication de catalogue. Ne pas réutiliser `.next-worlds-check` en production ; l’atelier est exclu du build familial normal. Ne pas activer le déploiement automatique à partir d’une branche distante encore incomplète.

Le précontrôle refuse une base absente au lieu d’en créer une. Il vérifie l’intégrité, les clés étrangères, le schéma familial, les migrations enregistrées, tous les assets référencés et calcule les empreintes des 27 tables. Son JSON n’expose ni PIN, ni jetons, ni noms de profils. Il n’exécute aucune mutation et n’appelle aucune API.

Le [contrat de schéma](database-contract.json) conserve explicitement la différence historique de hash de `0005_curvy_sentinel` : le journal de la famille et la source locale ont des empreintes différentes. Le précontrôle vérifie **séparément** le schéma SQLite observé, le journal intact et les sources de cette release. Ne pas réécrire le journal ni rejouer 0005. Une évolution de ce contrat exige un examen de schéma ; il ne faut pas le régénérer automatiquement au déploiement.

## Première mise en service

1. Créer le VPS dans OVH/Forge et le site `teddy.phikhi.com`, relever IP, utilisateur et chemins. Configurer DNS et certificat HTTPS dans Forge. Aucun dimensionnement payant n’est sélectionné dans cette préparation.
2. Installer la release et ses dossiers partagés ; configurer `.env` dans Forge. La clé Gemini est exigée au démarrage de production par la garde existante, même si le worker reste arrêté. Ne pas la coller dans une conversation ou un journal.
3. À l’instant de bascule convenu, interrompre les écritures familiales locales. Produire un **export SQLite cohérent depuis la base active actuelle** avec l’API de backup SQLite, vers un fichier neuf. Ne pas copier seulement le `.sqlite` d’une base en WAL pendant son utilisation. L’export sert au **premier transfert vers une destination vide** ; les sauvegardes historiques restent des secours.
4. Transférer cet export et les assets en refusant tout écrasement. Si une base existe déjà à destination, arrêter la procédure et examiner son état. Comparer l’empreinte de l’export après transport, puis comparer les tables et assets des précontrôles source/destination. Ne pas rouvrir les écritures locales pendant la bascule.
5. Activer la release puis le daemon web et le proxy HTTPS. Une seule base devient la source familiale en service ; la copie locale est conservée. Un retour de **code** ne restaure jamais une ancienne base ni un ancien catalogue.
6. Vérifier `https://teddy.phikhi.com/api/health`, l’accueil, les images et les accès enfant/parent avec les profils existants. Un changement de domaine nécessite de se reconnecter ; les sessions enregistrées restent conservées, les cookies locaux ne sont pas transférés. Aucun achat, recalibrage ou gain artificiel pour fabriquer une preuve.

Le proxy fourni transmet l’hôte et HTTPS et remplace les en-têtes IP fournis par le client. Si un CDN ou un autre proxy est ajouté plus tard, définir sa chaîne de confiance avant adaptation. Tester la configuration avec `nginx -t` avant rechargement. [Documentation Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header).

## Worker et secours

Précontrôle du worker, lecture seule, depuis la release :

```sh
node --env-file=.env --conditions=react-server --import tsx scripts/worldgen-worker.ts --check
```

Le futur processus séparé utilisera `--daemon`, **une seule instance**, la même base et les mêmes dossiers persistants. Il reste arrêté tant que modèle QA, réservations prudentes et budget ne sont pas configurés. Aucun monde déjà intégré n’est régénéré. Le contrôle local a trouvé les paramètres QA/coûts manquants ; aucun appel payant lancé.

Après mise en service, prévoir un backup SQLite cohérent régulier, les assets, journaux du worker et une copie chiffrée hors VPS. Chaque export est neuf, jamais une copie brute de la base WAL active. Les secours ne sont jamais réinjectés automatiquement ; une restauration relève d’un incident distinct. La création, la rétention et la vérification hors VPS restent à configurer sur le serveur réel.

## État des vérifications

Voir le [compte rendu de stabilisation](../../docs/playthroughs/TEDDy-stabilisation.md). Les tests unitaires passent ; le seuil global de couverture à 100 % reste non atteint. Le canari historique demande une adaptation isolée : sa configuration actuelle lance migrations/seeds et remplace sa base E2E. Ne pas l’utiliser contre une base familiale ou de contrôle existante. Ces points restent ouverts avant de déclarer la stabilisation finale achevée.
