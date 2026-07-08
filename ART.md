# multiplyz — Direction artistique & charte de style

> Complément de [PLAN.md](./PLAN.md) (pipeline IA) et [PRODUCT.md](./PRODUCT.md) (mécanique).
> **But de ce doc** : verrouiller un style **reproductible** pour que la génération IA *continue* de mondes/créatures reste cohérente. Le **prompt de base** ci-dessous est réinjecté **mot pour mot** à chaque génération ; seules quelques variables changent.

---

## 1. ADN visuel (verrouillé)

- **Style** : illustration **kawaii douce** (2D, **flat kawaii vector conservé**) **enrichie** de **cel-shading léger** + **poils tuftés légers** sur le contour (aspect peluche) — _enrichi une fois par [ADR 0009](docs/adr/0009-style-fluffy-kawaii-unifie.md) (direction owner, #160, fidèle au master validé #158)_.
- **Couleurs** : **pastel lumineux** en base (calme, bon pour la concentration sur 15–20 min) + **accents vifs** réservés aux récompenses/boutons/feedback positif.
- **Mascotte signature** : **Teddy**, fil rouge présent dans tous les mondes (identité du jeu + lien affectif fort — c'est SON doudou).
- **Créatures** : un **ADN commun** garantit la cohérence malgré la génération infinie — rondes, grands yeux brillants, formes simples, **1–2 traits distinctifs** chacune.
- **Rendu** : **cel-shading doux**, **poils tuftés légers** sur la silhouette (aspect peluche, propre — pas de taches ni de bruit), contour fin/arrondi, proportions **chibi** (~2 têtes de haut), expressions amicales. **Jamais** : réalisme dur, effrayant, texte dans l'image, détails fouillis, poils sales/tachetés.

---

## 2. Teddy (mascotte fil rouge)

- **Concept** : version **stylisée kawaii** de **Teddy**, l'ours en peluche réel de sa fille — un **Steiff de collection des années 80**.
- **Ancrages de ressemblance** (depuis les **photos réelles fournies par le parent**) : fourrure mohair (teinte réelle à confirmer sur photos, typiquement caramel/doré/beige), **museau brodé**, yeux ronds sombres, oreilles arrondies, bras/jambes **articulés**, **dos légèrement bombé** (classique teddy vintage), **bouton Steiff + étiquette jaune à l'oreille** (marque d'authenticité).
- **Stylisation** : appliquer l'ADN du jeu (formes arrondies, **grands yeux brillants**, proportions chibi, pastel, **cel-shading léger**, **poils tuftés légers**) **tout en gardant la ressemblance** avec le vrai Teddy.
- **Cohérence inter-mondes** : Teddy reste **identique**, seuls ses **accessoires** changent selon le monde (masque de plongée → océan, casque spatial → galaxie, petite cape → monde magique, écharpe → forêt). → un seul personnage, décliné à l'infini sans perdre son identité.
- **Génération en 2 stages** (model sheet, cf. WORLDGEN §8) : **Stage A** (1×) photos réelles → **master Teddy kawaii** + expressions (neutre/content/oups/acclame/intrépide), **validé** ; **Stage B** (par monde) → ancrer sur le **master**, **jamais les photos**. Master = aussi les **sprites de réaction** en jeu. Modèle : **Nano Banana** (consistance + img2img).
- **Rôles** : guide l'enfant, réagit aux bonnes/mauvaises réponses, célèbre les déblocages.
- 📷 **À fournir** : photos de Teddy (plusieurs angles, bonne lumière) → stockées comme **assets de référence** (`/assets/reference/teddy/`).

---

## 3. Système de couleurs

- **Base UI globale** (indicatif ; les **design tokens** précis viendront avec la phase tokens) : fonds crème/lavande très clairs, surfaces blanc cassé, texte ardoise doux.
- **Accents vifs** (récompenses, étoiles, boutons d'action) : jaune doré, corail, turquoise.
- **Palette PAR MONDE** : chaque monde généré reçoit **sa** palette pastel dérivée de son thème (océan = bleus/turquoise ; forêt = verts/pêche ; magie = lavande/rose ; galaxie = indigo/violet + accents lumineux). Le **style reste verrouillé**, seule la palette varie.
- **Contraintes** : contraste suffisant pour la lisibilité enfant ; accents **distinguables en cas de daltonisme** (ne jamais coder une info par la seule couleur).

---

## 4. Spécifications d'assets

| Asset | Format / ratio | Notes |
|---|---|---|
| Teddy / créature | **1:1** (1024², export WebP), **fond transparent** | Centré, cadrage entier ou poitrine, marge de sécurité autour |
| Fond de monde | **16:9** (1920×1080) | **Peu chargé**, zones calmes là où l'UI se pose (carte/nœuds), recadrage CSS pour mobile |
| Tuiles / nœuds de carte | 1:1, petits éléments | Cohérents avec le fond du monde |
| Icônes UI | 1:1, simples, lisibles petits | Même langage : arrondi, plat, mignon |

- **Stockage** : assets en blob/CDN (ou `/public`) ; **métadonnées** (id → url, monde, palette, nom, histoire) en DB (cf. PLAN §worlds/characters).

---

## 5. Prompts de génération (réutilisables)

> En **anglais** (meilleur ancrage des modèles d'image). `{…}` = variables injectées par le générateur de monde.

**STYLE DE BASE (verrouillé — enrichi une fois par [ADR 0009](docs/adr/0009-style-fluffy-kawaii-unifie.md), #160) :**
Générique et **partagé** par Teddy/créatures/fonds via `{base_style}`. = **tokens verbatim du master validé #158**, MOINS le **torse crème** (**spécifique Teddy** → dans le gabarit Teddy) et le fond blanc (`isolated on white background` = détail d'exécution Stage A / cutout, pas du style).
```
flat 2D kawaii vector illustration, soft rounded shapes, cute chibi proportions,
big shiny friendly eyes, gentle minimal cel shading, lightly fluffy fur with a few
soft clean fur tufts along the silhouette edge, tidy smooth even fur, not blotchy,
no random dark spots or dirty marks, soft pastel palette with bright accent highlights,
clean simple background, children's app art, high quality, consistent art style
```

**NEGATIVE (constant) :**
```
photorealistic, 3d render, realistic, scary, creepy, dark, gore, text, letters,
watermark, signature, extra limbs, deformed, busy cluttered details, harsh shadows,
gradient noise, low quality
```

**Mascotte Teddy (par monde) — avec photo de référence :**
```
{base_style}, "Teddy" a cute vintage 1980s Steiff teddy bear, golden mohair fur,
soft lighter cream-colored fluffy chest and belly patch, stitched snout, round dark
eyes, rounded ears, classic jointed teddy with a slightly humped back, small yellow
blank ear tag with no text, wearing {world_accessory},
faithful to the reference photos, centered, transparent background --ar 1:1
```
→ **Stage A** : passer les **photos réelles** pour créer le master. **Stage B** : passer le **master** (pas les photos) + l'accessoire du monde.

**Créature :**
```
{base_style}, a cute round collectible creature: {creature_concept},
1-2 distinctive features: {features}, color palette: {world_palette},
centered, full body, transparent background --ar 1:1
```

**Fond de monde :**
```
{base_style}, a {world_theme} world background landscape, palette: {world_palette},
calm uncluttered composition with open space in the lower-center for UI,
no characters, no text --ar 16:9
```

---

## 6. Stratégie de cohérence (le plus important)

1. **Prompt de base verrouillé** réinjecté tel quel à chaque génération.
2. **Teddy en 2 stages** : (A) photos → **master** validé à la main ; (B) déclinaisons par monde **ancrées sur le master** (jamais les photos). → consistance maximale, une seule transformation par génération.
3. **Style bible d'ancrage** : générer aussi ~3 créatures + 1 fond de référence validés → images de référence pour les générations suivantes.
4. **Seed / modèle figés** par batch quand le modèle le permet → moins de dérive.
5. **Seules les variables changent** : `{world_theme}`, `{world_palette}`, `{creature_concept}`, `{features}`, `{world_accessory}`. Le reste est constant.
6. **QA + modération kid-safe** avant qu'un monde ne devienne **jouable** : rejeter (et régénérer) tout asset effrayant/incohérent/avec texte.
   - **Ordre réel = write-then-gate** (impl épic #6, réconcilié #176) : les octets rendus sont d'abord **persistés** (fichiers servables + ligne `worlds` posée en `buffered` par le générateur), **puis** la QA s'exécute sur le **pixel rendu** (indispensable pour l'inspecter), **puis** la **visibilité** est gardée par le statut — un monde n'atteint `active` (jouable) **qu'après** QA réussie (+ approbation parent si le toggle ⚙️ est activé). Un rejet définitif laisse le monde **jamais `active`** (job `failed`, monde sur le **fallback** §6.7). Rien n'est exposé à l'enfant tant que la carte ne sert que les mondes `active`.
   - **Purge des rejets** : une purge idempotente (`purgeFailedWorldAssets`, #176) cible les assets servables d'un monde **définitivement rejeté** (job `failed`, aucun retry ni succès), en laissant **intacts** les mondes `buffered` (QA passée, en attente d'approbation) et `active`. Statut honnête (discipline #165) : purge **implémentée + mutation-prouvée + injectable**, mais **invocation périodique non encore câblée** (`runWorkerTick` ne l'appelle pas ; il manque le call-site + le remover réel injecté à l'exécution owner, comme `writeAsset`) → **effet « pas d'accumulation disque » non encore réalisé en prod** ; câblage suivi par l'issue **#207**.
7. **Fallback** : un jeu de mondes **pré-générés validés** si la génération échoue, est indispo, ou hors-ligne.

---

## 7. À cadrer plus tard

- **Design tokens** précis (hex, échelle d'espacement, typo, rayons) → skill `design-tokens` en phase build.
- **Typographie** : police arrondie, lisible enfant (gros chiffres pour les calculs) — à choisir avec les tokens.
- **Animation / motion** : style des transitions et du « juice » (rebonds doux, étincelles) — à spécifier au build.
- **Choix du modèle d'image** et coût/latence réels du pipeline.
- **Note marque (Steiff)** : reproduire Teddy + l'étiquette Steiff = OK en **usage familial/personnel**. Si un jour **publication/distribution publique**, revoir les questions de marque et de ressemblance Steiff.

---

## 8. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Style global | **Kawaii doux** (2D, **flat kawaii vector** + cel-shading léger + poils tuftés légers) — enrichi [ADR 0009](docs/adr/0009-style-fluffy-kawaii-unifie.md) |
| Couleurs | **Pastel lumineux + accents vifs**, palette dérivée **par monde** |
| Mascotte | **Teddy** (doudou réel, Steiff 80s stylisé kawaii), fil rouge, accessoires selon le monde, **généré depuis photos réelles** |
| Créatures | **ADN commun** : rondes, grands yeux, 1–2 traits distinctifs |
| Cohérence IA | Prompt de base verrouillé + Teddy ancré sur photos + style bible + variables only + QA kid-safe + fallback |
