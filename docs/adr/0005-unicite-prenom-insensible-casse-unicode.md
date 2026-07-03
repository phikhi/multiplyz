# 5. Unicité du prénom insensible à la casse Unicode (colonne dérivée `name_key`)

- **Statut** : accepté
- **Type** : data
- **Portée** : mineure (durcissement in-contract d'un invariant déjà promis — l'agent orchestrateur accepte, ADR 0003)
- **Liens** : issues #37 · #89 · PR #— · specs [AUTH.md](../../AUTH.md) §1 · [PLAN.md](../../PLAN.md) §Modèle de données

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

- Un **index UNIQUE `profiles_name_key_unique`** est posé sur `name_key` par une **migration à la main** (`drizzle/0005_illegal_fantastic_four.sql`) — pas via le callback d'extras `sqliteTable` (qui casserait le gate 100 % fonctions, LEARNINGS #34/#46). L'index n'est donc **pas** reflété dans le snapshot drizzle (assumé et documenté : un `db:generate` ne le régénère ni ne le supprime).
- L'onboarding (`createHousehold`) **écrit** `name_key = nameKey(name)`. Le check d'unicité (`nameTaken`) **matche** sur `name_key` (plus sur `lower(name)`). Même clé des deux côtés de la comparaison.
- L'index UNIQUE sur `name` (BINARY) **reste** en garde-fou secondaire.

La normalisation Unicode se fait **côté application** (JS `toLocaleLowerCase` + NFC), là où SQLite est aveugle. Aucune donnée à migrer (greenfield).

## Alternatives

- **`COLLATE NOCASE` sur `name`** → rejeté : NOCASE de SQLite est **ASCII-only** aussi (ne résout pas `É`/`é`).
- **Extension SQLite ICU / fonction `lower()` Unicode** → rejeté : dépendance native supplémentaire, hors STACK, pour un foyer single-tenant.
- **Normalisation des deux côtés du lookup sans colonne ni index** → rejeté : plus simple mais l'invariant ne serait porté **qu'au niveau requête** (pas de défense en profondeur en base ; un futur chemin d'écriture oubliant la normalisation pourrait créer un doublon). La colonne dérivée + index UNIQUE **garantit** l'invariant en base.
- **`uniqueIndex` dans le schéma drizzle (callback d'extras)** → rejeté : casse le gate 100 % fonctions (LEARNINGS #34/#46). D'où la migration à la main.

## Conséquences

- **+** L'invariant d'unicité insensible à la casse **Unicode** est désormais honoré (capitales accentuées incluses) et porté **en base** (index UNIQUE), pas seulement au niveau requête.
- **+** `nameKey` est une fonction **pure** (couvrable 100 %, déterministe), réutilisable par tout futur lookup par prénom.
- **−** `profiles` porte une colonne dérivée `name_key` **NOT NULL** : tout insert de profil doit la fournir (le vrai chemin `createHousehold` le fait ; les seeds de test l'ajoutent explicitement).
- **−** L'index UNIQUE `name_key` vit dans la migration à la main, désynchronisé du snapshot drizzle (contrainte du gate coverage, documentée dans `schema.ts`).
- **Spec** : `AUTH.md` §1 et `PLAN.md` §Modèle de données mis à jour (unicité précisée « insensible à la casse **Unicode** », colonne `name_key` + index UNIQUE).
