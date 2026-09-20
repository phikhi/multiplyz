# Mise en production de TEDDy sur Forge

Ce guide décrit **qui fait quoi et où**. Les commandes marquées `SSH` se lancent
dans un terminal connecté au VPS. Les étapes `Forge` se font dans le tableau de
bord Forge. Aucun mot de passe ou jeton ne doit être copié dans un ticket, un
commit ou une conversation.

## 0. Avant de commencer — ordinateur local

Dans **Terminal local**, depuis `app/` :

```sh
git status
git branch --show-current       # doit être feat/teddy-first-slice
```

Forge déploie un commit Git, pas les modifications non commitées. Après revue,
commiter et pousser la livraison complète sur la branche de travail :

```sh
git add -A
git commit -m "chore: prepare teddy production release"
git push origin feat/teddy-first-slice
```

Ne pas utiliser `git archive HEAD` avant cette étape : il exclurait les fichiers
locaux non commités. Ne jamais ajouter `.env`, `data/`, `storage/`, les backups,
`node_modules/` ou `.next/` au commit.

## 1. Merger la livraison — interface GitHub

Dans **GitHub → dépôt `phikhi/multiplyz` → Pull requests → New pull request** :

1. Base : `main`.
2. Compare : `feat/teddy-first-slice`.
3. Relire le diff et attendre les contrôles obligatoires.
4. Merger la PR selon la règle du dépôt.

Dans **Terminal local**, vérifier ensuite la branche qui sera déployée :

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

La production doit suivre `main` après le merge, jamais la branche de travail.

## 2. Créer le serveur — interface Forge

Dans **Forge → Servers → New Server** :

1. Choisir le fournisseur OVH/VPS personnalisé et le serveur neuf.
2. Utiliser Ubuntu x64 supporté par Forge, l’accès root SSH et l’IP publique.
3. Attendre la fin du provisioning. Noter le nom de l’utilisateur de site et
   le chemin racine réellement créé par Forge.

Ne pas installer TEDDy manuellement pendant le provisioning. Forge doit créer
Nginx, Supervisor et l’utilisateur du site.

## 3. Créer le site — interface Forge

Dans **Sites → New site** :

1. Domaine : `teddy.phikhi.com`.
2. Dépôt : `phikhi/multiplyz` (ou le dépôt privé effectivement utilisé).
3. Branche : `main` après le merge de la PR.
4. Document root : laisser le chemin de release Forge par défaut.

Dans le DNS du registrar, créer ensuite un enregistrement `A` pour
`teddy.phikhi.com` vers l’IP du VPS. Dans Forge, activer le certificat
**SSL/TLS → Let’s Encrypt** après propagation DNS.

## 4. Préparer Node — terminal SSH

Se connecter au VPS avec le compte de site :

```sh
ssh -i /chemin/cle forge@IP_DU_VPS
```

Dans **SSH**, vérifier Node 22 et pnpm 10 :

```sh
node --version
corepack enable
corepack prepare pnpm@10.0.0 --activate
pnpm --version
```

La version Node doit être `22.x` et pnpm `10.0.0`. Si la compilation native
échoue, dans **SSH** (avec sudo) installer `python3`, `make` et `g++`, puis
rejouer le déploiement. Ne pas copier `node_modules` depuis le Mac.

## 5. Créer les dossiers persistants — terminal SSH

Remplacer `CHEMIN_SITE` par le chemin que Forge affiche, par exemple
`/home/forge/teddy.phikhi.com` :

```sh
CHEMIN_SITE=/home/forge/teddy.phikhi.com
mkdir -p "$CHEMIN_SITE/data" "$CHEMIN_SITE/storage" "$CHEMIN_SITE/generated"
chmod 700 "$CHEMIN_SITE/data" "$CHEMIN_SITE/storage"
```

Ces dossiers restent hors des releases. Ne pas créer de nouvelle base et ne pas
lancer de migration.

## 6. Configurer l’environnement — interface Forge

Dans **Site → Environment**, créer les variables suivantes :

```env
NODE_ENV=production
DATABASE_PATH=/home/forge/teddy.phikhi.com/data/multiplyz.sqlite
SQLITE_BUSY_TIMEOUT_MS=5000
GEMINI_API_KEY=(clé saisie directement dans Forge)
```

Adapter uniquement le préfixe du chemin au chemin réel du site. La clé Gemini
est obligatoire au démarrage, même si le worker reste arrêté. Laisser les
variables `WORLDGEN_*` absentes tant que le worker n’est pas autorisé et budgété.

## 7. Transférer la base et les assets — local puis SSH

Cette étape se fait à l’instant de bascule, après arrêt des écritures locales.

Dans **Terminal local**, créer une copie SQLite cohérente dans un fichier neuf :

```sh
cd /chemin/vers/TEDDy/app
python3 - <<'PY'
import sqlite3
src = sqlite3.connect("data/multiplyz.sqlite")
dst = sqlite3.connect("/tmp/teddy-production.sqlite")
src.backup(dst)
assert dst.execute("pragma integrity_check").fetchone()[0] == "ok"
dst.close(); src.close()
PY
```

Transférer vers un emplacement temporaire du VPS :

```sh
scp -i /chemin/cle /tmp/teddy-production.sqlite forge@IP_DU_VPS:/tmp/
```

Dans **SSH**, vérifier que la destination n’a pas déjà de base, puis installer
la copie :

```sh
CHEMIN_SITE=/home/forge/teddy.phikhi.com
test ! -e "$CHEMIN_SITE/data/multiplyz.sqlite"
mv /tmp/teddy-production.sqlite "$CHEMIN_SITE/data/multiplyz.sqlite"
chmod 600 "$CHEMIN_SITE/data/multiplyz.sqlite"
```

Copier les assets persistants avec `rsync` ou `scp` vers `storage/` et
`generated/`, sans écraser un fichier existant. Si une base existe déjà sur le
VPS, arrêter la procédure et l’examiner ; ne rien remplacer.

## 8. Configurer le déploiement — interface Forge

Dans **Site → Deployment Script**, utiliser :

```sh
bash deploy/forge/deploy.sh
```

Le script exécute `pnpm install --frozen-lockfile`, le build Next et le
précontrôle en lecture seule. Il ne lance ni `pnpm dev`, ni migration, ni seed.

Cliquer **Deploy**. En cas d’échec, lire le log de release et corriger la cause
avant tout redémarrage ; ne pas restaurer la base.

## 9. Configurer le processus web — interface Forge

Dans **Site → Daemons / Background processes**, créer un processus avec :

```sh
bash deploy/forge/start.sh
```

Répertoire de travail : la release active contenant `package.json`. Un seul
processus web, utilisateur du site, port interne `3217`. Ne pas démarrer le
worker worldgen à ce stade.

Dans la configuration Nginx HTTPS du site, remplacer uniquement la location
applicative par le contenu de [nginx-location.conf](nginx-location.conf), puis
tester/recharger Nginx depuis l’interface Forge.

## 10. Vérifier — navigateur puis SSH

Dans **SSH** :

```sh
curl --fail https://teddy.phikhi.com/api/health
```

Dans un **navigateur privé** : vérifier l’accueil, une session enfant, une
session parent, les images et les routes `/generated/world/...`. Le changement
de domaine implique une nouvelle connexion ; ne pas copier les cookies locaux.

Ne pas fabriquer d’achat, de progression ou de recalibrage pour valider la mise
en service. La base locale et ses backups restent conservés comme secours.

## 11. Déploiements suivants

Pour chaque version :

1. **Local** : tests, commit et push d’une branche de travail.
2. **GitHub** : PR vers `main`, contrôles, merge.
3. **Forge** : Deploy depuis `main`, puis redémarrage ciblé du daemon si Forge ne le fait pas.
4. **SSH** : vérifier `/api/health` et les logs.

Ne jamais modifier `DATABASE_PATH`, rejouer les migrations ou remplacer la base
lors d’un déploiement de code.
