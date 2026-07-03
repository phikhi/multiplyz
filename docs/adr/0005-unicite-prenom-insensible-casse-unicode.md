# 5. Unicité du prénom insensible à la casse Unicode (colonne dérivée `name_key`)

- **Statut** : accepté
- **Type** : data
- **Portée** : mineure (durcissement in-contract d'un invariant déjà promis — l'agent orchestrateur accepte, ADR 0003)
- **Liens** : issues #37 · #89 · #105 · PR #91 · #106 · specs [AUTH.md](../../AUTH.md) §1 · [PLAN.md](../../PLAN.md) §Modèle de données
- **Amendement** : #105 / PR #106 — colonne `name_key` **nullable** (au lieu de `NOT NULL`) + backfill applicatif (voir [Addendum](#addendum-105--colonne-nullable--backfill-applicatif)).

## Contexte

Le contrat auth-lite promet une **unicité de prénom insensible à la casse** (« les prénoms sont uniques dans le foyer », AUTH §1 ; « name (unique) », PLAN §data). L'implémentation initiale (#2.2/#2.3) faisait respecter cet invariant au **niveau requête** via `lower(name)` (LEARNINGS #34 : éviter le callback d'extras drizzle qui casse le gate 100 % fonctions).

Or `lower()` de SQLite est **ASCII-only** : `lower('Élodie') = 'Élodie' ≠ 'élodie'`. Un doublon à **capitale accentuée** (`Élodie` vs `élodie`) n'était donc **pas** détecté — invariant violé pour des prénoms accentués courants (français, enfant). Découvert en review #30/#31 (issue #37), non bloquant en #2.2 (`nameTaken` inatteignable table vide) mais **load-bearing** dès qu'un second profil ou un lookup insensible à la casse existe.

Ce n'est **pas** un nouvel invariant : c'est un **durcissement** (le HOW dans le WHAT déjà écrit) → in-contract.

## Décision

Introduire une **colonne dérivée `name_key`** sur `profiles`, calculée côté application par `nameKey(name)` (`src/lib/auth/validation.ts`) :

```
nameKey(raw) = sanitizeName(raw)      // trim + espaces compactés
                 .normalize("NFC")     // forme composée canonique
                 .toLocaleLowerCase()  // minuscule locale-aware (couvre É→é)
```

- Un **index UNIQUE `profiles_name_key_unique`** est déclaré sur `name_key` via la **méthode chaînée `.unique()` de la colonne** (`text("name_key").unique("profiles_name_key_unique")` — colonne **nullable** depuis #105, voir Addendum) — **pas** via le callback d'extras 3ᵉ-arg `sqliteTable(name, cols, (t) => [...])`. C'est **ce callback** qui casse le gate 100 % fonctions (jamais invoqué au runtime, LEARNINGS #34/#46) ; le `.unique()` de colonne n'ajoute **aucune** fonction non couverte (vérifié : `schema.ts` reste à 100 % lignes/fonctions/branches). drizzle-kit **sérialise** donc l'index dans le snapshot **et** dans le SQL généré (`drizzle/0005_*.sql`) → `schema.ts` ↔ snapshot ↔ SQL réel **cohérents**, `pnpm db:generate` = **no-op**.
- L'onboarding (`createHousehold`) **écrit** `name_key = nameKey(name)`. Le check d'unicité (`nameTaken`) **matche** sur `name_key` (plus sur `lower(name)`). Même clé des deux côtés de la comparaison.
- L'index UNIQUE sur `name` (BINARY) **reste** en garde-fou secondaire.

La normalisation Unicode se fait **côté application** (JS `toLocaleLowerCase("fr-FR")` + NFC), là où SQLite est aveugle. Locale **figée** (`fr-FR`) pour ne pas dépendre de la locale du runtime (VPS). Aucune donnée à migrer (greenfield).

## Alternatives

- **`COLLATE NOCASE` sur `name`** → rejeté : NOCASE de SQLite est **ASCII-only** aussi (ne résout pas `É`/`é`).
- **Extension SQLite ICU / fonction `lower()` Unicode** → rejeté : dépendance native supplémentaire, hors STACK, pour un foyer single-tenant.
- **Normalisation des deux côtés du lookup sans colonne ni index** → rejeté : plus simple mais l'invariant ne serait porté **qu'au niveau requête** (pas de défense en profondeur en base ; un futur chemin d'écriture oubliant la normalisation pourrait créer un doublon). La colonne dérivée + index UNIQUE **garantit** l'invariant en base.
- **`uniqueIndex` dans le callback d'extras 3ᵉ-arg de `sqliteTable`** → rejeté : ce callback n'est jamais invoqué au runtime → casse le gate 100 % fonctions (LEARNINGS #34/#46). Le `.unique()` **de colonne** l'évite (retenu).
- **Migration SQL à la main + snapshot désynchronisé** (option initiale de la PR) → rejeté en review backend : le contrat drizzle (schema.ts ↔ snapshot ↔ SQL réel) serait rompu silencieusement — ajouter `.unique()` puis `db:generate` régénérerait une migration en doublon. Aucune garde. Remplacé par le `.unique()` de colonne (cohérent) + une **garde testée** (voir Conséquences).

## Conséquences

- **+** L'invariant d'unicité insensible à la casse **Unicode** est désormais honoré (capitales accentuées incluses) et porté **en base** (index UNIQUE), pas seulement au niveau requête.
- **+** `nameKey` est une fonction **pure** (couvrable 100 %, déterministe, locale figée `fr-FR`), réutilisable par tout futur lookup par prénom.
- **+** `schema.ts` ↔ snapshot ↔ SQL réel **cohérents** (`.unique()` de colonne) → `pnpm db:generate` est un **no-op**, pas de drift. **Garde à effet observable** : `schema.test.ts` asserte que les index de `profiles` en base (`sqlite_master`) après migration valent exactement `{profiles_name_unique, profiles_name_key_unique}` → rouge si une migration perd/ajoute un index ou si `.unique()` est retiré.
- **−** `profiles` porte une colonne dérivée `name_key` **nullable** (amendé #105 — voir Addendum) dont le **non-null est un invariant applicatif** : `createHousehold` la fournit toujours, le backfill de migration remplit les lignes `NULL`. L'index UNIQUE enforce l'unicité sur toute valeur non-null.
- **Spec** : `AUTH.md` §1 et `PLAN.md` §Modèle de données mis à jour (unicité précisée « insensible à la casse **Unicode** », colonne `name_key` + index UNIQUE).

## Addendum (#105) — colonne nullable + backfill applicatif

**Contexte.** La migration 0005 initiale faisait `ALTER TABLE profiles ADD name_key text NOT NULL` sans default. SQLite **refuse** d'ajouter une colonne `NOT NULL` sans default sur une table **déjà peuplée** (`Cannot add a NOT NULL column with default value NULL`) → `pnpm db:migrate` plantait sur toute base dev antérieure à #37 (marchait seulement sur table vide). Le backfill n'est **pas** exprimable en SQL : `nameKey()` = NFC + `toLocaleLowerCase("fr-FR")`, alors que `lower()` SQLite est ASCII-only (cf. Décision).

**Décision (in-contract, HOW-dans-le-WHAT — l'orchestrateur accepte, ADR 0003).** La colonne `name_key` reste **nullable** au niveau moteur, sur les **quatre** plans alignés — `schema.ts` (pas de `.notNull()`) ↔ snapshot (`notNull:false`) ↔ SQL (`ADD name_key text`) ↔ base — pour **préserver la cohérence anti-drift** exigée par la doctrine snapshot/SQL (LEARNINGS #411-419) : `pnpm db:generate` reste **no-op**. L'ancienne piste « `NOT NULL` de type + colonne physiquement nullable + snapshot désynchronisé » est **rejetée** : c'est exactement le drift snapshot↔SQL déjà proscrit (Alternatives, ligne « Migration SQL à la main + snapshot désynchronisé »).

Le **non-null redevient un invariant applicatif** (déjà la posture de défense en profondeur de l'ADR), garanti par : la validation, l'INSERT `createHousehold`, et un **backfill de migration** `runMigrations` → `backfillNameKeys` (`src/lib/db/migrate.ts`) qui remplit toute ligne `name_key IS NULL` via `nameKey()` juste après `migrate()`. Idempotent (ne touche que les `NULL`).

**Collision.** Une base pré-#37 (unique BINARY sur `name`) a pu stocker `Élodie` **et** `élodie` — deux clés convergentes. Le backfill **détecte** la collision **avant toute écriture** et lève une erreur explicite nommant les profils (l'owner renomme, puis relance) ; les écritures sont **transactionnelles** (atomiques, rejeu déterministe, pas de base à demi-migrée).

**Gardes à effet observable** (`src/lib/db/db.test.ts`) : (1) migration sur table **peuplée** ne plante plus + backfille `Élodie → élodie` ; (2) colonne physiquement **nullable** après migration (`PRAGMA table_info` `notnull=0`) — rouge si un futur agent la repasse `NOT NULL` ; (3) backfill accent-correct **dérivé de `nameKey()`** (NFC + sanitize + locale, pas un `lower()` naïf) ; (4) collision → erreur explicite + aucune écriture + rejeu déterministe.

**Édition d'une migration livrée.** 0005 est **éditée** (pas de 0006) : une base pré-0005 crashe *sur* 0005, un 0006 ultérieur ne s'exécuterait jamais. Le migrator drizzle applique par timestamp (`folderMillis > lastDbMigration.created_at`), donc sur une base ayant déjà appliqué l'ancien 0005 la version éditée est **inerte** (pas de re-run). Pas de prod → aucune base tierce impactée.
