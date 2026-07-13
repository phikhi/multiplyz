# 0013. Stockage des réglages du foyer (table `household_settings`) + source de vérité de la validation des mondes

- **Statut** : accepted
- **Type** : data
- **Portée** : mineure (in-contract — architect/orchestrateur autonome, ADR 0003/0004 ; aucune décision verrouillée PLAN/pédagogie/éco/sécurité modifiée)
- **Liens** : issue #216 (story 7.3) · PR #… · specs : `DETAILS.md` §3 (Espace parent, liste réglages VERROUILLÉE), `PRODUCT.md` §1.4, `WORLDGEN.md` §6, `AUTH.md` §1 ; ADR 0002 (config centrale), ADR 0008 (validation parent ⚙️)

## Contexte

La story 7.3 pose l'écran **Réglages parent** (DETAILS §3, liste verrouillée : thème clair/sombre, validation des mondes, temps d'écran nudge + verrou dur optionnel, langue FR grisée). **Aucune table/colonne de réglages n'existait.** Trois questions de contrat :

1. **Où stocker** les réglages (colonnes sur le profil propriétaire vs table dédiée ; portée foyer vs par-profil) ?
2. **Quelle source de vérité** pour la validation des mondes, sachant que le ⚙️ `qa.parentValidationEnabled` (env, ADR 0008, consommé par le worker 6.5) existe déjà ?
3. **Comment appliquer le thème** app-wide (source de vérité serveur, sans flash) ?

## Décision

### 1. Table dédiée `household_settings`, portée **foyer**, ligne **singleton**

Les réglages (thème, validation des mondes, temps d'écran) sont des **politiques du foyer**, pas des préférences par-enfant (DETAILS §3 les liste tous sous « Espace parent »). Single-tenant (AUTH §1) → **une seule ligne**, PK **texte constante** `HOUSEHOLD_SETTINGS_ID = "household"` (upsert idempotent `onConflictDoUpdate`). Table **partagée du foyer** (comme `worlds`/`socle_worlds`) → **pas de FK profil, pas de cascade RGPD** (non enfant-spécifique). Colonnes : `theme`, `parent_world_validation`, `screen_time_nudge_minutes`, `screen_time_hard_lock_enabled`, `screen_time_hard_lock_minutes`, `updated_at`.

**Écarté** : colonnes sur le profil propriétaire → mêlerait des réglages foyer à la ligne d'identité/PIN (surface sécu élargie), et le concept « propriétaire » est une ligne d'auth, pas un porteur de préférences. **Écarté** : portée par-profil → aucun des trois réglages n'est per-enfant (thème = app-wide ; validation = pipeline foyer ; temps d'écran = politique foyer).

### 2. Validation des mondes : **la ligne DB fait autorité**, l'env devient le défaut d'amorçage

Le worker (`processNextJob`) lit désormais `readHouseholdSettings(db).parentWorldValidation` (au lieu de `config.qa.parentValidationEnabled`) pour choisir le statut d'un monde QA-validé (`buffered` en attente d'approbation vs `active` auto). `moderatedStatusAfterQaPass` prend maintenant un **booléen** (plus la `QaConfig`). L'env `WORLDGEN_QA_PARENT_VALIDATION` reste le **défaut d'amorçage** d'un foyer neuf (via `resolveSettingsDefaults`, repli quand aucune ligne n'existe) → aucun ⚙️ mort, migration sans rupture pour un déploiement existant.

### 3. Thème appliqué app-wide par le layout racine

`app/layout.tsx` lit `readHouseholdSettings(db).theme` et pose `data-theme` sur `<html>` (`system` → aucun attribut, le média-query `prefers-color-scheme` de `tokens.css` décide ; `light`/`dark` → attribut posé). Le layout racine devient **`dynamic = "force-dynamic"` + `runtime = "nodejs"`** (lecture DB par requête, jamais prérendu). Le contrôle client applique aussi `data-theme` **immédiatement** (effet instantané), le serveur le re-stampe au rendu suivant (persistance).

### 4. Temps d'écran : **STOCKÉ + validé seulement** (enforcement en 7.8 #229)

Les trois colonnes `screen_time_*` sont posées, validées (bornes ⚙️ `parentControls` dans la config centrale, ADR 0002) et persistées. **Aucun enforcement runtime en 7.3** : le nudge de session et le verrou dur dépendent du **temps-joué persisté** (story 7.4 #217, inexistant) et seront consommés par la **story 7.8 #229**.

### 5. Migration additive sûre

Migration `0013` = `CREATE TABLE household_settings` (**table neuve** → `NOT NULL` + défauts sans le piège #105). `db:generate` no-op (schema.ts ↔ snapshot ↔ SQL cohérents). Défaut inerte (0 régression CI base fraîche : table vide → repli défauts).

## Alternatives

- **Cookie de thème** (mirroir client) pour éviter un layout dynamique : écarté — introduit une 2ᵉ source (DB↔cookie) à synchroniser (drift, faux-dérivé #182), alors que la lecture SQLite locale par requête est sub-ms (single-tenant).
- **Garder `qa.parentValidationEnabled` (env) comme seule source** : écarté — le réglage doit être modifiable par le parent depuis l'UI (DETAILS §3 (Validation des mondes)), donc persisté et autoritaire côté DB.
- **Retirer complètement `qa.parentValidationEnabled`** : écarté — le garder en défaut d'amorçage évite un ⚙️ mort et préserve le comportement d'un déploiement qui l'a positionné.

## Conséquences

- **(+)** Réglages foyer découplés de l'identité/auth ; croissance propre (nouvelle colonne = migration additive).
- **(+)** Validation des mondes réellement pilotée par le parent (effet observable runtime, mutation-prouvé côté worker).
- **(+)** Thème app-wide sans flash (SSR) + effet immédiat (client).
- **(−)** Le layout racine `force-dynamic` **désactive le prérendu statique** de tout l'arbre (ex. `/styleguide` devient dynamique). Acceptable : app **online-first**, la home et toutes les routes app étaient déjà dynamiques ; seul `/manifest.webmanifest` reste statique.
- **Specs** : `DETAILS.md` (liste réglages) déjà conforme ; cet ADR canonise le **modèle de données** des réglages + le **déplacement de la source de vérité** de la validation des mondes (env → DB). Suite : story 7.8 #229 consomme les ⚙️ de temps d'écran.
