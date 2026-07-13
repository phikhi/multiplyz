# multiplyz — Détails (points mineurs)

> Regroupe les ⚪ mineurs. Complète les specs principales.

---

## 1. Notifications

- **Aucune notification en v1** (ni push, ni rappel système). Décision.
- Habitude quotidienne portée par le **nudge in-app** « reviens demain » (cf. COPY) + récompense de retour.
- *Futur possible* : push opt-in parent (désactivé par défaut). Hors scope.

## 2. Accessibilité

- **TTS (lecture vocale) : reporté** (pas en v1). Audio v1 = **bruitages + musique** seulement.
  - *Quand on l'ajoutera* : **Web Speech API** (gratuit, intégré, voix FR) → toggle 🔊. C'est le correctif d'accessibilité prioritaire vu le choix « riche en histoire » (cf. COPY §1) — donc histoire en **beats courts, gros texte, illustrés, zappables** en attendant.
- **Déjà couvert par les tokens** : contraste suffisant, cibles tactiles ≥ 44 px, `prefers-reduced-motion`, feedback **doublé d'icône** (daltonisme), police arrondie lisible (Baloo 2 / Nunito).

## 3. Écran Réglages

**Accès enfant (rapide, sans PIN)** — *quick-mute in-game (ADR 0017)* :
- Son on/off, musique on/off (muter vite dans une pièce calme). Le **volume** et les réglages complets vivent côté parent.
- (Thème clair/sombre — ou laissé au parent, au choix au build.)

**Espace parent (PIN parent)** :
- Thème clair/sombre.
- **Son & musique** : son on/off, musique on/off, **volume** (source de vérité unique ; l'enfant peut muter son/musique sans PIN via le quick-mute in-game — ADR 0017).
- **Temps d'écran** : nudge doux 15-20 min (défaut) **+ verrou dur optionnel** paramétrable (X min/jour → l'app se verrouille en douceur jusqu'au lendemain).
- **Gérer les profils** : créer / renommer / **supprimer** (purge données) / **réinitialiser le PIN enfant**.
- **Recalibrer** : relancer un mini-diagnostic (à confirmer). Fusion **MONOTONE** — ne relève/crée jamais vers le bas, la progression acquise n'est jamais perdue (ADR 0016, ENGINE §3, PRODUCT §3.6).
- **Validation des mondes** : toggle (auto-filtre seul ↔ approbation parent avant affichage, cf. WORLDGEN).
- **Code de secours parent** : voir / régénérer (cf. AUTH).
- Langue (FR) — grisé, future i18n.

## 4. États & erreurs (UX)

| État | Comportement |
|---|---|
| Chargement | Skeleton + Teddy (petite animation) |
| Pas de réseau au démarrage | Écran « Connecte-toi à internet pour jouer » (cf. SYNC) |
| Coupure réseau en partie | Message doux + pause + retry court ; réponse en cours gardée |
| Monde en génération (buffer pas prêt) | « Je prépare un monde… 🧸 » ou proposer un monde déjà dispo |
| Génération échouée | **Fallback** pré-généré, silencieux (cf. WORLDGEN) |
| Collection vide (début) | Invite douce « Ta collection commence ici ! » |
| PIN faux | Secouage doux + message générique (cf. AUTH) |
| Solde insuffisant (boutique) | « Pas assez de pièces — joue encore un peu ! » |
| 1er lancement | Onboarding → diagnostic déguisé |

## 5. i18n

- **v1 = français uniquement**, mais **toutes les chaînes centralisées** (un fichier de strings, clé → texte) dès le départ → ajouter une langue plus tard = peu d'effort. (Assurance pas chère.)
- Pas de texte en dur dans les composants.

## 6. Plan de playtest (le vrai juge)

**Observer (avec elle)** :
- Comprend-elle l'UI **sans aide** ? Sourit-elle ? Signes de frustration / abandon ?
- **Revient-elle le lendemain ?** (rétention = le vrai juge)

**Calibrer les `⚙️`** (répartis dans les docs) :
- Seuils d'étoiles, seuils de **fluence**, `NEW_MAX`/jour, longueur de niveau, durée de session.
- Prix économie (œuf/boutique/évolution), valeurs de récompense.

**Vérifier la pédagogie** (sur 1-2 semaines) :
- Les calculs ratés **reviennent**-ils plus tôt ?
- Progresse-t-elle sur ses **lacunes ciblées** (ex. 6×7, 8×4, compléments) ?
- La bascule **bloqué → interleaving** se déclenche-t-elle au bon moment ?

**Boucle** : jouer 2-3 sessions → ajuster les `⚙️` → re-tester.

## 7. Décisions verrouillées (ce tour)

| Sujet | Choix |
|---|---|
| Notifications | **Aucune** en v1 |
| TTS | **Reporté** (Web Speech plus tard) ; histoire en beats courts en attendant |
| Temps d'écran | Nudge doux **+ verrou dur optionnel** (parent) |
| i18n | FR seul, **strings centralisées** |
| Réglages | Parent possède l'écran Réglages (PIN, son/musique/volume + le reste) ; l'enfant a un **quick-mute son/musique no-PIN** in-game (ADR 0017, réconcilie PRODUCT §30) |
| Playtest | Boucle observer → calibrer `⚙️` → re-tester |
