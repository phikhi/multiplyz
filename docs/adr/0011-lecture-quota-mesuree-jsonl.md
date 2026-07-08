# 0011. Décision quota de l'orchestrateur = mesure locale + réactif au message, jamais un % estimé

- **Statut** : accepted
- **Type** : arch
- **Portée** : majeure (sign-off proprio — modifie la règle d'arrêt/reprise de la boucle autonome, décision verrouillée d'orchestration ADR 0004)
- **Liens** : ADR 0004 (orchestration autonome / planning) · ADR 0003 (agent merge) · skill `orchestrate` §7 · skill `schedule` · outil `.claude/skills/orchestrate/quota-usage.mjs`

## Contexte
L'orchestrateur décide s'il **continue** ou **s'arrête** (et programme une reprise) en fonction du quota. La règle `orchestrate §7` disait : « lire l'**heure exacte de reset** indiquée par le **message de limite d'usage** ; à défaut `now + 5 h` ». Ce message n'apparaît **qu'au mur** (quand la limite est atteinte). **Entre** deux stories, l'orchestrateur n'a **aucun signal de vérité** sur le quota.

Conséquence observée sur des sessions réelles : l'orchestrateur **invente une jauge qu'il ne lit nulle part** et se trompe dans les deux sens.
- **Faux arrêt** : stop décidé alors qu'il restait **> 3 h** avant reset et **~20 %** de conso.
- **Faux démarrage** : story démarrée alors que le quota était à **~77 %** avec **1 h 30** avant renouvellement → risque de branche orpheline coupée au milieu.

**Cause racine** (vérifiée) : aucun fichier local ne contient le **% serveur** ni le **reset** ni le **quota hebdo** (`grep` sur les transcripts = 0 champ `ratelimit`/`resets_at`). Les seuls faits **mesurables localement** sont les **tokens réels par appel** (`message.usage` + `timestamp`) dans `~/.claude/projects/**/*.jsonl`. Toute affirmation « quota à N % » entre deux stories est donc une **hallucination** (piège CLAUDE.md « déclaré ≠ lu » : §7 revendiquait une lecture de quota inexistante).

Deuxième défaut : §7 ne modélisait **que** la fenêtre glissante **5 h**, jamais le **quota hebdomadaire** (Claude Max). Un run reprogrammé à `reset + 5 min` se réveille dans le **même mur hebdo** → run gâché + tokens brûlés + chaîne cassée.

## Décision
La décision de quota s'appuie **uniquement** sur deux signaux honnêtes ; le **%/jauge auto-estimé est proscrit**.

1. **STOP = RÉACTIF, jamais préventif sur jauge devinée.** L'orchestrateur ne s'arrête pour cause de quota **que** lorsque le **message de limite d'usage** se déclenche (seule autorité « coupé + reset »), ou en **fin de scope**. Interdit : « je m'arrête, le quota doit être à ~X % ».

2. **START (garde anti-orphelin) = décision sur MESURE locale**, via le lecteur JSONL maison `.claude/skills/orchestrate/quota-usage.mjs` lancé **à chaque frontière de story** (jamais un chiffre en mémoire/cache). Le lecteur mesure, compte-account (tous les projets), sur `~/.claude/projects/**/*.jsonl` :
   - **tokens du bloc 5 h actif** (découpage gap-based façon ccusage) + **minutes avant reset** (réelles, `blocStart + 5 h`) ;
   - **plafond EMPIRIQUE** = max de tokens observé sur un bloc 5 h **passé** → auto-calibré, **zéro nombre de plan deviné** ;
   - **somme glissante 7 j** (proxy hebdo).
   Verdict de démarrage (⚙️, calibrable) : **HOLD** (finir la story courante, n'en démarrer aucune) si `ratio ≥ START_GUARD_RATIO` (0.85 du max empirique) **ou** `resetsInMin ≤ STORY_WALLCLOCK_MIN` (30 min) ; sinon **GO**.

3. **Modéliser les DEUX fenêtres.** Au message de limite, **parser QUELLE limite** (5-hour vs weekly) et programmer la reprise au **reset de la fenêtre bloquante**, pas systématiquement `+5 h`. Si le mur est **hebdo**, programmer au reset **hebdo** (à défaut d'heure exacte, ne pas re-programmer une reprise qui retomberait dans le mur : `needs-owner`/rapport).

4. **Rapport & checkpoint = chiffre MESURÉ**, jamais un % inventé. Le checkpoint statut logge `usedTokens` / `resetsInMin` / verdict, pas « quota ~N % ».

## Alternatives
- **`ccusage` (dépendance `npx`)** : écarté — dépendance réseau/install (`npx` a échoué offline en test), et il **estime** aussi le % contre le plan. Le lecteur maison est **pur stdlib**, sans install, et n'affirme que du **mesuré**.
- **Continuer à estimer le %** : rejeté — c'est exactement la cause des deux erreurs (jauge hallucinée).
- **Threshold en tokens absolus vs un ceiling de plan** : rejeté — le ceiling exact du plan **n'est pas connu localement** (le deviner reproduit le bug). Le **plafond empirique auto-calibré** (max bloc passé) évite tout nombre deviné.
- **STOP préventif sur budget mesuré** : écarté — même mesuré, le token n'est pas le % serveur exact (cache_read gonfle le total) ; le seul « coupé » fiable reste le message. La mesure sert la garde de **démarrage** + le rapport, pas un stop préventif.

## Conséquences
- (+) Fin des faux arrêts (plus de stop sur jauge devinée) et des faux démarrages (garde de démarrage sur mesure réelle + temps réel avant reset).
- (+) Le quota **hebdo** est explicitement modélisé (proxy 7 j + reprise ciblée sur la fenêtre bloquante).
- (+) Outil **déterministe, testable, sans dépendance** (`--nowMs=` pour rejouer) ; ratio auto-calibré → robuste sans connaître le plan.
- (−) La mesure reste un **proxy** : le % serveur exact et l'ancre de reset hebdo ne sont pas exposés localement → le signal d'autorité « coupé » demeure le **message de limite**. Assumé et documenté dans l'outil (`caveat`).
- (−) `START_GUARD_RATIO` / `STORY_WALLCLOCK_MIN` sont des **⚙️** à calibrer au vécu (valeurs de départ 0.85 / 30 min).
- **Specs mises à jour** : `orchestrate` §7 réécrit (STOP réactif · garde de démarrage sur `quota-usage.mjs` · deux fenêtres · rapport mesuré). Contrat data inchangé (aucune table touchée).
- **Suite** : calibrer les ⚙️ après quelques cycles ; si Anthropic expose un jour le rate-limit en local, brancher le signal d'autorité directement (supersede partiel).
