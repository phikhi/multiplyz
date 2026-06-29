# 2. La configuration centrale possède les paramètres DB

- **Statut** : accepté
- **Type** : data
- **Portée** : majeure (sign-off humain — propriétaire, 2026-06-29)
- **Liens** : issues #12 · #14 · PR #19 · #21 · spec [STACK.md](../../STACK.md) §Base de données

## Contexte
Les stories #12 (SQLite/Drizzle) et #14 (config + env) ont été développées **en parallèle** (worktrees isolés). Chacune a défini les paramètres ⚙️ de la base :

- #14 — `src/config/server-config.ts` : `busyTimeoutMs` lu depuis `SQLITE_BUSY_TIMEOUT_MS`, `database.path` depuis `DATABASE_PATH`, `journalMode: "WAL"`.
- #12 — `src/lib/db/config.ts` : `DB_BUSY_TIMEOUT_MS = 5000` **codé en dur** (n'honore pas `SQLITE_BUSY_TIMEOUT_MS`), `DATABASE_PATH` lu.

Les valeurs coïncident aujourd'hui, mais c'est **deux sources de vérité** pour le même paramètre : un `SQLITE_BUSY_TIMEOUT_MS=8000` serait rapporté par la config (#14) tout en étant **ignoré** par la couche SQLite réelle (#12). Signalé par le reviewer Backend sur la PR #21 (la review signale, l'ADR décide — WORKFLOW §18).

## Décision
Le module **config central `src/config/server-config.ts` (#14) est la source unique** des paramètres serveur, **y compris DB** : `busyTimeoutMs`, `database.path`, `journalMode`.

La couche SQLite `src/lib/db/config.ts` (#12) **consomme** `@/config/server-config` au lieu de définir ses propres constantes. Elle honore donc `SQLITE_BUSY_TIMEOUT_MS` / `DATABASE_PATH` via le module central.

**Application** : la convergence est faite au **rebase de la 2ᵉ PR mergée**. Ordre retenu : **#14 (config) mergé d'abord**, puis **#12 (DB) rebasé converge** sa config sur `@/config/server-config`.

## Alternatives
- **#12 (couche DB) possède la config DB** → rejeté : sort les ⚙️ DB du module central, contredit la règle CLAUDE.md « paramètres ⚙️ centralisés dans un fichier de config ».
- **Modules séparés, mais #12 lit aussi `SQLITE_BUSY_TIMEOUT_MS`** → rejeté : supprime la divergence immédiate mais garde deux endroits à maintenir, pas de source unique.

## Conséquences
- **+** Source unique des ⚙️ ; cohérence garantie entre ce que la config rapporte et ce que la DB applique.
- **+** Conforme à CLAUDE.md (params centralisés) et à la posture « serveur = source de vérité ».
- **−** `src/lib/db` dépend de `@/config` (couplage assumé, sens correct : la couche basse lit la config).
- **Spec** : `STACK.md` §Base de données mis à jour (le `busy_timeout`/chemin proviennent du module config central).
- **Suite** : appliquer la convergence dans la PR #19 au rebase (après merge de #21).
