# multiplyz — Design tokens (doc)

> Source de vérité = [`tokens.css`](./tokens.css). Ce doc explique la philosophie, les polices, l'a11y, le contrat per-monde et le branchement Tailwind.
> Dérivé de la DA verrouillée dans [ART.md](./ART.md).

## Philosophie

**Kawaii pastel lumineux + accents vifs** (philosophie custom, pas une nommée standard) :
- **Base pastel apaisante** → concentration sur 15–20 min, pas de fatigue visuelle.
- **Accents vifs** réservés aux **récompenses / actions / feedback positif**.
- **Action primaire = violet** `#7A5AF8` : contraste fiable avec texte blanc (le turquoise pur échouait le contraste sur blanc → relégué aux highlights/focus).
- **Erreur = corail doux** `#FF6B6B`, et "pas encore" en **ambre** (jamais de rouge agressif pour un enfant).
- Rayons **généreux**, ombres douces teintées violet, animations avec easing **bounce** pour le « juice ».

## Polices (Google Fonts, gratuites)

- **Baloo 2** → titres + **gros chiffres des calculs** (arrondie, chunky, très lisible).
- **Nunito** → corps de texte (arrondie, ultra-lisible enfant).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
```
> En Next.js, préférer `next/font/google` (Baloo_2, Nunito) → mappées sur `--font-family-display` / `--font-family-body`.

## Accessibilité

- **Texte** : `--color-text-primary` sur `--color-bg-primary` = contraste élevé (light & dark).
- **Daltonisme** : le feedback juste/faux est **toujours doublé d'une icône** (✓ / visuel d'étayage), jamais codé par la seule couleur. Accents répartis sur des teintes distinctes (violet / turquoise / corail / or).
- **Cibles tactiles** : `--tap-target-min: 44px` ; boutons-réponses `--answer-min-size: 72px`.
- **Dark mode** : plum profond chaud (pas de noir pur), texte off-white (pas blanc pur) → moins agressif.
- **Mouvement** : `prefers-reduced-motion` neutralise les durées.

## Thème clair / sombre

- `:root` = light. `[data-theme="dark"]` = override manuel. `@media (prefers-color-scheme: dark)` = suit le système **sauf** si `[data-theme="light"]` explicite.
- Toggle pilotable depuis les **réglages parent**.

## Contrat per-monde (génération dynamique)

Les tokens = **système UI de base**. Chaque monde généré ne surcharge qu'**une seule variable** — `--world-accent` (via `[data-world="…"]` ou style inline) :

```css
[data-world="ocean"]  { --world-accent: #2BB7E6; }
[data-world="forest"] { --world-accent: #5BBF73; }
[data-world="magic"]  { --world-accent: #B57BEF; }
```

- `--world-bg-tint` = `color-mix(--world-accent 10%, surface du thème)` → **theme-safe** : reste lisible en clair ET en sombre (ne plus poser de pastel clair en dur, sinon texte illisible en dark mode). ⚠️ **Piège #184** : ce `color-mix` se résout **au niveau où il est déclaré** (`:root`). Surcharger `--world-accent` en **descendant** (ex. inline sur `<main>`) ne re-dérive **pas** le tint de `:root` — il faut **re-déclarer `--world-bg-tint`** au niveau de la surcharge de `--world-accent` pour un tint réellement per-monde (l'app le fait dans `MapScreen` `worldMainStyle`). « Se dérive automatiquement » ne vaut **que** si les deux sont posés au même niveau.
- `--world-surface` = surface **opaque** du thème → **scrim de contraste** sous le titre quand un fond-image réel du monde est affiché (garantit la lisibilité du titre indépendamment de la photo IA arbitraire, story #189).
- Utiliser `--world-accent` pour les éléments **thématiques** (fond de carte, barre de progression), **pas** pour les actions (qui restent `--color-accent-primary` pour la cohérence cross-monde).

## Branchement Tailwind

**Tailwind v4 (CSS-first, recommandé)** — mapper les tokens dans `@theme` :
```css
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-bg:        var(--color-bg-primary);
  --color-surface:   var(--color-bg-secondary);
  --color-text:      var(--color-text-primary);
  --color-primary:   var(--color-accent-primary);
  --color-accent:    var(--color-accent-secondary);
  --color-gold:      var(--color-reward-gold);
  --radius-card:     var(--border-radius-lg);
  --font-display:    var(--font-family-display);
  --font-body:       var(--font-family-body);
}
```
→ utilisables en `bg-bg`, `text-text`, `bg-primary`, `rounded-card`, `font-display`, etc.

**Tailwind v3 (alternative)** — `tailwind.config.ts` :
```ts
theme: {
  extend: {
    colors: {
      bg:      "var(--color-bg-primary)",
      surface: "var(--color-bg-secondary)",
      text:    "var(--color-text-primary)",
      primary: "var(--color-accent-primary)",
      accent:  "var(--color-accent-secondary)",
      gold:    "var(--color-reward-gold)",
    },
    borderRadius: { card: "var(--border-radius-lg)" },
    fontFamily: {
      display: ["var(--font-family-display)"],
      body:    ["var(--font-family-body)"],
    },
  },
}
```

## Usage

- **Jamais de valeurs en dur** dans les composants → toujours `var(--…)` (ou l'alias Tailwind).
- Calcul affiché → `font-family: var(--font-family-numeric); font-size: var(--font-size-equation);`.
- Bouton-réponse → tokens `--answer-*`. Pavé → `--keypad-*`. Carte → `--card-*`.

## À cadrer plus tard

- Valeurs exactes affinées au **playtest** (tailles de chiffres, contrastes réels mesurés).
- Tokens d'**animation** spécifiques (ouverture d'œuf, étincelles) en phase build avec `frontend-design`.
- Génération auto des blocs `[data-world]` par le pipeline IA (palette → variables).

## Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Philosophie | Kawaii pastel lumineux + accents vifs |
| Action primaire | Violet `#7A5AF8` (contraste fiable) |
| Accents | Turquoise / corail / or (récompenses) |
| Erreur | Corail doux + ambre « pas encore » (jamais rouge dur) |
| Polices | Baloo 2 (titres/chiffres) + Nunito (corps) |
| Thèmes | Light + dark (manuel + système) |
| Format | `tokens.css` (source) + mapping Tailwind v4/v3 |
| Per-monde | Contrat 3 variables (`--world-accent/bg-tint/surface`) |
