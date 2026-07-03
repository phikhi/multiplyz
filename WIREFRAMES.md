# multiplyz — Wireframes (basse fidélité)

> Complément de [PRODUCT.md](./PRODUCT.md) (flows), [ART.md](./ART.md) (style), [ECONOMY.md](./ECONOMY.md).
> **Lo-fi volontaire** : structure & hiérarchie, pas le visuel final (qui viendra avec les design tokens + le build).
> **Cible** : desktop d'abord, **responsive** tablette/tél. **Navigation : carte = hub.** **Teddy présent discret en jeu.**
> Gros boutons, gros chiffres, zones tactiles larges, peu de texte.

---

## 1. Sélection de profil + PIN

**1a. Choix du profil**
```
┌──────────────────────────────────┐
│            multiplyz 🧸           │
│      Qui joue aujourd'hui ?       │
│                                   │
│   ┌────┐   ┌────┐   ┌────┐        │
│   │ 👧 │   │ 👦 │   │ ➕ │        │
│   │ Léa│   │ Tom│   │ajout.│      │
│   └────┘   └────┘   └────┘        │
│                                   │
│                       🔒 Parent   │
└──────────────────────────────────┘
```
**1b. Pavé PIN enfant**
```
┌──────────────────────────────────┐
│  ← Salut Léa ! Ton code 🔑        │
│              ● ● ○ ○              │
│           [1] [2] [3]             │
│           [4] [5] [6]             │
│           [7] [8] [9]             │
│           [ ] [0] [⌫]             │
└──────────────────────────────────┘
```
- Le bouton **🔒 Parent** mène au même pavé mais avec le **PIN parent** → Espace parent (écran 7).
- États : PIN faux → secouage doux + « Oups, on réessaie ? » (no-shame).

---

## 2. Carte du monde (HUB)

```
┌──────────────────────────────────┐
│ 🪙120   ✨40            ⚙️   👤   │
│                                   │
│   ~~~  Monde 3 · La Forêt  ~~~    │
│        🔒                         │
│         \                         │
│   ◉ ── ● ── ● ── ⭐BOSS            │
│   │                               │
│   ● ── ● ── ●          🧸 Teddy   │
│  départ                           │
│                                   │
│  [ 🐾 Collection ]  [ 🥚 Boutique ]│
└──────────────────────────────────┘
```
- **Nœuds** : `◉` prochain/à jouer · `●` fait (montre les ⭐ gagnées) · `🔒` verrouillé · `⭐BOSS` = boss du monde.
- **Top bar** : pièces 🪙, éclats ✨, ⚙️ réglages, 👤 profil. **Icônes flottantes** bas : Collection, Boutique (= hub).
- Tap nœud → **carte d'intro** (Teddy lance la quête, beat court zappable) → écran 3.
- Fin du monde → transition vers **monde suivant** (généré). Scroll infini.

---

## 3. Niveau (une partie)

**3a. Question — QCM** (calcul nouveau/faible)
```
┌──────────────────────────────────┐
│ ✕    ▣▣▣▣□□□□□□    4/10           │
│                                   │
│             6 × 8 = ?             │
│                                   │
│   ┌────┐  ┌────┐  ┌────┐  ┌────┐  │
│   │ 42 │  │ 48 │  │ 54 │  │ 36 │  │
│   └────┘  └────┘  └────┘  └────┘  │
│ 🧸                         ❓ aide │
└──────────────────────────────────┘
```
**3b. Question — Pavé** (calcul connu)
```
┌──────────────────────────────────┐
│ ✕    ▣▣▣▣▣▣□□□□    6/10           │
│             7 + 5 = ?             │
│               [ 12 ]             │
│           [7] [8] [9]             │
│           [4] [5] [6]             │
│           [1] [2] [3]             │
│           [⌫] [0] [✓]             │
│ 🧸                         ❓ aide │
└──────────────────────────────────┘
```
**3c. Feedback — bonne réponse**
```
│           6 × 8 = 48  ✅          │
│      🧸 « Dans le mille ! » ✨     │
```
**3d. Feedback — erreur → étayage visuel** (no-fail, on refait)
```
│           6 × 8 = ?               │
│   🧸 « Presque ! Regarde : »      │
│   ┌── matrice 6×8 ───────────┐    │
│   │ ▪▪▪▪▪▪▪▪                  │    │
│   │ ▪▪▪▪▪▪▪▪   6 paquets de 8 │    │
│   │ … (6 lignes)             │    │
│   └──────────────────────────┘    │
│    🧸 « Et voilà, ça fait 48 ! »  │
│          [ Je réessaie ]          │
```
- **Ordre d'affichage (issue #100, ADR 0007)** : l'**étayage visuel d'abord** (outil de découverte : l'enfant « voit » le calcul par la représentation), **puis la révélation numérique en synthèse APRÈS** (« et voilà, ça fait {n} », conclusion — jamais le chiffre jeté en tête). No-fail intact : la bonne réponse est **toujours** montrée, seulement déplacée sous l'étayage.
- `✕` = quitter (reprise garantie plus tard). Barre `▣▣□` = progression 10 questions.
- **Étayage par compétence** : dix-cases (compléments), droite numérique (add/sous), matrice (multi).
- `❓ aide` = « Je ne sais pas » → montre l'étayage, sans pénalité.
- **Pas de chrono visible** (temps mesuré en silence).

---

## 4. Résultats de niveau

```
┌──────────────────────────────────┐
│          Niveau réussi ! 🎉       │
│             ⭐   ⭐   ⭐          │
│                                   │
│    🧸 « On l'a fait, équipe ! »    │
│                                   │
│    🪙 +20 pièces                  │
│    🥚 Tu as gagné un œuf !        │
│                                   │
│  [ Ouvrir l'œuf ]   [ Continuer →]│
└──────────────────────────────────┘
```
- Étoiles selon **justesse** (pas la vitesse). Même 1 ⭐ avance.
- « Ouvrir l'œuf » → écran 6b. « Continuer » → nœud suivant (ou nudge fin de session après 15–20 min).

---

## 5. Collection

**5a. Grille (« Pokédex »)**
```
┌──────────────────────────────────┐
│ ←  Ma Collection 🐾      12 / 30  │
│                                   │
│  🦊  🐰  🐢  ❓  🐥  🦉           │
│  🐸  ❓  ❓  🐲  ❓  ❓           │
│  🌟  ❓  ❓  ❓  ❓  ❓           │
│                                   │
│  Filtres : Tous · Forêt · Océan…  │
└──────────────────────────────────┘
```
**5b. Fiche créature (détail + évolution)**
```
┌──────────────────────────────────┐
│ ←   Goupil          renommer ✏️   │
│            ┌────────┐             │
│            │   🦊   │             │
│            └────────┘             │
│   Rareté : ★★ rare                │
│   Stade : bébé ▸ [ado] ▸ adulte   │
│   « Un petit renard curieux. »    │
│                                   │
│   Évoluer : ✨40   [ Faire évoluer ]│
└──────────────────────────────────┘
```
- `❓` = silhouette non obtenue. `🌟` = légendaire (gagnée au boss).
- Évolution dépense des **éclats** (cf. ECONOMY). Renommage libre.

---

## 6. Boutique & Œufs

**6a. Boutique (hub économie)**
```
┌──────────────────────────────────┐
│ ←  Boutique        🪙120   ✨40   │
│  ── Œufs 🥚 ──                     │
│   ┌────────┐   ┌────────┐         │
│   │  🥚    │   │  🥚✨  │         │
│   │ Commun │   │  Rare  │         │
│   │  🪙50  │   │ 🪙120  │         │
│   └────────┘   └────────┘         │
│  ── Cibler une créature ✨ ──      │
│   [ 🐢 Bulle  ✨150 ]  [ 🦉 …✨ ] │
│  ── Cosmétiques 👒 ──              │
│   [ Chapeau 🪙30 ] [ Cape Teddy 🪙80 ]│
└──────────────────────────────────┘
```
**6b. Ouverture d'œuf (moment fun)**
```
┌──────────────────────────────────┐
│          L'œuf s'ouvre… 🥚        │
│              ✨ ✨ ✨             │
│            ┌────────┐             │
│            │  🐸 !  │             │
│            └────────┘             │
│   🧸 « Oooh, un nouvel ami ! »     │
│   (si doublon → « +25 ✨ éclats ») │
│            [ Génial ! ]           │
└──────────────────────────────────┘
```
- Boutique éclats = filet anti-malchance (cibler une créature précise).
- Doublon résolu avec joie (éclats), jamais « rien ».

---

## 7. Espace parent (PIN parent)

```
┌──────────────────────────────────┐
│  Espace parent · Léa          ✕   │
│  Aujourd'hui : 18 min · 3 niveaux │
│  Série : 🔥 5 jours               │
│                                   │
│  Justesse (semaine)    82%  ▲ +5% │
│   ┌────────────────────┐          │
│   │      ▁ ▃ ▅ ▆ ▇     │          │
│   └────────────────────┘          │
│                                   │
│  Par compétence :                 │
│   Compléments   ███████░  88%     │
│   Addition      ██████░░  79%     │
│   Soustraction  █████░░░  64%     │
│   Multiplication████░░░░  52%     │
│                                   │
│  Rapidité moyenne : 3,2 s ▼ (mieux)│
│  À revoir : 6×7 · 8×4 · 7+8 · 13−6 │
│                                   │
│  [ Réglages ]   [ Recalibrer ]    │
└──────────────────────────────────┘
```
- Registre **neutre/factuel** (pas Teddy). Données issues de `attempts`/`mastery`.
- **Réglages** : son/musique, plafond de temps quotidien (optionnel), gérer profils.
- **Recalibrer** : relancer un mini-diagnostic.

---

## 8. Responsive (notes)

- **Desktop/tablette** : contenu centré (largeur max ~ tablette portrait), grandes marges, mêmes dispositions.
- **Téléphone** :
  - Réponses QCM en **2×2**, pavé num. pleine largeur.
  - Carte : **scroll vertical** du chemin.
  - Collection : grille **3 colonnes**.
  - Boutique : cartes empilées.
- Boutons d'action **en bas** (pouce), zones tactiles ≥ 44 px, jamais de texte minuscule.

---

## 9. À cadrer plus tard

- Visuel haute-fidélité (avec **design tokens** + skill `frontend-design`).
- Animations/transitions (« juice » : rebonds, étincelles, ouverture d'œuf).
- Carte d'intro de monde (mise en page du beat narratif zappable).
- États vides/erreurs détaillés (hors-ligne, monde en génération).

---

## 10. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Navigation | **Carte = hub**, Collection/Boutique en icônes flottantes |
| Teddy en jeu | **Présent mais discret**, réagit au feedback |
| Saisie | QCM (calcul neuf) / pavé (calcul connu), gros boutons |
| Écrans | 6 de base + **Ouverture d'œuf**, **Boutique**, **Fiche créature** |
| Responsive | Desktop d'abord, reflow tablette/tél |
