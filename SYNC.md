# multiplyz — Connectivité & données (online-first)

> Complément de [PLAN.md](./PLAN.md) (data), [ENGINE.md](./ENGINE.md) (logique). Remplace l'ancien « offline-first ».
> **Décision : réseau requis pour jouer.** Pas de moteur de synchro local → architecture simple.

---

## 1. Modèle (verrouillé)

- **Online-first** : `Client (Next.js/React)` ↔ `API (route handlers / server actions, runtime Node)` ↔ `SQLite local (VPS)`.
- **Serveur = source de vérité unique.** Toute la logique de maîtrise/économie est **côté serveur** (cf. ENGINE §10).
- Pas d'IndexedDB miroir, pas d'outbox, pas de résolution de conflits → **complexité évitée** (justifié : enjeu faible, « reprenable partout » assuré par l'état cloud dès qu'il y a du réseau).

## 2. Flux de données

- **Au login** : charger l'état du profil (carte de maîtrise, progression, portefeuille, collection, monde courant + buffer).
- **Pendant le jeu** : lire à la demande ; **écrire chaque réponse** (`attempt`), fin de niveau, et transaction éco → `POST` API → DB (maj `mastery`/`next_due`, `ledger`).
- **Optimiste à l'écran** : on affiche le feedback tout de suite ; l'écriture serveur confirme derrière.
- **Idempotence** : chaque écriture porte un **id client** → un retry ne crée pas de doublon.

## 3. Comportement réseau

- **Détection online/offline** (events navigateur + ping léger).
- **Perte de réseau en partie** : message doux « Oups, plus de réseau — on reprend dès que ça revient 🌐 », **pause**. La réponse en cours est **gardée localement** et **renvoyée** au retour (petite file de **retry courte**, PAS un moteur de sync).
- **Démarrage sans réseau** : écran « Connecte-toi à internet pour jouer ».
- **Génération de monde** : online uniquement (IA). Hors-ligne → uniquement les mondes déjà en **buffer** ; à défaut, **fallback pré-généré** (cf. ART.md).
- **Économie** : **dépenses en ligne uniquement** (œuf/boutique/évolution). Gagner des pièces marche tant qu'on joue (donc online aussi). → le serveur valide le solde, **zéro double-dépense, zéro conflit**.

## 4. PWA

- **Installable** (manifest + icône) pour un lancement type « app » depuis l'écran d'accueil.
- **Service worker** : précache la **coquille** (HTML/CSS/JS, polices, `tokens.css`) → démarrage rapide.
- **Le jeu reste online** (données + assets de monde). Assets de monde mis en **cache runtime** quand chargés (réaffichage rapide).
- Pas de prétention hors-ligne au-delà de la coquille.

## 5. Concurrence multi-appareils

- Même profil ouvert à 2 endroits : **serveur source de vérité**, écritures **idempotentes**, **progression monotone** (jamais de régression : on garde le max). Rare en usage familial.

## 6. Évolution possible

- Si un besoin **offline-first** réapparaît plus tard, le fait que la maîtrise se calcule à partir d'**`attempts` (événements)** côté serveur facilite l'ajout d'un miroir local + rejeu. Pas nécessaire aujourd'hui.

## 7. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Architecture | **Online-first** (réseau requis pour jouer) |
| Source de vérité | **Serveur / SQLite local (VPS)** |
| Offline | Coquille PWA seulement ; message doux + retry court si coupure |
| Économie | Dépenses **en ligne uniquement** |
| Conflits | Évités : serveur autoritaire + idempotence + progression monotone |
| Génération monde | Online ; sinon buffer puis fallback |
