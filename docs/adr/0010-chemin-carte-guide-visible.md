# 0010. Le trait du chemin de la carte devient un guide visible (≥3:1)

- **Statut** : accepted
- **Type** : product
- **Portée** : majeure (sign-off proprio obtenu en playtest — renverse une décision de design documentée)
- **Liens** : playtest proprio (2026-07-07) · PR #169 · specs impactées : `WIREFRAMES.md` §2 (Carte du monde), `MAP.md` §3 (géométrie déterministe) · tokens `--map-node-path-*` (`tokens.css`)

## Contexte
En playtest local (`/carte`), le proprio a perçu les ronds de niveau comme **désalignés / bug d'affichage** : chaque nœud est décalé horizontalement (jitter serpentin seedé, métaphore « chemin » MAP §1 / WIREFRAMES §2) **mais** le trait qui les relie était rendu à contraste **volontairement quasi-invisible** (~1.2–1.5:1, `--map-node-path-color: var(--color-border-primary)`), documenté comme « décoratif pur, aucune info portée » (ADR implicite dans le commentaire tokens, PR #137).

Résultat : sans trait visible **et** avec un décalage léger (`JITTER_X = 0.35`), l'œil lit des ronds flottants mal alignés au lieu d'un chemin voulu. La métaphore « chemin Candy Crush » (WIREFRAMES §2) ne passait pas.

Le trait EXISTAIT déjà dans le DOM (`NodeConnector`, consomme `--map-node-path-*`) — ce n'était donc **pas** une récidive du piège « token déclaré ≠ rendu » (#125, réglé en #137) : c'était un **choix de contraste** qui rendait l'intention illisible.

## Décision
Promouvoir le trait de « décoratif quasi-invisible » à **guide de repérage (wayfinding) visible** :

1. **`--map-node-path-color`** : `var(--color-border-primary)` → **`var(--color-text-secondary)`** → ≥3:1 sur `--color-bg-primary` les 2 thèmes (≈5:1 light / ≈8:1 dark), conforme **WCAG 1.4.11** (élément non-texte). Choix **neutre délibéré** (pas un token de statut) pour ne pas concurrencer les couleurs d'état de nœud (vert complété / violet courant / neutre verrouillé).
2. **`--map-node-path-width`** : `2px` → **`4px`** (présence du tracé).
3. **`JITTER_X`** : `0.35` → **`0.5`** (`src/lib/game/map.ts`) — serpentin plus marqué (`x` couvre ~tout `[0,1]`, translateX ≈ ±50% de la pastille) sans épingler durablement les nœuds aux bords. Reste **déterministe par `world_index`** et **invariant à l'état runtime** (rétro #123) : `JITTER_X` demeure un ⚙️ **visuel local** codé en const (pas un réglage pédagogique, hors `MapConfig` — la structure/les types n'en dépendent pas).

**A11y** : le trait reste `aria-hidden` / jamais navigable — l'**ordre** du chemin est déjà porté par l'ordre DOM des nœuds + leurs noms accessibles, le trait n'ajoute aucune info nouvelle pour un lecteur d'écran. Mais comme il porte désormais une **intention visuelle revendiquée**, une **garde de contraste résolue ≥3:1 (2 thèmes)** est ajoutée (`MapScreen.test.tsx`), mutation-prouvée (l'ancien token la fait rougir) — cf. règle tell commentaire↔code (CLAUDE.md).

## Alternatives
- **Laisser tel quel** : rejeté — le proprio (juge du playtest) le lit comme un bug.
- **Trait en couleur d'accent (violet)** : rejeté — `--color-accent-primary` est déjà le fond du nœud « courant » ; un trait violet échoifierait/brouillerait les états. Neutre = plus lisible.
- **Exagérer le décalage sans rendre le trait visible** : rejeté — sans trait, plus de décalage = plus de désordre perçu, pas moins.
- **Promouvoir `JITTER_X` en `MapConfig`** : écarté pour cette PR — c'est un ⚙️ visuel, pas pédagogique ; le promouvoir déclencherait la règle « déclaré ≠ consommé » (test qui exerce le param). Reste une const, exercée par les tests de déterminisme/bornes de `map.test.ts`.

## Conséquences
- (+) La carte se lit comme un **chemin voulu**, plus comme des ronds désalignés. Métaphore WIREFRAMES §2 honorée visuellement.
- (+) Le contraste du trait est désormais **testé** (garde résolue ≥3:1, 2 thèmes) — plus de dérive silencieuse possible.
- (−) Renverse la décision « trait décoratif invisible » (commentaire tokens #137) : le commentaire `tokens.css` et le JSDoc `NodeConnector` sont **mis à jour** en conséquence (tell↔code).
- **Specs mises à jour** : note dans `WIREFRAMES.md` §2 (le trait est un guide visible ≥3:1) et `MAP.md` §3 (amplitude `JITTER_X` = ⚙️ visuel, tracé lisible). Contrat data inchangé (géométrie toujours déterministe/invariante).
- **Suite** : calibrer l'amplitude au playtest enfant si besoin (le ⚙️ reste ajustable).
