# 0017. Placement des réglages son : le parent possède l'écran, l'enfant a un quick-mute no-PIN

- **Statut** : accepted (arbitrage propriétaire « Option A » sur #277, 2026-07-13)
- **Type** : product (touche une décision **verrouillée** DETAILS §7)
- **Portée** : majeure (sign-off humain — décision verrouillée)
- **Liens** : issue #277 (arbitrage drift) · #256 / PR #276 (story 8.3, contrat data) · #257 (story 8.4, moteur audio) · #282 (story 8.6, quick-mute enfant) · spec(s) impactée(s) : **DETAILS §3, DETAILS §7 l.78**, PRODUCT §1.4/§4

## Contexte

Deux specs canoniques se **contredisent directement** sur *qui* contrôle le son :

| Spec | Dit |
|---|---|
| **DETAILS §3** (« Accès enfant, rapide, sans PIN ») | son on/off, musique on/off (+ volume) **côté enfant** |
| **DETAILS §7 l.78** (table des décisions **VERROUILLÉES**) | « Réglages \| Split enfant (son) / parent (le reste) » |
| **PRODUCT §1.4 l.30** | « Réglages **parent** : son/musique… » |
| **PRODUCT §4 l.121** | « **Contrôles parent** (optionnels) : … couper le son. » |

Le son est le **seul** réglage sans échappatoire « au choix au build ». La story 8.3 (#276) a tranché unilatéralement côté parent (`/parent/reglages`, derrière PIN) en s'appuyant sur une **citation inversée** de §78 (tell #259/#164). Backend / Security / QA ont approuvé le **contrat data** (solide, fidèle) ; game-design + PO ont bloqué le **placement** (drift verrouillé) → escaladé en #277.

## Décision

Le réglage son est **UNE** valeur (`household_settings`, **parent = source de vérité**, PRODUCT §30 / ADR 0013), **surfacée à DEUX endroits** :

1. **Écran Réglages parent** (PIN) — contrôle **complet** : son on/off, musique on/off **+ volume**. Livré en **story 8.3** (#276).
2. **Quick-mute enfant no-PIN** — son on/off + musique on/off (**pas** le volume) accessible **in-game** depuis l'aire enfant, pour préserver l'intention **verrouillée** DETAILS §3 (« muter vite dans une pièce calme, sans PIN »). Livré **avec/avant la story 8.4** (moteur audio) — **story 8.6** (#282).

Les deux surfaces écrivent la **même** ligne `household_settings` (`writeHouseholdSettings`, source de vérité unique — aucun doublon d'état).

## Alternatives

- **Option B — honorer strictement DETAILS §7** (toute l'UI son dans une surface enfant no-PIN). *Écartée* : re-scope l'UI de 8.3 déjà livrée + éloigne le volume et les réglages fins du parent, alors que PRODUCT §30 pose le parent comme source de vérité. Contredit PRODUCT.
- **Option C — différer toute l'UI à 8.4** (merger seulement le contrat data). *Écartée* : le contrat data de 8.3 est **solide et validé** (3 APPROVE), et l'écran parent est **correct sous Option A** — le jeter serait du gâchis. On merge le contrat + l'écran parent maintenant, on ajoute le quick-mute enfant en 8.6.

## Conséquences

- **DETAILS §7 l.78** mis à jour : « Parent possède l'écran Réglages (PIN, son/musique/volume + le reste) ; l'enfant a un **quick-mute son/musique no-PIN** in-game (ADR 0017) ».
- **DETAILS §3** mis à jour : accès enfant no-PIN = **quick-mute** son/musique on/off (le **volume** et les réglages complets vivent côté parent).
- **PRODUCT §1.4/§4** : parent contrôle le son (inchangé) + **renvoi** au quick-mute enfant (ADR 0017).
- **PR #276 (8.3) débloquée** : mergeable après (a) fix registre `fr.ts` (vouvoiement de `soundHint`/`musicHint`), (b) correction des citations « accès enfant sans PIN » / §78 → référencer cet ADR (le placement parent est **canonique**, plus « intérimaire »).
- **Story 8.6 (#282)** planifiée **avant clôture de l'épic #8** (anti-#180 : la valeur « l'enfant peut muter » doit réellement atteindre l'enfant, pas rester un mécanisme parent-only).
- **Story 8.4 (#257)** reste `blocked-by` 8.3 ; le quick-mute enfant se livre **avec/avant** 8.4 (l'effet réel de mute dépend du moteur audio).
- Le **contrat data** (schéma + migration 0015 + validation `[0,100]` + config ⚙️) est **inchangé** — Option A ne le touche pas.
