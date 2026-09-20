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
- **Aventure TEDDy** : le feedback, le passage à la question suivante et les gains attendent la confirmation serveur. L'écran conserve la question et indique l'enregistrement en cours. Les anciennes surfaces peuvent encore afficher un feedback optimiste.
- **Idempotence** : chaque écriture possède une identité stable → un retry ne crée pas de doublon. Dans l'aventure, il s'agit de l'identifiant de session attribué par le serveur et de sa révision ; l'identifiant de tentative est dérivé de cette session et de l'index de question.

### Session d'aventure intégrée

Contrat détaillé : [ADR 0019](docs/adr/0019-session-aventure-persistante.md).

- `adventure_sessions` conserve une ligne par profil : questions composées par le moteur, cible monde/niveau, état pédagogique, phase d'aide ou de rencontre et reçu final. La suppression du profil supprime son checkpoint.
- Réponse, tentative, maîtrise et checkpoint sont écrits dans une transaction. La fin du niveau écrit progression, portefeuille, journal et reçu dans une transaction. Une réponse réseau perdue restitue cet état au renvoi, sans créditer le niveau suivant.
- Le reçu reste sauvegardé jusqu'au retour au chemin ; un nouveau démarrage remplace ensuite la session close. Une réouverture retrouve l'étape confirmée, y compris une aide ou le résultat.
- Le navigateur conserve une seule intention en attente par profil avant l'envoi, plus le brouillon et le temps actif de la question. Cette intention est renvoyée avant tout nouveau démarrage après fermeture. Elle ne permet pas de continuer à jouer hors ligne et n'est récupérable que sur ce navigateur tant que le serveur ne l'a pas reçue.
- Plusieurs onglets à la même révision : la première commande acceptée fait foi, les autres reçoivent le checkpoint courant. Une commande d'une ancienne session ne peut pas modifier la nouvelle.

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

### TEDDy — reprise d’un achat d’œuf

L’intention d’achat et celle d’acquittement de la rencontre sont conservées par profil dans le navigateur avant leur envoi. Une coupure conserve l’identifiant et la destination ; une reprise ne débite pas une seconde fois. Le serveur conserve le résultat dans `egg_receipts` avec la transaction économique, et retrouve une rencontre non acquittée même sur un autre navigateur. L’ouverture visuelle de l’œuf ne déclenche aucune mutation économique. Voir [ADR 0020](docs/adr/0020-rencontre-oeuf-persistante.md).
## Acquisition ciblée avec éclats — TEDDy

L’intention d’achat ciblé garde son identifiant et son compagnon dans le stockage local du profil avant envoi. Le serveur écrit le débit, la possession et le reçu dans la même transaction. Une réponse perdue conserve l’intention ; son rejeu restitue le résultat exact sans nouvelle dépense. Les intentions concurrentes sont liées à la rencontre encore en attente et restent rejouables après son acquittement. La destination de sortie est conservée localement jusqu’à confirmation de cet acquittement. Le profil attendu doit encore correspondre à la session. Contrat : [ADR 0021](docs/adr/0021-acquisition-ciblee-persistante.md).


### TEDDy — premier voyage, pause et retour quotidien

Le diagnostic initial et le recalibrage utilisent aussi `adventure_sessions`. Questions, premières réponses, aide, progression et pause sont confirmées à chaque commande. La dernière transition écrit l’amorce de maîtrise (ou sa fusion monotone) et le checkpoint final ensemble. Ni tentative de niveau, ni score, ni récompense ne sont créés par ce voyage. Un niveau déjà en cours se termine avant un recalibrage demandé par le parent.

La pause et la reprise utilisent la même révision idempotente que les réponses. « M’arrêter pour aujourd’hui » devient disponible après confirmation serveur ; la pause se retrouve sur un autre appareil authentifié. Une intention encore seulement locale reste limitée au navigateur qui l’a saisie. Le retour quotidien privilégie une aventure active, puis les rencontres d’œuf, achat ciblé ou évolution non acquittées. Il ne lance aucune nouvelle dépense.

En fin de niveau, le jour de la suggestion de pause est enregistré dans le checkpoint et transmis à l’aventure suivante : une invitation par jour, avec possibilité de continuer. Le plafond parental interdit une nouvelle partie jusqu’au jour suivant, en préservant celle qui a déjà commencé. Même fuseau et même estimation temporelle que le suivi parental existant ; détails et limites dans [ADR 0023](docs/adr/0023-premier-voyage-et-pauses.md).
