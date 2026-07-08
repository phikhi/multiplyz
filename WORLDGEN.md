# multiplyz — Générateur de mondes (opérationnel)

> Côté opérationnel du pipeline IA décrit dans [ART.md](./ART.md). Complète [PLAN.md](./PLAN.md) (tables `worlds`/`characters`) et [SYNC.md](./SYNC.md) (online-first).

---

## 1. Décisions (verrouillées)

- **Hybride** : socle de **~5-8 mondes pré-générés et validés** (toujours dispo, fallback, démarrage instantané) + **génération paresseuse au-delà** (buffer d'avance).
- **Modération** : **auto-filtre kid-safe** + **validation parent optionnelle** (toggle dans l'espace parent).
- Assets **partagés** entre profils du foyer + **mis en cache pour toujours**.

## 2. Modèle de coût (pourquoi hybride ≈ tout-à-la-volée)

- Coût = **nb de mondes uniques atteints × ~images/monde**, payé **une seule fois** par monde (cache permanent, partagé).
- Un monde ≈ **~10-12 images** (fond + tuiles + variante Teddy + 6-8 créatures) + textes.
- Famille = peu de mondes uniques sur la durée → **coût absolu faible**.
- Garde-fous coût : cache permanent, partage inter-profils, **buffer petit (2)**, **alerte/plafond mensuel** ⚙️.

## 3. Déclenchement & buffer

- Maintenir **2 mondes d'avance** sur le `world_index` courant de l'enfant.
- Quand elle avance → on **enqueue** la génération du monde manquant dans une **file de jobs** (table `jobs` SQLite ; BullMQ+Redis en option), consommée par un **worker daemon** (géré par Forge).
- Worlds en statut `buffered` → deviennent `active` après QA (+ validation parent si activée).
- Génération **online uniquement** (cf. SYNC). Hors buffer/hors-ligne → **fallback** pré-généré.

## 4. Étapes de génération d'un monde

1. **Choisir un thème** depuis un **pool kid-safe** (liste curatée + variations ; liste de thèmes **bannis**). Éviter doublon récent.
2. **Dériver la palette** → pose `--world-accent` (cf. [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) : le tint se dérive, theme-safe).
3. **Générer les assets** (prompt de base verrouillé + variables, cf. ART §5) :
   - fond `16:9`, tuiles de carte,
   - **variante Teddy** = img2img **ancré sur le master Teddy** (cf. §8) + accessoire du monde (**jamais** les photos directement),
   - **6-8 créatures** (réparties par rareté, cf. ECONOMY) + noms + lignes d'histoire (texte).
4. **QA kid-safe** (cf. §6). Rejeté → régénérer.
5. **Stocker** assets + métadonnées + **prompt + seed** (reproductibilité).
6. Statut `active` (après validation parent si activée).

> **Ordre d'exécution réel = write-then-gate** (cf. [ART §6](./ART.md#6-stratégie-de-cohérence-le-plus-important), réconcilié #176) : les étapes 4/5 décrivent l'**intention pédagogique** (valider avant d'exposer), pas l'ordre d'écriture DB — à l'implémentation, les assets sont **écrits d'abord** (fichiers servables + ligne `worlds` en `buffered`), **puis** la QA s'exécute sur le pixel rendu, **puis** la **visibilité** est gardée par le statut (`active` seulement après QA réussie).

## 5. Modèle d'image & stockage

- **Modèle** : **Nano Banana (Gemini 2.5 Flash Image)** — **consistance de personnage** + **img2img** + fusion multi-références (idéal pour Teddy). **Confirmé par spike** (ADR 0008, 2026-07-06 — cf. `docs/spike/nano-banana/`) : qualité kawaii flat-vector excellente, consistance Stage A→B excellente, **~0,039 $/image** (~0,45 $/monde), aucune sur-censure. Clé **API Gemini** (`GEMINI_API_KEY`). Modèle ⚙️ (`IMAGE_MODEL` override) — chemin d'upgrade vers `gemini-3-*-image` ouvert sans lock-in. **Contraintes actées** (spike) : retry transitoire (500/503/429), prompt « blank ear tag, no text », pas d'alpha fiable (fond blanc → détourage/carte pleine ⚙️).
- **Assets** → **disque local du VPS**, servis par **Nginx** (dossier `public/`/storage). (Cloudflare devant en option plus tard pour le cache.)
- **Métadonnées** → **SQLite local** : `worlds` (theme, palette, asset_refs, **prompt**, **seed**, status, approved_by) + `characters` (cf. ECONOMY).

## 6. Modération (kid-safe)

- **Auto-filtre** : classifieur de sécurité image + règles (pas de texte, rien d'effrayant/inapproprié, cohérence de style).
- **Validation parent optionnelle** : si activée, un monde `buffered` attend l'**approbation** dans l'espace parent avant `active`. Sinon auto.
- Échec → **régénération** (jusqu'à N essais), sinon on reste sur le fallback.

## 7. Fallback & reproductibilité

- **Socle pré-généré** (~5-8 mondes validés) **embarqué** : premier lancement instantané, secours si IA indispo / hors buffer.
- **prompt + seed stockés** → un monde peut être **régénéré à l'identique** (correctif, migration).

## 8. Teddy — pipeline 2 stages (model sheet)

> Technique du **model sheet** : on ne refait **jamais** le transfert photo→kawaii à chaque monde.

- **Stage A (1×, au démarrage)** : photos réelles → **master Teddy kawaii** + **model sheet d'expressions** (neutre · content · oups · acclame · intrépide). **Validé à la main** (= LE Teddy canonique). Stocké comme **assets de référence**.
- **Stage B (par monde)** : générer la variante (accessoire du monde) en **ancrant sur le master**, **plus jamais les photos** → une seule transformation → consistance maximale + moins cher.
- **Double usage** : le model sheet sert aussi de **sprites de réaction** en jeu (cf. COPY : réussite / oups / boss…).
- **Photos** = utilisées **uniquement au Stage A**.

## 9. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Production | **Hybride** (socle pré-généré + génération paresseuse) |
| Buffer | 2 mondes d'avance |
| Modération | Auto-filtre + **validation parent optionnelle** |
| Stockage | Assets sur **disque VPS** (Nginx), métadonnées + prompt + seed en **SQLite** |
| Modèle image | **Nano Banana** (Gemini 2.5 Flash Image) — img2img + consistance ; **confirmé par spike** (ADR 0008) |
| Teddy | **2 stages** : master validé (Stage A) → ancre par monde (Stage B) ; jamais les photos après A |
| Coût | Cache permanent + partage → ~1 paiement / monde unique |
| Partage | Mondes partagés entre profils du foyer |
