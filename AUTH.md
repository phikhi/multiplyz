# multiplyz — Authentification & sécurité

> Portée : **app familiale** (un seul foyer). Single-tenant. Complément de [PLAN.md](./PLAN.md).
> Données = progression de jeu (rien de sensible) → sécurité **proportionnée**, pas d'usine à gaz.

---

## 1. Modèle (verrouillé)

- **Single-tenant** : un seul foyer sur le serveur → **pas de code famille, pas d'email**.
- **Profils enfants** : `nom + PIN 4 chiffres` (les prénoms sont uniques dans le foyer).
- **PIN parent distinct** pour l'espace parent.
- Multi-profils (frères/sœurs) prêt : plusieurs profils enfants sous le même foyer.

> Nom + PIN suffit **parce que** single-tenant. (Si un jour **public**, il faudra scoper par famille + durcir → cf. §6.)

## 2. Flows

- **1er usage** : créer le(s) profil(s) enfant (nom, avatar, PIN) + poser le **PIN parent**.
- **Connexion (n'importe quel appareil)** : aller à l'URL → choisir son profil dans la liste (servie par le serveur) ou saisir le nom → **PIN** → jouer.
- **Espace parent** : bouton discret → **PIN parent**.

## 3. Stockage & session

- **PIN hashé côté serveur** (argon2id ou bcrypt). **Jamais** en clair, jamais côté client.
- **Session** : cookie `httpOnly` + `Secure` + `SameSite=Lax`, token opaque.
  - Session enfant : durée longue (ex. 30 j) — confort.
  - Session **parent** : courte (ex. 15 min) pour l'espace parent, re-demande le PIN ensuite.
- **HTTPS obligatoire**.

## 4. Garde-fous (proportionnés)

- **Rate-limit** des tentatives PIN par profil **et** par IP : après ~5 échecs → **backoff** (délai croissant). Pas de verrou permanent (c'est un enfant), juste un ralentissement.
- **Anti-énumération** : message générique (« nom ou code incorrect »).
- **PIN parent ≠ PIN enfant**.
- Validation/sanitisation des entrées côté serveur.

## 5. Récupération (sans email)

- **PIN enfant oublié** → réinitialisable depuis l'**espace parent** (PIN parent).
- **PIN parent oublié** → **code de secours** généré à la création du foyer (8 caractères, à noter par le parent) permettant de réinitialiser le PIN parent. Le code de secours est **à usage unique** : à chaque réinitialisation réussie, l'ancien est consommé et un **nouveau code est régénéré + affiché une seule fois** (rate-limité comme la connexion, §4). Le path de vérif est réutilisable (rate-limit générique). (Filet ultime : accès direct à la base par le propriétaire — cf. #33/#7 pour consulter/régénérer le code depuis l'espace parent.)

## 6. Données & RGPD (usage familial)

- Données minimales : **prénom + PIN hashé + progression de jeu**. Pas d'email, pas de coordonnées, pas de localisation.
- Pas de tiers publicitaire, pas de tracking externe.
- **Propriété & suppression** : le parent possède le foyer ; depuis l'espace parent il peut **supprimer un profil** → efface ses données (mastery, attempts, progress, collection, wallet, ledger). Suppression du foyer = purge complète.
- **Données générées** (mondes/créatures IA) = partagées au foyer, non personnelles ; conservées (cache) indépendamment des profils.

## 7. Modèle de menace

- Enjeu **faible** (progression de jeu, foyer privé). Risque principal = un frère/sœur qui ouvre le mauvais profil → couvert par le PIN.
- **Si passage au public un jour** : ré-introduire code/compte famille, captcha, MFA parent, durcissement rate-limit, revue RGPD. Noté, hors scope maintenant.

## 8. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Portée | **Famille uniquement** (single-tenant) |
| Identité | **Nom + PIN** enfant ; PIN parent distinct |
| Email / code famille | **Aucun** |
| Stockage PIN | Hashé serveur (argon2id/bcrypt) |
| Sessions | Cookie httpOnly/Secure ; enfant longue, parent courte |
| Anti-abus | Rate-limit + backoff, message générique |
| Récupération | PIN enfant via parent ; PIN parent via **code de secours** |
