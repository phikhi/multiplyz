---
name: Story
about: Une unité livrable (slice verticale)
title: "[story] "
labels: ["story"]
---

## Epic
#<id de l'epic>

## Contexte
_Pourquoi cette story, lien aux specs (PLAN/ENGINE/PRODUCT/…)._

## Critères d'acceptation (testables)
- [ ] Given … When … Then …
- [ ] Given … When … Then …

## Scope
`scope:backend` | `scope:frontend` | `scope:security` | `scope:qa` | `scope:game-design` | `scope:product`

## Definition of Done
- [ ] Lint OK
- [ ] Tests OK (100 % logique critique / pragmatique UI)
- [ ] Type-check + build OK
- [ ] `next-dev-loop` (vérif runtime) OK
- [ ] Captures Playwright dans la PR
- [ ] Critères d'acceptation validés (PO)
- [ ] Reviews agents (scope + PO) approuvées

## Dépendances
`blocked-by:` #…

## Design requis ?
- [ ] `needs-design` (Technical Design / ADR avant code)
