# 4. L'agent orchestrateur est autonome sur le planning (triage, découpage, séquencement)

- **Statut** : accepté
- **Type** : arch
- **Portée** : majeure (décision du propriétaire — délégation d'autorité, 2026-07-01)
- **Liens** : [ADR 0003](./0003-agent-merge-et-accepte-adr.md) (qu'il **étend**) · [WORKFLOW.md](../../WORKFLOW.md) §2/§12/§14/§20 · [CLAUDE.md](../../CLAUDE.md) · skill `orchestrate`

## Contexte
L'ADR 0003 a délégué à l'agent le **merge** et l'**acceptation des ADR** intra-contrat. Restait au propriétaire le **planning** : trier les issues découvertes en cours de route, décider **quand** les développer, **découper les épics** en stories, choisir **quelle story attaquer**, décider **quoi paralléliser**. Le proprio veut lancer une conversation « continue multiplyz » et **ne plus intervenir** sur ces décisions d'ordonnancement — tout en gardant le contrôle du **produit** et du **drift**.

## Décision
L'**agent orchestrateur** est délégataire de l'autorité de **planning/orchestration**, **tant que ça reste DANS LE CONTRAT (specs) — pas de drift**. Au démarrage d'une conversation (« continue multiplyz »), sans solliciter le propriétaire, il :

1. **Synchronise l'état** : `git`/`gh` (branches, PR ouvertes, CI, issues, `LEARNINGS`, mémoire de statut).
2. **Trie le backlog** : classe chaque issue nouvelle/`discovered` en **{bloquant-maintenant, prochain-épic, backlog-hygiène, gate-déploiement}** (cf. WORKFLOW §12/§20) et l'ordonnance en conséquence.
3. **Découpe l'épic** courant en stories GitHub (Epic → Story, critères d'acceptation + DoD) selon l'**ordre de build verrouillé** (CLAUDE.md/PLAN) et les specs du scope.
4. **Choisit** la/les prochaine(s) story(ies) (respect des `blocked-by`) et **décide la parallélisation** (stories à **surfaces disjointes** en //, stories à **surface partagée** séquencées — cf. WORKFLOW §14, LEARNINGS interactions cross-PR).
5. **Exécute la boucle** de chaque story : `story-start` → build (DoD) → `open-pr` → reviewers indépendants (scope + PO) → fixes de consensus in-contract → **merge** (ADR 0003) → `retro` → LEARNINGS. Re-trie le backlog entre les merges.
6. **Clôt l'épic** quand ses stories sont mergées ; enchaîne sur l'épic suivant (ordre de build) et re-découpe.

Le **propriétaire reste l'autorité** : il peut **révoquer** / **reprendre la main** à tout moment, et **arbitrer le drift**.

## Garde-fou anti-drift (SEULE escalade obligatoire au proprio)
Inchangé vs ADR 0003 : l'agent escalade **uniquement** si une décision **touche/contredit l'intention des specs** = drift → sign-off propriétaire requis :
- décisions **verrouillées** [PLAN.md](../../PLAN.md) (modèle de données…) ;
- **pédagogie** [ENGINE.md](../../ENGINE.md) ;
- **économie** (jamais d'argent réel, ne bloque jamais l'apprentissage…) ;
- **sécurité** (PIN, données enfant) ;
- **scope** (ajouter/retirer une compétence du cœur, sortir du périmètre d'un épic).

Hors de ces cas : **jamais de sollicitation**. Le triage/découpage/séquencement/parallélisation qui restent dans le contrat sont pris **en autonomie**. L'agent **rapporte** ses décisions de planning (story choisie + pourquoi, parallélisation, triage) mais **n'attend pas** d'aval.

Toujours **en dur** (jamais relâché) : CI required checks + branch protection `strict`, reviews agents (scope + PO) avant merge. Toujours **interdit** : force-push `main`, lire/écrire les secrets, modifier la branch-protection.

## Alternatives
- **Garder le planning au proprio** → rejeté : goulot explicitement levé (« je ne veux plus intervenir »).
- **Autonomie totale incluant le drift** (l'agent décide+ADR+applique les décisions verrouillées, revue a posteriori) → **rejeté par le proprio** : app enfant, enjeu pédagogie/sécurité/éco réel → le drift reste son ressort (sign-off en amont).

## Conséquences
- **+** Une conversation « continue » avance l'épic de bout en bout sans intervention (triage → découpage → build → merge → rétro).
- **+** Le proprio n'est sollicité que sur le **drift** (rare, à fort enjeu).
- **−** Responsabilité accrue de l'agent à **juger le drift** et à **prioriser** → mitigée par la liste d'escalade + le triage documenté + les reviewers indépendants.
- **Specs** : WORKFLOW.md §20 (nouvelle : boucle d'orchestration autonome + grille de triage) + §12 (triage backlog) + CLAUDE.md §Workflow (pointeur « démarrage = boucle autonome ») mis à jour. Skill `orchestrate` = playbook opérationnel.
- Les gates de qualité (CI, reviews, branch protection) **demeurent** : la délégation porte sur le **planning**, pas sur le relâchement des contrôles.
