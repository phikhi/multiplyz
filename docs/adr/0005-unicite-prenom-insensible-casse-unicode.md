# 5. Unicité du prénom insensible à la casse Unicode (colonne dérivée `name_key`)

- **Statut** : accepté
- **Type** : data
- **Portée** : mineure (durcissement in-contract d'un invariant déjà promis — l'agent orchestrateur accepte, ADR 0003)
- **Liens** : issues #37 · #89 · PR #91 · specs [AUTH.md](../../AUTH.md) §1 · [PLAN.md](../../PLAN.md) §Modèle de données

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

- Un **index UNIQUE `profiles_name_key_unique`** est déclaré sur `name_key` via la **méthode chaînée `.unique()` de la colonne** (`text("name_key").notNull().unique("profiles_name_key_unique")`) — **pas** via le callback d'extras 3ᵉ-arg `sqliteTable(name, cols, (t) => [...])`. C'est **ce callback** qui casse le gate 100 % fonctions (jamais invoqué au runtime, LEARNINGS #34/#46) ; le `.unique()` de colonne n'ajoute **aucune** fonction non couverte (vérifié : `schema.ts` reste à 100 % lignes/fonctions/branches). drizzle-kit **sérialise** donc l'index dans le snapshot **et** dans le SQL généré (`drizzle/0005_*.sql`) → `schema.ts` ↔ snapshot ↔ SQL réel **cohérents**, `pnpm db:generate` = **no-op**.
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
- **−** `profiles` porte une colonne dérivée `name_key` **NOT NULL** : tout insert de profil doit la fournir (le vrai chemin `createHousehold` le fait ; les seeds de test l'ajoutent explicitement).
- **Spec** : `AUTH.md` §1 et `PLAN.md` §Modèle de données mis à jour (unicité précisée « insensible à la casse **Unicode** », colonne `name_key` + index UNIQUE).
