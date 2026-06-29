# multiplyz — Économie : concepts & schéma data

> Complément de [PLAN.md](./PLAN.md) (modèle de données) et [PRODUCT.md](./PRODUCT.md) (récompenses).
> Extension des tables `characters`/`collection` de PLAN + nouvelles tables d'économie.

---

## 1. Garde-fous (verrouillés)

- **Monnaie unique** : les **pièces** (gagnées en jouant). **Zéro argent réel**, zéro monnaie premium.
- **L'économie ne bloque JAMAIS l'apprentissage** : la progression = étoiles/maîtrise, jamais les pièces.
- **Aucun timer FOMO**, aucune pression à dépenser.
- **Collection toujours complétable** : doublon → éclats ; boutique éclats en filet de sécurité ; pitié sur les œufs.
- **Cosmétiques = pur déco**, aucun avantage de jeu.

---

## 2. Concepts (recap)

| Élément | Rôle |
|---|---|
| **Pièces** 🪙 | Monnaie gagnée en jouant → achète œufs & cosmétiques |
| **Œufs** 🥚 | Boîte surprise (achetée en pièces) → ouvre une créature aléatoire |
| **Créatures** 🐾 | À collectionner (commune / rare / légendaire) |
| **Éclats** ✨ | Issus des doublons → font évoluer + achètent une créature précise (boutique) |
| **Évolution** 🌱 | Dépenser des éclats : bébé → ado → adulte |
| **Cosmétiques** 👒 | Habillage avatar/Teddy (pièces, déco pure) |
| **Poisson au miel** 🐟🍯 | Snack de Teddy : thème du coffre quotidien + booster doux optionnel |

Obtention validée = **hybride** : œufs surprise **+** boutique éclats. Légendaires **garanties au boss** (hors œufs).

---

## 3. Schéma data (SQLite local — types indicatifs)

### 3.1 Portefeuille — `wallet` (1 ligne / profil)
| Champ | Type | Notes |
|---|---|---|
| profile_id | text (FK, PK) | → `profiles.id` |
| coins | integer | pièces, ≥ 0 |
| shards | integer | éclats, ≥ 0 |
| updated_at | integer (ts) | |

### 3.2 Catalogue créatures — `characters` (extension de PLAN)
| Champ | Type | Notes |
|---|---|---|
| id | text (PK) | |
| world_id | text (FK) | → `worlds.id` |
| species_key | text | clé stable |
| name_default | text | nom mignon par défaut |
| rarity | text | `common` \| `rare` \| `legendary` |
| max_stage | integer | 1–3 (stades d'évolution) |
| in_egg_pool | boolean | légendaires = `false` (boss only) |
| art_ref | text | url asset (stade de base) |
| art_ref_stages | text (json) | urls par stade (ado/adulte) |
| story | text | ligne d'histoire |

### 3.3 Possession — `collection` (extension de PLAN)
| Champ | Type | Notes |
|---|---|---|
| profile_id | text (FK) | |
| character_id | text (FK) | |
| count | integer | nb d'exemplaires obtenus (doublons inclus) |
| stage | integer | stade d'évolution actuel (≤ `max_stage`) |
| nickname | text \| null | renommée par l'enfant |
| unlocked_at | integer (ts) | |
|  | | PK = (profile_id, character_id) |

### 3.4 Cosmétiques — `cosmetics` (catalogue) + `cosmetics_owned`
`cosmetics` : id, kind (`avatar` \| `teddy`), name, art_ref, price_coins
`cosmetics_owned` : profile_id, cosmetic_id, acquired_at, equipped (boolean) — PK (profile_id, cosmetic_id)

### 3.5 Inventaire consommables — `inventory_items`
| Champ | Type | Notes |
|---|---|---|
| profile_id | text (FK) | |
| item_key | text | ex. `honey_fish` (poisson au miel) |
| qty | integer | ≥ 0 |
|  | | PK = (profile_id, item_key) |

### 3.6 Récompense quotidienne — `daily`
| Champ | Type | Notes |
|---|---|---|
| profile_id | text (FK, PK) | |
| streak_count | integer | jours consécutifs |
| last_claim_date | text | `YYYY-MM-DD` (timezone locale) |

### 3.7 Journal — `ledger` (traçabilité + transparence parent + anti-triche)
| Champ | Type | Notes |
|---|---|---|
| id | integer (PK auto) | |
| profile_id | text (FK) | |
| direction | text | `earn` \| `spend` |
| currency | text | `coins` \| `shards` \| `item` |
| amount | integer | |
| reason | text | `level`, `star_bonus`, `boss`, `daily_chest`, `treasure`, `egg`, `shop`, `evolution`, `cosmetic`, `booster` |
| ref_id | text \| null | id de l'objet lié |
| created_at | integer (ts) | |

> **Config économique** (taux, prix, odds) = **fichier de config versionné** (pas en DB), pour calibrer facilement.

---

## 4. Règles économiques

### 4.1 Gains de pièces (earn)
- Fin de niveau : **base** + **bonus par étoile**.
- Boss de monde : **gros bonus** + **créature légendaire garantie**.
- Nœud trésor : bonus court.
- Coffre quotidien : pièces + parfois **poisson au miel** 🐟🍯.

### 4.2 Œufs (surprise)
- Achetés en **pièces**. Ouverts **immédiatement** (gratification instantanée ; inventaire d'œufs = option plus tard).
- Pool = créatures `in_egg_pool = true` du/des mondes débloqués (communes + rares). **Légendaires exclues** (boss only).
- **Doublon** (créature déjà possédée) → converti en **éclats** (montant selon rareté). Jamais "rien".
- **Pitié anti-malchance** : après **N doublons d'affilée**, le prochain tirage est **garanti nouveau** (si une nouveauté existe).

### 4.3 Boutique (éclats)
- Filet de sécurité : **acheter une créature précise** manquante contre des **éclats** (prix selon rareté).
- Garantit la **complétude** sans dépendre de la chance.

### 4.4 Évolution (éclats)
- Faire évoluer une créature au **stade suivant** (bébé→ado→adulte) contre des **éclats** (coût croissant par stade, selon rareté).
- Cosmétique/affectif : ne donne **aucun avantage de jeu**.

### 4.5 Cosmétiques (pièces)
- Tenues/accessoires d'avatar & de Teddy. Achat en pièces. Déco pure.

### 4.6 Poisson au miel 🐟🍯 (booster doux, optionnel)
- Source : coffre quotidien (et éventuellement achat).
- Effet **doux** au choix (à calibrer) : ex. **+X % de pièces** sur le prochain niveau, ou **éclosion accélérée** d'un œuf.
- **Jamais pay-to-win** (pas de gain d'apprentissage, pas d'argent réel).

---

## 5. Valeurs indicatives (à calibrer au playtest)

| Paramètre | Valeur de départ |
|---|---|
| Pièces fin de niveau (base) | 10 |
| Bonus par étoile | +5 / étoile |
| Bonus boss | +50 |
| Coffre quotidien | 20 + 1 poisson au miel |
| Prix d'un œuf | 50 pièces |
| Doublon → éclats | commune 10 / rare 25 |
| Pitié œuf (garantie) | après 5 doublons d'affilée |
| Boutique : créature | commune 60 / rare 150 éclats |
| Évolution (par stade) | stade 2 : 40 ✨ / stade 3 : 100 ✨ |
| Cosmétique | 30–120 pièces |
| Booster poisson au miel | +25 % pièces sur 1 niveau |

> Répartition créatures par monde (indicatif) : ~6–8 = plusieurs communes + 1–2 rares (œufs) + **1 légendaire** (boss).

---

## 6. Flux clés

- **Gagner & ouvrir** : niveau → +pièces (ledger `earn/coins/level`) → 50 pièces → achat œuf (`spend/coins/egg`) → tirage → nouvelle créature (collection +1) **ou** doublon → +éclats (`earn/shards/egg`).
- **Cibler** : il manque "Bulle" → boutique → dépense éclats (`spend/shards/shop`) → Bulle ajoutée.
- **Évoluer** : assez d'éclats → évolution (`spend/shards/evolution`) → `collection.stage++`.
- **Boss** : victoire → légendaire garantie ajoutée directement à la collection + gros bonus pièces.
- **Quotidien** : 1er lancement du jour → coffre (`earn/coins/daily_chest` + item poisson au miel), `daily.streak_count++`.

---

## 7. Anti-frustration & garde-fous

- Doublon **toujours utile** (éclats).
- **Pitié** sur les œufs + **boutique** = jamais bloquée par la malchance.
- Légendaires **déterministes** (boss), pas de RNG cruel.
- Pas de timer, pas de "vies", pas d'argent réel, pas de pub.
- **Transparence parent** : le `ledger` permet d'expliquer gains/dépenses si besoin.
- Économie **jamais** sur le chemin de l'apprentissage.

---

## 8. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Monnaie | **Pièces** uniquement (jouer pour gagner, zéro argent réel) |
| Obtention créatures | **Hybride** : œufs surprise + boutique éclats ; légendaires au boss |
| Doublons | → **éclats** (jamais "rien") |
| Évolution | **Oui**, 2–3 stades via éclats |
| Poisson au miel | Saveur (coffre quotidien) + **booster doux optionnel** |
| Cosmétiques | Pièces, **déco pure** |
| Garde-fous | Pitié + boutique + complétude garantie + no-FOMO + n'entrave jamais l'apprentissage |
