# 3. L'agent orchestrateur merge et accepte les ADR (gate = anti-drift)

- **Statut** : accepté
- **Type** : arch
- **Portée** : majeure (décision du propriétaire — délégation d'autorité, 2026-06-29)
- **Liens** : [WORKFLOW.md](../../WORKFLOW.md) §3/§4/§6/§16/§18 · [CLAUDE.md](../../CLAUDE.md) · supersede partiellement le « gate humain » verrouillé en tranche 0

## Contexte
Sur l'epic #1, le **gate humain sur chaque merge** + le **sign-off propriétaire sur chaque ADR majeur** sont devenus un goulot : le proprio cliquait chaque merge et arbitrait chaque décision d'archi, même celles qui restaient strictement dans le contrat des specs. Projet single-tenant famille, dev agentique → le proprio veut accélérer sans perdre le contrôle du **produit** ni du **drift**.

## Décision
L'**agent orchestrateur** est délégataire de deux autorités, **tant que la décision reste DANS LE CONTRAT (specs) — pas de drift** :

1. **Merge** : il merge les PR lui-même (squash + delete-branch) dès que (a) les reviews du scope + **product-owner** sont approuvées, (b) la CI est verte/CLEAN, (c) la branche est à jour. Il rebase la PR suivante et **rapporte** chaque merge au proprio.
2. **ADR** : il **rédige ET accepte** les ADR (mineurs **et** majeurs) en autonomie quand c'est un choix *HOW dans le WHAT établi* (archi, lib qui colle à la stack, refacto, ownership de config, durcissement gates/tests). Un ADR accepté **met à jour la spec canonique**.

Le **propriétaire reste l'autorité** : il peut **révoquer** ou **reprendre la main** à tout moment.

## Garde-fou anti-drift (escalade OBLIGATOIRE au proprio)
Toute décision qui **touche ou contredit l'intention des specs** = drift → **sign-off propriétaire requis** :
- décisions **verrouillées** de [PLAN.md](../../PLAN.md) ;
- **pédagogie** ([ENGINE.md](../../ENGINE.md)) ;
- **économie** (jamais d'argent réel, ne bloque jamais l'apprentissage…) ;
- **sécurité** (PIN, données enfant) ;
- **scope** (ajouter la division, retirer une compétence du cœur, etc.).

Inchangés et **toujours en dur** : CI required checks + branch protection `strict`, reviews agents (scope + PO) obligatoires avant merge. **Toujours interdit** à l'agent : force-push `main`, lire/écrire les secrets, modifier la branch-protection.

## Alternatives
- **Garder le gate humain total** → rejeté : goulot, explicitement levé par le proprio.
- **Agent merge mais tous les ADR au proprio** → rejeté : le proprio a délégué les deux ; seul le **drift** reste son ressort.

## Conséquences
- **+** Vélocité (plus d'attente sur le clic de merge ni sur les ADR intra-contrat).
- **+** Le proprio se concentre sur le **produit** et le **drift**.
- **−** Responsabilité accrue de l'agent à **juger le drift** → mitigée par la liste d'escalade explicite ci-dessus.
- **Specs** : WORKFLOW.md §3/§4/§6/§16/§18 + CLAUDE.md §Workflow mis à jour (le « gate humain » devient « gate anti-drift »).
- Les gates de qualité (CI, reviews, branch protection) **demeurent** : la délégation porte sur le **merge/ADR**, pas sur le relâchement des contrôles.
