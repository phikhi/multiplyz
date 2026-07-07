# multiplyz — Carte & niveaux (structure data)

> Complète [PRODUCT.md](./PRODUCT.md) (mécanique), [ENGINE.md](./ENGINE.md) (contenu d'un niveau), [WIREFRAMES.md](./WIREFRAMES.md) (écran carte).

---

## 1. Décisions (verrouillées)

- **Monde = chemin de ~10 niveaux + 1 boss** (~11 nœuds).
- **Déblocage linéaire** : finir le **boss** d'un monde → monde suivant débloqué. **Les étoiles = récompense/collection, PAS une barrière.**
- **Carte sans fin** : on enchaîne les mondes (générés, cf. [WORLDGEN.md](./WORLDGEN.md)).

## 2. Types de nœuds

| Nœud | Rôle |
|---|---|
| **Normal** | ~10 questions (mix moteur, cf. ENGINE §4) |
| **Révision** | 100 % calculs faibles/dus — **inséré dynamiquement** quand la dette de révision est haute |
| **Trésor / bonus** | mini-défi court → pièces bonus |
| **Boss** (fin de monde) | défi un peu plus long → **créature légendaire garantie** + gros lot de pièces |

## 3. Représentation (procédurale, peu de stockage)

- La **géométrie de la carte** (positions des nœuds) est **générée de façon déterministe** depuis `world_index` (seed) → **rien à stocker** par nœud. Le tracé serpente en `x` (amplitude `JITTER_X` = ⚙️ **visuel** local, cf. ADR 0010) et les nœuds sont **reliés par un trait de repérage visible** (guide wayfinding ≥3:1 WCAG 1.4.11, neutre, `aria-hidden` — l'ordre reste porté par le DOM des nœuds).
- **Type de nœud par position** : normaux par défaut ; **trésor** ~tous les 4 nœuds ⚙️ ; **boss** en dernier ; **révision** injecté dynamiquement selon la dette (cf. §5).
- Un **niveau** = `(world_index, level_index)` → son contenu est **composé à la volée** par le moteur (ENGINE). Pas de table de questions.

## 4. Données par profil

- `progress` : `profile_id, world_index (∞), level_index, stars` (étoiles par niveau).
- **Total d'étoiles** = somme → sert à l'**affichage/collection**, **pas** au déblocage.
- Progression **monotone** (jamais de régression, cf. SYNC).

## 5. Insertion dynamique du nœud Révision

```text
si dette_revision(profil) > SEUIL_REVISION:   # ⚙️ ex. > 12 facts en retard
   prochain nœud = "révision" (100% dus/faibles)
sinon:
   suivre le motif normal/trésor/boss
```
→ garde la mémorisation à jour sans casser le fil de l'aventure.

> **Précision (cohérence §3/§4)** : « **prochain nœud = révision** » signifie que le **nœud courant** (prochain à jouer — le 1ᵉʳ non terminé, jamais le boss) est **typé** révision — un **overlay de type**, pas un nœud ajouté. La **géométrie du monde reste inchangée** (nombre de nœuds et positions constants), donc `level_index` **stable** (§4, progression monotone) et remédiation **immédiate** (la révision est là où l'enfant joue, pas reportée en fin de monde). Si le seul nœud restant est le **boss** (tous les niveaux faits) ou si le monde est 100 % terminé, **pas d'overlay** (priorité boss, §6). L'overlay écrase le type de base même si c'était un **trésor** (la remédiation prime le bonus pour ce créneau). Borne **stricte** (`>`, pas `≥`).

## 6. Boss

- Débloqué quand les niveaux du monde sont faits.
- Un peu plus long (~12-15 questions ⚙️), mix des compétences du moment.
- Récompense : **légendaire du monde** (déterministe, hors œufs) + gros bonus pièces.
- Réussite → **monde suivant débloqué**.

## 7. Cadence (indicatif)

- ~10 niveaux × ~3-4 min + boss ≈ **30-45 min / monde** → un déblocage de monde ~tous les 2-3 jours de jeu (sessions 15-20 min). ⚙️

## 8. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Taille monde | **~10 niveaux + 1 boss** |
| Déblocage | **Linéaire** (boss → monde suivant) ; étoiles = récompense |
| Nœuds | normal · révision (dynamique) · trésor · boss |
| Carte | **procédurale** depuis `world_index` (rien à stocker) |
| Niveau | `(world_index, level_index)`, composé par le moteur |
| Boss | légendaire garantie + gros lot, ouvre le monde suivant |
