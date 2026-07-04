# multiplyz — Spec produit

> Complément de [PLAN.md](./PLAN.md) (architecture/stack/data). Ici : flows, mécanique de jeu, pédagogie, et les angles oubliés.
> Public : fille ~8 ans (CE1→CE2). Ton : **tutoiement**, encourageant, jamais culpabilisant. UI **français**.

---

## 1. Flows utilisateurs

### 1.1 Premier lancement (onboarding enfant)
1. **Accueil** : choisir/créer un profil.
2. **Création profil** : prénom + choix d'avatar + **PIN 4 chiffres** (gros pavé).
3. **PIN parent** : le parent pose son **PIN distinct** (1 fois) + courte explé de la méthode.
4. **Diagnostic déguisé en jeu** : « Petit défi pour préparer ta carte ! » — ~18 calculs répartis sur les 4 compétences (cf. ENGINE §3/§12), adaptatif, **aucun score montré**. Finit sur « Bravo, ton aventure est prête ! ».
5. **Atterrissage** : carte du monde, 1er monde débloqué, compagnon de départ offert.

### 1.2 Retour quotidien (enfant)
1. Sélecteur de profil → **PIN enfant**.
2. **Récompense de retour** : coffre/œuf du jour (doux, pas de blocage si jour manqué).
3. **Reprise** : bouton « Continuer » → prochain niveau recommandé par le moteur (mix entretien + nouveau).
4. **Session** : enchaîne des parties (~3–4 min chacune) jusqu'au **nudge des 15–20 min** : « Super boulot ! Reviens demain pour la suite 🌙 » (incitation douce, pas de verrou dur sauf si le parent l'active).

### 1.3 Déroulé d'une session
`Carte → Niveau → Résultats → (niveau suivant ou collection/boutique) → nudge stop`.
Toujours un **point de reprise** : si elle quitte en plein niveau, on reprend où elle en était (offline-safe).

### 1.4 Flow parent
1. Depuis l'accueil (coin discret) → **PIN parent**.
2. **Tableau de bord** (cf. PLAN §Espace parent) : justesse, rapidité/fluence, carte de maîtrise, à revoir, régularité, progression.
3. **Réglages parent** : son/musique, plafond de temps quotidien (optionnel), réinitialiser/recalibrer, gérer les profils.

### 1.5 Gestion multi-profils (frère/sœur — prêt mais v2)
Ajouter un profil enfant depuis l'accueil (modèle DB déjà compatible). Chaque profil = progression + collection + économie séparées.

### 1.6 Multi-appareils / réseau
- **Réseau requis pour jouer** (online-first ; pas d'offline-first). Cf. [SYNC.md](./SYNC.md).
- Reprise sur n'importe quel appareil : aller à l'URL → **nom + PIN** (état serveur SQLite fait foi). Cf. [AUTH.md](./AUTH.md).
- Coupure réseau en partie → message doux + reprise au retour (retry court). Progression **monotone** (jamais de régression).

---

## 2. Mécanique de jeu

### 2.1 La carte & les mondes
- **Carte = chemin de nœuds** (style Candy Crush) à l'intérieur d'un monde ; le dernier nœud ouvre le **monde suivant** (nouveau thème généré).
- **Monde** ≈ **10 niveaux + 1 boss** (11 nœuds). Thème = pure peau (animaux/océan/magie/galaxie/…), **généré en continu** par IA.
- **Types de nœuds** :
  - **Niveau normal** : ~10 questions (mix du moteur).
  - **Niveau révision** : 100 % calculs faibles/dus (apparaît quand il y a de la dette).
  - **Trésor/bonus** : mini-défi court → pièces bonus.
  - **Boss de monde** : défi un peu plus long → débloque la **créature légendaire** du monde + gros lot de pièces.
- **Déblocage des mondes** : **linéaire** — battre le **boss** d'un monde ouvre le monde suivant (cf. [MAP.md](./MAP.md) §1/§8). **Les étoiles = récompense/collection, PAS une barrière** de déblocage. Toujours un monde de plus → infini.

### 2.2 Déroulement d'une partie (un niveau)
1. **Carte d'intro** : thème + compagnon (« Aide Teddy à traverser la forêt ! »).
2. **~10 questions**, barre de progression visible. Pour chaque calcul :
   - **Choix du format selon la maîtrise** (cf. §3) :
     - calcul **nouveau/faible** → **QCM 4 choix** (reconnaissance + distracteurs intelligents).
     - calcul **en cours/connu** → **pavé numérique** (rappel libre, gros boutons).
   - **Bonne réponse** → juice : étincelles, étoile, compagnon content, petit son. Combo si série.
   - **Mauvaise réponse** → **aucune sanction** : on montre **d'abord le visuel d'étayage** (dix-cases, matrice, droite numérique — l'enfant « voit » le calcul par la représentation, outil de découverte), **puis la bonne réponse en synthèse APRÈS** (issue #100, ADR 0007 : l'étayage-découverte précède le résultat) ; elle **refait une fois**, le calcul est marqué faible (reviendra plus tôt).
   - Bouton **« Je ne sais pas »** → montre un indice/étayage au lieu de forcer à deviner ; compté comme non-su, sans pénalité.
3. **Pas d'échec possible** : un niveau se termine toujours. La justesse détermine seulement le nombre d'étoiles.
4. **Écran de résultats** : étoiles (1–3), pièces gagnées, créature/œuf éventuel, encouragement.

### 2.3 Déblocages & récompenses
- **Étoiles** (1–3 par niveau, selon **justesse**, pas la vitesse). Seuils doux à calibrer (ex. ≥60 % = ⭐, ≥85 % = ⭐⭐, ~100 % = ⭐⭐⭐). Même 1 étoile fait progresser.
- **Pièces** : gagnées par niveau (base + bonus par étoile) → dépensées en **œufs** & **personnalisation**.
- **Créatures à collectionner** : légendaire **garantie** au boss de chaque monde + créatures communes via **œufs** (gacha SANS argent réel, pièces gagnées en jouant). Doublon → **éclats** pour faire évoluer une créature.
  > Garantie de complétude : on peut toujours compléter la collection d'un monde en jouant (pas de mur payant, pas de RNG punitif).
- **Personnalisation** : avatar + compagnon (tenues, couleurs). Cosmétique pur, zéro avantage de jeu.
- **Collection (Pokédex)** : créatures avec **nom + ligne d'histoire** ; l'enfant peut **renommer** ses créatures (engagement).
- **Régularité** : compteur de jours (flamme), coffre quotidien ; jour manqué = **doux** (pas de perte brutale ; option « gel de série »).

---

## 3. Pédagogie & méthode

### 3.1 Modèle de maîtrise (rappel + détails)
- **Fact = calcul atomique** (clé stable). Maîtrise type **Leitner** (force 0–5) + `next_due` (révision espacée).
- **Fluence** : un calcul juste **mais lent** = pas encore automatisé → la **rapidité module la force** (mesurée en silence, aucun chrono visible).
- **Diagnostic** initial pour amorcer les forces (ne pas présumer l'acquis).
- **Sélection par niveau** : ~70 % dus/faibles + ~30 % nouveaux/entretien. Génération infinie.

### 3.2 Format de question lié à la maîtrise (la règle clé)
| État du calcul | Format | Pourquoi |
|---|---|---|
| Nouveau / faible (force 0–1) | **QCM 4 choix** | Reconnaissance d'abord, moins frustrant, on installe |
| En cours / connu (force ≥2) | **Pavé numérique** | Rappel libre = mémorisation plus forte |

- **Distracteurs QCM intelligents** : basés sur les **erreurs typiques** (voisin de table, ±1, addition au lieu de multiplication…), jamais aléatoires → le QCM enseigne aussi.

### 3.3 Progression du mélange (interleaving progressif)
- **Début** : une partie = **un seul type** (rassurant, on consolide).
- **Ensuite** : on **mélange les types** dans une même partie (interleaving) → bien meilleure rétention long terme. Bascule pilotée par la maîtrise globale.

### 3.4 Étayage visuel par compétence
- **Compléments à 10** → dix-cases / dizaine.
- **Addition** → droite numérique / jetons.
- **Soustraction** → droite numérique (recul) / jetons retirés.
- **Multiplication** → groupes répétés / matrice (6×8 = 6 paquets de 8).

### 3.5 Posture & langage
- **Croissance** : « pas encore » plutôt que « faux » ; on valorise l'effort et le progrès.
- **Zéro pression temporelle**, zéro classement public, zéro vie perdue.
- Encouragements variés (éviter la répétition robotique).

### 3.6 Recalibrage
- Si elle régresse (oublis) ou explose un palier, le moteur **réajuste** automatiquement (les calculs ratés reviennent, l'élargissement se déclenche). Parent peut **recalibrer** manuellement.

---

## 4. À cadrer / oublis utiles à spécifier

- **Écran Réglages** : son on/off, musique on/off, langue, (futur) accessibilité.
- **Accessibilité** (certains en v2) : **lecture vocale des énoncés (TTS)** en option, police lisible, gros boutons, fort contraste, sûr pour daltonisme. (Audio v1 = bruitages + musique uniquement, choix validé.)
- **Anti-frustration** : no-fail, indices, « je ne sais pas », jamais de chrono visible.
- **Anti-triche / spam** : la fluence (temps) repère les réponses tapées au hasard ; pas de récompense à marteler.
- **Onboarding parent** : courte explication de la méthode (Leitner/espacée, no-fail) + pose du PIN parent.
- **Contrôles parent** (optionnels) : plafond de temps quotidien (verrou doux), réinitialiser/recalibrer, couper le son.
- **Notifications** : **aucune en v1** (habitude portée par le nudge in-app). Détails : [DETAILS.md](./DETAILS.md).
- **Confidentialité enfant (RGPD)** : données minimales (**prénom + PIN**, pas d'email), usage familial. **Modération des images IA** (sûr pour enfant) avant affichage.
- **Modération contenu généré** : noms/thèmes de mondes et créatures filtrés (kid-safe), fallback pré-généré si doute.
- **États vides / erreurs** : pas de réseau, génération de monde en attente (utiliser le buffer/fallback), profil vide.
- **Reprise en cours de niveau** : sauvegarde de l'état question par question.
- **Calibration des nombres** (étoiles, pièces, prix œufs/cosmétiques, seuils de fluence) : à régler au playtest avec elle — **le vrai juge = rejoue-t-elle demain ?**

---

## 5. Décisions produit verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Saisie réponse | **Hybride** : pavé par défaut, QCM en soutien (lié à la maîtrise) |
| Récompenses | Étoiles + collection + **pièces → œufs + personnalisation** |
| Audio | Bruitages + musique (**pas** de lecture vocale en v1 ; TTS = option accessibilité plus tard) |
| Mélange des calculs | **Progressif** : bloqué au début → interleaving ensuite |
| Échec | **No-fail** : un niveau se termine toujours, la justesse fixe les étoiles |
| Boss de monde | Débloque la **créature légendaire** + gros lot de pièces |
