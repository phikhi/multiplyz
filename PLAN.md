# multiplyz — Jeu de maths pour combler les lacunes (8 ans)

## Context

Papa veut un jeu web **ludique** pour aider sa fille de 8 ans (≈ CE2) à combler de **vraies lacunes** en calcul :
- **Compléments à 10** : censés acquis, mais encore fragiles.
- **Tables d'addition**.
- **Tables de multiplication** : devrait connaître jusqu'à 8, mais des trous.

Elle **termine son CE1 et passe en CE2** à la rentrée → le scope inclut les **soustractions** (attendues en CE1).

Enjeu double : (1) que ce soit assez fun pour qu'elle revienne, (2) que ce soit un **vrai outil de remédiation** ciblant ses calculs ratés, pas un gadget. La partie doit être **reprenable sur n'importe quel appareil** (PC, tél, tablette). Le papa veut aussi un **espace parent** pour suivre la progression quotidienne.

Projet **greenfield** : tout est à créer.

## Décisions verrouillées (issues du grilling)

- **Plateforme** : Web / PWA installable. Desktop d'abord mais **responsive** (obligatoire car multi-appareils).
- **Stack** : Next.js (App Router) + React + TypeScript + Tailwind. **SQLite local** (`better-sqlite3`, mode WAL) via Drizzle ORM. **Hébergement : VPS OVH via Laravel Forge** (Next.js en daemon Node derrière Nginx + Let's Encrypt). Détails : [STACK.md](./STACK.md).
- **Connexion légère** : profil + **PIN 4 chiffres** (pas d'email/mot de passe). Modèle multi-profils prêt pour frères/sœurs plus tard.
- **Forme du jeu** : carte du monde **sans fin** (façon Candy Crush, jamais d'écran de fin). Niveaux **générés procéduralement**. Les **mondes sont une pure peau de récompense**, **générés en continu** (nouveaux thèmes produits à la volée par IA, voir section dédiée). La **difficulté math est indépendante** des mondes, pilotée par le moteur de maîtrise.
- **Moteurs de rétention** (ses 3 préférés) : persos mignons à **collectionner** + petite **histoire** + **passage de niveaux**. **Pas de chrono** (moins de stress = meilleur apprentissage).
- **Pédagogie** : erreur sans punition → on montre la bonne réponse avec un **visuel adapté** → elle refait. **Maîtrise suivie par calcul** + **révision espacée** (les calculs ratés reviennent plus souvent). **Mini-diagnostic** au départ (on ne suppose pas ce qu'elle "devrait" savoir). **Temps de réponse mesuré en silence** (aucun chrono visible côté enfant) → alimente la fluence et l'espace parent.
- **Périmètre math** : échelle de contenu **sans fin**. Cœur = **4 compétences** : compléments à 10, **tables d'addition**, **soustractions** (CE1), **tables de multiplication 1–10** (focus 1–8 où elle coince). Puis **élargissement progressif automatique** : plus grands nombres. **Division → hors scope pour l'instant.**
- **Espace parent (v1)** : tableau de bord protégé par un **PIN parent distinct** ; analyse quotidienne (rapidité, justesse, calculs à revoir, régularité).
- **Sessions** : **15–20 min** par design (≈ plusieurs niveaux) + incitation douce « reviens demain ».
- **Visuels** : personnages **générés par IA**, sur-mesure, **style cohérent par monde**.
- **Saisie** : gros **boutons-réponses cliquables** par défaut ; clavier en option.

## Architecture

- **Front** : Next.js App Router, TS, Tailwind. PWA (manifest + service worker, coquille hors-ligne).
- **DB** : **SQLite local** (fichier sur le VPS, mode WAL) + `better-sqlite3` + **Drizzle ORM** (migrations versionnées). Backup = copie du fichier.
- **API** : route handlers / server actions Next.js en **runtime Node** (requis pour SQLite local) — auth PIN, progrès, état de maîtrise.
- **Auth-lite** : profil enfant + PIN hashé (bcrypt/argon2), session cookie. Sélecteur de profil au démarrage. **PIN parent distinct** pour accéder à l'espace parent (l'enfant ne peut pas y entrer ni fausser les données).
- **État client** : store léger (Zustand) ; **online-first** : serveur = source de vérité, écritures à chaque réponse/fin de niveau (idempotentes). **Réseau requis pour jouer** ; PWA = coquille en cache + message doux si coupure. Détails : [SYNC.md](./SYNC.md). Auth : [AUTH.md](./AUTH.md).

## Modèle de données (SQLite local)

- `profiles` : id, name (unique), **name_key** (clé dérivée `nameKey(name)` = NFC + minuscule locale-aware ; index UNIQUE → unicité prénom **insensible à la casse Unicode**, `lower()` SQLite étant ASCII-only — ADR 0005), pin_hash, avatar, created_at, **parent_pin_hash** (accès espace parent), **recovery_code_hash** (réinit PIN parent sans email — AUTH §5). *Le PIN parent + code de secours sont portés par le profil **propriétaire** du foyer (single-tenant).*
- `sessions` : token (opaque, PK), profile_id (FK `ON DELETE CASCADE`), kind (`child`|`parent`), created_at, expires_at — **sessions serveur** (source de vérité ; cookie httpOnly ne porte que le token — AUTH §3). GC des lignes expirées : purge opportuniste au login (⚙️ `auth.gcSessionsOnLogin`, cf. #44).
- `mastery` : profile_id, fact_id, skill, strength (boîte Leitner 0–5), correct_count, wrong_count, **avg_response_ms** (fluence), last_seen, next_due
- `attempts` : profile_id, fact_id, skill, correct (bool), **response_ms**, created_at — **une ligne par réponse** ; matière première de l'espace parent (justesse, rapidité, régularité, tendances)
- `progress` : profile_id, world_index (croît à l'infini), level, stars
- `collection` : profile_id, character_id, unlocked_at
- `worlds` : id, index, theme, palette, asset_refs (fond/tuiles), status (`buffered`|`active`), created_at — **mondes générés**, partagés entre profils
- `characters` : id, world_id, image_ref, name, story — créatures générées par monde

> Un **fact** = un calcul atomique, identifié par une clé stable (ex. `mult_6x8`, `comp10_7`, `add_4+9`, `sub_12-5`). Pas besoin de table catalogue : génération à la volée + clé.

> **Économie** : tables `wallet`, `cosmetics`/`cosmetics_owned`, `inventory_items`, `daily`, `ledger` (+ extensions de `characters`/`collection`) détaillées dans [ECONOMY.md](./ECONOMY.md).

## Cœur pédagogique (le plus important)

- **Diagnostic léger** : la première session sonde un échantillon réparti sur les **4 compétences** (compléments à 10, addition, soustraction, multiplication) pour initialiser les niveaux de maîtrise (ne PAS présumer l'acquis).
- **Maîtrise par calcul** (style **Leitner**) : faux → la force baisse, le calcul revient vite ; juste répété → espacement croissant (`next_due`). **Fluence** : un calcul juste mais lent reste considéré non automatisé (le temps de réponse module la force).
- **Sélection des questions par niveau** : ~70 % de calculs **dus/faibles** + ~30 % nouveaux/entretien. ~10 questions par niveau (~3–4 min). Niveaux **générés à l'infini** à partir de cet algorithme — il y a toujours un niveau suivant.
- **Après maîtrise du cœur** : **entretien à vie** (révision espacée des calculs connus, habitude quotidienne) **+ élargissement automatique** quand la maîtrise globale est haute (échelle : **plus grands nombres** ; division hors scope pour l'instant). On ne tombe jamais à court de niveaux.
- **Visuels d'étayage** :
  - Compléments à 10 → **dix-cases / dizaine** (ten-frame).
  - Addition → droite numérique / jetons.
  - Soustraction → droite numérique (recul) / jetons que l'on retire.
  - Multiplication → **groupes répétés / matrice** (ex. 6×8 = 6 paquets de 8).
- **Gestion d'erreur** : aucune sanction ; on affiche la bonne réponse avec le visuel correspondant ; elle refait une fois ; le calcul est marqué faible.
- **Juice sans pression** : combo d'étincelles sur série de bonnes réponses, encouragements ; jamais de compte à rebours.

## Couche jeu / progression

- **Carte du monde sans fin** : on enchaîne mondes après mondes, débloqués par le **total d'étoiles**. Pas de dernier monde.
- **Niveau** = ~10 questions (mix du moteur de maîtrise) → étoiles selon la **justesse** (pas la vitesse) → déblocage d'un **perso à collectionner** du monde.
- **Collection** type « Pokédex » : roster qui **grandit sans fin** (nouvelles créatures à chaque nouveau monde généré) ; chaque créature a un nom + une ligne d'histoire.
- **Boucle quotidienne douce** : petit bonus « reviens demain », sans blocage dur.

## Espace parent (v1)

Accès via **PIN parent distinct**. Alimenté par la table `attempts` + `mastery`. Indicateurs pédagogiques pertinents :

- **Justesse** : % de bonnes réponses, global et **par compétence** (compléments/addition/soustraction/multiplication), avec tendance dans le temps.
- **Rapidité / fluence** : temps moyen par calcul + évolution (mesuré en silence côté enfant). Repère l'automatisation.
- **Carte de maîtrise** : calculs **maîtrisés / en cours / faibles** par compétence (heatmap des tables, ex. quelles tables de multiplication coincent).
- **À revoir** : top des calculs ratés/lents → quoi réviser en priorité.
- **Régularité** : jours joués, temps de jeu/jour, série de jours, respect des 15–20 min.
- **Progression** : monde/niveau atteint, créatures débloquées.

## Visuels générés par IA — pipeline de génération continue

Comme les thèmes sont **générés en continu**, ce n'est pas un dossier figé mais un **pipeline** :

- **Charte de style unique** (ex. flat, arrondi, pastel, kawaii) verrouillée dans un prompt de base, **réinjectée à chaque génération** → cohérence visuelle entre tous les mondes malgré la génération continue.
- **Générateur de monde** : produit à la demande un nouveau monde = { nom de thème, palette, fond, tuiles de carte, **6–8 créatures**, lignes d'histoire }, toujours via la charte.
- **Buffer d'avance** : pré-générer quelques mondes en amont (file d'attente) + générer paresseusement les suivants quand elle approche → pas d'attente côté enfant.
- Assets stockés (ex. blob/CDN ou `/public`) + métadonnées des mondes/créatures en DB (manifeste : id → image, nom, monde, histoire).
- ⚠️ **Caveat** : génération IA = coût + risque d'incohérence/qualité. Garder la charte stricte, valider/filtrer les sorties, prévoir un **fallback** (jeu de mondes pré-générés) si la génération échoue ou est indispo hors-ligne.

## Écrans v1

1. Sélection de profil + PIN
2. Carte du monde
3. Niveau (question, boutons-réponses, visuel d'étayage, feedback)
4. Résultats de niveau (étoiles, créature débloquée)
5. Collection
6. **Espace parent** (PIN parent) : tableaux de bord justesse / rapidité / maîtrise / régularité

## Ordre de construction (tranches verticales)

1. **Scaffold** : Next.js + TS + Tailwind + PWA + SQLite local (better-sqlite3, WAL) + schéma Drizzle + migrations.
2. **Auth-lite** : créer profil + PIN, login, cookie de session, sélecteur de profil.
3. **Moteur math (sans habillage)** — *tranche la plus risquée et la plus précieuse, à valider en premier* : génération **infinie** de niveaux à partir des calculs (**4 compétences** : compléments à 10, addition, soustraction, multiplication) + modèle de maîtrise + révision espacée + **mesure du temps de réponse** + **échelle d'élargissement** (plus grands nombres) + un écran de jeu nu (boutons) + persistance (`attempts`).
4. **Visuels d'étayage** par compétence (dix-cases, matrice, droite numérique).
5. **Couche jeu** : carte du monde **sans fin**, niveaux, étoiles, déblocages.
6. **Pipeline de génération de mondes IA** : charte de style + générateur de monde + **buffer d'avance** + fallback pré-généré. Collection qui grandit + passe artistique.
7. **Espace parent** : PIN parent + tableaux de bord (justesse, rapidité/fluence, carte de maîtrise, à revoir, régularité) à partir de `attempts`/`mastery`.
8. **PWA & responsive** : installable, coquille hors-ligne ; desktop → tablette → tél ; son/juice.
9. **Optionnel** : bonus quotidien.

## Vérification

- `pnpm dev` → navigateur : créer un profil, jouer un niveau, **rater un calcul** → voir le visuel → refaire. Confirmer que la maîtrise **persiste dans SQLite** (requête DB).
- **Multi-appareils** : se reconnecter sur tél avec même profil+PIN → la progression reprend.
- **Pédagogie** : rater volontairement des calculs précis (ex. 6×8) → vérifier qu'ils **reviennent plus tôt** aux niveaux suivants.
- **Infini** : enchaîner beaucoup de niveaux → toujours un niveau suivant, jamais d'écran de fin ; vérifier que de **nouveaux mondes se génèrent** (buffer) et que le fallback s'active si la génération est coupée.
- **Espace parent** : se connecter avec le **PIN parent** → vérifier que justesse, rapidité, carte de maîtrise et régularité reflètent les sessions jouées ; vérifier qu'un calcul raté/lent remonte dans "à revoir". Confirmer que l'enfant ne peut pas y accéder.
- **PWA** : Lighthouse (installable + coquille hors-ligne OK).
- **Test réel** : la fille rejoue-t-elle le lendemain ? (le seul vrai juge)

## Plus tard

- **Division** (volontairement hors scope pour l'instant).
- Profils multiples (modèle déjà compatible).
- App native (Expo) si elle la veut en vraie app sur tablette.
- Design sonore / musique.

> Note : la **soustraction** est désormais dans le cœur v1 (niveau CE1). La division reste hors scope.
