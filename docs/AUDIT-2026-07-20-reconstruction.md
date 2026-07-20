# multiplyz — Audit spec-complet + Plan de reconstruction
**Date : 2026-07-20** · base `main` `4cdc225` · méthode : 9 audits parallèles (spec × code × base réelle `data/multiplyz.sqlite` × captures), lecture seule, sans complaisance.

---

## 0. TL;DR

Le projet n'est **pas** « 8 épics clos = jeu fini ». C'est un **socle d'ingénierie excellent, sans le jeu par-dessus**.

- **Le CŒUR est solide** : moteur pédagogique (le meilleur module), auth/sécurité, PWA/offline, réglages, dashboard parent, data model, économie *earn*. Tout ça est fidèle aux specs et réellement câblé.
- **Le JEU manque** : l'enfant qui joue normalement **ne voit jamais** la carte, les mondes, Teddy, le boss (navigation cassée) ; **aucune illustration** n'atteint l'écran (le vrai art existe mais n'est ni déployé ni consommé — les reviews ont validé un **fixture de test**) ; **les créatures sont des emoji placeholder** jamais générés ; **toute l'économie de dépense** (œufs, boutique, évolution) est **absente** (ni data, ni logique, ni UI).
- **Cause racine** = 3 défaillances de pilotage, pas des bugs. Détail §4.

**Recommandation** : arrêter le hardening, ouvrir un chantier **reconstruction produit** en tranches verticales **jouées par un humain sur le vrai art avant merge**. Plan §5.

---

## 1. Ce qui est SOLIDE — à garder tel quel

| Domaine | Verdict | Preuve |
|---|---|---|
| **Moteur pédagogique (ENGINE)** | **Excellent, fidèle, joué à l'écran** | diagnostic + Leitner/fluence + sélection (`buildLevel`) + distracteurs typiques + **étayages visuels réels** (`TenFrame`/`NumberLine`/`Matrix` avant révélation) + boss/légendaire en transaction atomique. `src/lib/engine/*` câblé bout-en-bout à `PlayScreen`. |
| **Auth / sécurité** | **Au-dessus du niveau familial** | argon2id (params OWASP), rate-limit profil+IP, anti-énumération temporelle, sessions serveur, CAS anti-TOCTOU sur reset PIN, cascade RGPD, garde no-PIN patch-littéral. Aucun TODO résiduel. |
| **Sync online-first** | **Réel (idempotence + monotonie prouvées)** | clés de rejeu serveur-dérivées, index UNIQUE défense-en-profondeur, progression non-régressive. |
| **PWA / offline** | **Vraie PWA installable** | manifest + SW custom, coquille offline prouvée E2E réseau réel. |
| **Réglages (enfant + parent) / verrou temps-écran / états UX / i18n** | **Réels et complets** | quick-mute no-PIN, réglages parent complets, `OfflineBanner`, skeletons, `fr.ts` (0 texte en dur), pluralisation correcte. |
| **Moteur son** | **Câblé** (assets placeholder) | `sound/engine.ts` déclenché aux bons moments ; assets = bips synthétiques (#287). |
| **Dashboard parent** | **Bien construit** | justesse/rapidité/maîtrise/à-revoir/régularité/progression/validation-mondes/profils. |
| **Data model + migrations** | **Cohérent, propre** | toutes les tables cœur du PLAN ; 16 migrations sans drift ; règle `NOT NULL`+default respectée. |
| **Économie — côté EARN** | **Réel, câblé** | pièces gagnées en fin de niveau (base+étoiles+bonus), `wallet`/`ledger`, légendaire boss garantie. |

**Conséquence pour le plan : la reconstruction ne touche presque pas ce socle. Elle construit le JEU autour.**

---

## 2. Ce qui MANQUE ou est CASSÉ — le périmètre de reconstruction

### A. 🔴 Navigation & shell — CASSÉ (structurel, priorité 1)
- Login → `router.push("/jouer")` : l'enfant atterrit **direct en jeu**, jamais sur la carte.
- « Continuer » après résultats → recharge le niveau suivant dans `/jouer`, **ne revient jamais à la carte**.
- `/carte` ↔ `/collection` = **île fermée**, jamais entrée par le flux réel → **la carte, les mondes thématisés, l'avatar Teddy, le boss, les étoiles sont invisibles en usage normal.**
- **Aucun shell/nav partagé** : pas de barre persistante (pièces/éclats/⚙️/profil) ; chaque écran redéfinit son bouton logout.

### B. 🔴 Art dans le produit — MANQUANT (priorité 1, transverse)
- Le vrai art kawaii **existe** (`public/generated/socle/` : 6 mondes + Teddy stylisé, approuvé #181) mais est **gitignoré, jamais déployé, jamais dans les captures**.
- Les **captures de review committées** montrent un **fixture de test** (fond rayé violet/orange `world/e2e/background.png`, teddy = carré doré) → **toutes les reviews « pixels validés » ont regardé un fixture, pas l'art.**
- `CollectionScreen` appelle `CreaturePlaceholder` **inconditionnellement**, ne lit **jamais** `artRef` → même si l'art existait, rien ne l'afficherait (piège #125/#180 raté sur la collection).
- Écrans jeu/résultats = cartes blanches, étoiles Unicode, **0 illustration**.
- **Icône d'app** = carré violet uni (pas de Teddy).

### C. 🔴 Teddy dans le jeu — ABSENT
- 0 référence dans `PlayScreen`/`FeedbackPanel`/`ResultsScreen`. Seul avatar = nœud courant de la carte (jamais atteint + pas rendu dans les captures). Ailleurs = emoji 🧸. Les ~80 « Teddy » du code = *ton d'écriture* (COPY), pas un personnage.

### D. 🔴 Créatures — PLACEHOLDER + jamais générées
- Collection = 100% médaillon 🐾. `characters` = 5 légendaires `placeholder://legendary/N`. Communes/rares (6-8/monde) **jamais générées** (`worlds`=0 ligne, `jobs`=0). Le socle ne génère aucune créature. **Seul moyen d'obtenir une créature = boss (et elle est placeholder).**

### E. 🔴 Économie — côté SPEND ENTIÈREMENT ABSENT
- Œufs/gacha, boutique éclats, doublon→éclats, évolution, cosmétiques, coffre quotidien : **ni tables (`cosmetics`/`inventory_items`/`daily`), ni logique, ni UI.** Config éco = uniquement les gains. Les pièces s'accumulent **sans but** ; les `shards` ne sont jamais crédités ni dépensés. Différé à la clôture épic #5, **jamais re-trié** (issue #269 ouverte).

### F. 🟠 Contenu (owner-gaté)
- Sons = placeholders synthétiques (#287, `needs-owner`). Art créatures = à générer. Icône app réelle = à faire.

### G. 🟡 Gaps mineurs (tracés, non bloquants)
- Créer un 2ᵉ profil (frère/sœur) : `createProfileAction` manquant (DETAILS §3 v1).
- Régénérer le code de secours depuis Réglages (aujourd'hui seulement via flow « PIN oublié »).
- **Sync §3 « file de retry courte » non câblée** : `submit/finishLevel` en fire-and-forget → une coupure réseau perd une tentative, pas de reprise auto (**gap non-tracé — à filer**).
- `response_ms` fourni client, non mesuré serveur (#83, choix v1 assumé).
- Palier interleaving « 4 compétences » structurellement inatteignable (calibration).
- Domaine `sub` déséquilibré (210 faits vs ~55/9) — dette calibration.
- `#47` X-Real-IP (config Forge) : rate-limit IP dégradé sans lui.
- Verrou temps-écran : un commentaire de schéma « stocké seulement » semble **périmé** (le code `screen-time-lock.ts` l'applique) — à confirmer.

### Pipeline dynamique worldgen (owner/ops-gaté, secondaire)
Construit mais **dormant** : worker daemon = code jamais lancé comme process (gate #47/#9), classifieur vision **fail-closed non branché** (#174). Les 6 mondes socle suffisent pour jouer ; le dynamique = longévité « sans fin ». **Non prioritaire.**

---

## 3. La nuance honnête
Le squelette **tourne** techniquement (une base de dev « Zoé » a 250 tentatives sur le loop nu). Ça prouve que le **cœur** marche — pas qu'il y ait un **jeu fini**. Sur le vrai art + la vraie nav + l'économie, rien de tout ça n'a été assemblé ni vu.

---

## 4. Les 3 défaillances de PROCESS (cause racine — à corriger AVANT de reconstruire)
1. **« Assembler en jeu cohérent » n'a jamais été une story.** Le pilotage ticket-par-ticket a livré des écrans isolés jamais reliés en parcours.
2. **La « vérif pixels obligatoire » (DoD) validait un fixture de test, pas le vrai art.** Personne (reviewers, PO, ni moi cette session) n'a jamais vu ce que l'enfant verrait. → **Le DoD doit exiger le rendu sur le vrai art + un humain qui joue la tranche.**
3. **Les épics différés ne sont jamais re-triés** (« Phase 2 économie » oubliée depuis l'épic #5). → **Tout différé = issue `needs-owner`/`epic` datée, re-triée à chaque clôture d'épic.**

C'est le piège #180 (« déclaré ≠ vécu ») **à l'échelle du projet entier**.

---

## 5. PLAN DE RECONSTRUCTION (épics → stories, ordonné)

**Principe directeur** : chaque tranche est **verticale** (traverse data→logique→écran→art) et **jouée par un humain sur le vrai art avant merge**. On rend d'abord VISIBLE et NAVIGABLE l'excellent socle existant, puis on ajoute le contenu (créatures, économie).

### Épic R0 — Vérité visuelle + **Conformité bout-en-bout** *(EN PREMIER — le méta-correctif)*
Sans ça, tout le reste se re-review à l'aveugle **et** on reproduit le défaut de pilotage. Cet épic corrige **la façon de travailler**, pas juste une feature.

- **R0.1** Servir/committer un **vrai monde d'exemple** (monter les assets socle dans un chemin non-gitignoré de dev/CI, ou une version échantillon) → dev + captures montrent le VRAI art, fin du fixture rayé.
- **R0.2 — Correctif de WORKFLOW (le point demandé par le proprio) : Definition of Done au niveau FEATURE, pas ticket.** Le défaut racine = des tickets verts unitairement sans que la feature soit vérifiée conforme **bout-en-bout pour l'enfant**. On institutionnalise, dans `WORKFLOW.md` + `CLAUDE.md` + skill `orchestrate` :
  1. **Tranches verticales only** : aucune story ne merge si son effet n'est pas **observable dans l'app qui tourne** (pas juste testé unitairement).
  2. **Captures = vrai art obligatoire** (jamais un fixture) — DoD dur.
  3. **🔑 Gate « Parcours d'acceptation bout-en-bout » (NOUVEAU, par FEATURE/épic)** : à la clôture de chaque feature/épic, un agent (ou le proprio) **PILOTE le vrai parcours utilisateur dans un vrai navigateur sur les vrais assets**, en suivant le flow de la spec comme l'enfant, et produit un **playthrough narré (captures + verdict)** confirmant que la feature est **conforme bout-en-bout et atteint l'enfant**. **game-design + PO signent le PLAYTHROUGH, pas les tickets.** Distinct de la review story-level.
  4. **Canari « état jouable »** : un **E2E full-loop** (login→carte→niveau→récompense→créature→collection) sur le vrai art, maintenu vert — la sonde que le jeu *assemblé* marche.
  5. **Gate #180 rendu EXÉCUTABLE** : la règle CLAUDE.md « la valeur produit centrale atteint-elle l'enfant bout-en-bout ? » (qui existait mais n'était jamais un gate) devient un **artefact obligatoire** (le playthrough R0.2.3) à chaque clôture d'épic.
- **R0.3** Re-générer les captures de référence des écrans existants sur le vrai art (constat honnête de l'état visuel réel actuel).
- **R0.4** Écrire le **premier parcours d'acceptation bout-en-bout** de l'état actuel (baseline) — sert de gabarit réutilisable pour tous les épics suivants.

### Épic R1 — Parcours jouable + shell d'app *(priorité 1)*
Rendre le socle existant réellement vécu par l'enfant.
- **R1.1** **App shell** : layout partagé avec barre persistante (solde pièces/éclats, ⚙️, profil), remplaçant les logout dupliqués.
- **R1.2** **Câbler le vrai flux** : login → **carte (hub)** ; fin de niveau « Continuer » → **retour carte** (pas boucle `/jouer`). La carte devient le hub que la spec décrit.
- **R1.3** Rendre les **mondes/Teddy/boss réellement affichés** sur la carte dans le flux normal (consommer les assets socle, pas le fixture).
- **R1.4** (option) Beat d'intro de monde (« Aide Teddy… ») — différé par la spec, à cadrer.

### Épic R2 — Teddy + art dans les écrans *(priorité 2)*
- **R2.1** `CollectionScreen` **consomme `artRef`** (rendre le vrai art créature quand il existe, placeholder sinon — proprement gardé).
- **R2.2** **Présence de Teddy dans la boucle de jeu** (accueil/feedback/résultats) — guide/mascotte visible, pas juste une voix.
- **R2.3** **Icône d'app réelle** (Teddy) + splash.

### Épic R3 — Créatures réelles *(priorité 2)*
- **R3.1** **CÂBLER le pipeline de génération d'art créatures** (décision proprio : câblé, pas owner-run manuel) → un chemin runnable (agent-cablé, clé image fournie à l'exécution) qui génère l'art des créatures des 6 mondes socle, remplace les 5 légendaires placeholder + peuple communes/rares dans `characters` avec de vrais `artRef`.
- **R3.2** **Fiche créature** (détail + histoire) — écran manquant (WIREFRAMES §5b).

### Épic R4 — Économie de dépense (Phase 2) *(priorité 2, le gros morceau)*
Donne un but aux pièces et fait grandir la collection.
- **R4.1** Data : tables `cosmetics`/`cosmetics_owned`/`inventory_items`/`daily` + config éco (prix/odds/pitié).
- **R4.2** **Œufs / gacha** : achat en pièces, tirage (communes/rares), pitié anti-malchance, doublon→éclats.
- **R4.3** **Boutique** (écran #269) : achat créature ciblée en éclats.
- **R4.4** **Évolution** (bébé→ado→adulte) en éclats (colonnes DB déjà prêtes).
- **R4.5** (option) Coffre quotidien, cosmétiques, booster.

### Épic R5 — Contenu + finition
- **R5.1** Sons kid-safe réels (#287, owner curation).
- **R5.2** Gaps mineurs §2.G : créer 2ᵉ profil, régén code secours, **file de retry sync**, calibrations (interleaving, domaine `sub`).

### Voie OPS — **REPOUSSÉE** (décision proprio : « on n'est pas encore au stade de deploy, on verra après »)
- Déployer le **worker daemon** (#47 X-Real-IP + #9 backup) → mondes dynamiques au-delà des 6 socle.
- Brancher le **classifieur vision** réel (#174) → QA du pipeline dynamique.
- **Repoussé après la reconstruction produit.** Les 6 mondes socle + l'art créatures câblé (R3.1) suffisent pour un jeu complet et jouable sans déploiement.

---

## 6. Séquencement recommandé + décisions attendues de toi

**Ordre proposé** : **R0 → R1** (rendre l'excellent socle VISIBLE + NAVIGABLE — tu verras enfin le jeu comme ta fille) → **R2 + R3** (Teddy + créatures = l'âme) → **R4** (économie = la boucle « sans fin »). R5 + OPS en parallèle/fin.

**Décisions du proprio (2026-07-20) — VALIDÉES :**
1. ✅ **Plan + ordre validés.** + Ajout demandé : élever le **correctif de workflow** (conformité bout-en-bout par feature) en livrable de 1er plan → intégré en **R0.2** (Definition of Done au niveau feature + gate « parcours d'acceptation »).
2. ✅ **Câbler le pipeline** d'art créatures (R3.1 mis à jour : câblé, pas owner-run manuel).
3. ✅ **Deploy repoussé** (« on verra après ») → voie OPS après la reconstruction.

**Prochaine action orchestrateur** : poser la structure GitHub (épics R0-R5) + démarrer **R0** (vérité visuelle + correctif de workflow), avec le nouveau DoD dès la 1ʳᵉ story.

---

*Ce document est un état des lieux au 2026-07-20. Une fois la direction validée, chaque épic Rn est découpé en stories GitHub avec critères d'acceptation + le DoD corrigé (vrai art + humain qui joue).*
