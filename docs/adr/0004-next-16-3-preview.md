# 0004. Pinned Next.js 16.3.0-preview.5 en attendant le stable 16.3

- **Statut** : accepted
- **Type** : deps
- **Portée** : mineure (architect-review autonome)
- **Liens** : issue #24 · PR #27 · STACK.md

## Contexte

Le skill `next-dev-loop` (gate DoD obligatoire, WORKFLOW §5) exige Next.js ≥ 16.3
pour exposer le endpoint `/_next/mcp` avec `get_compilation_issues` (Turbopack).
Projet en 16.2.9 au moment de la story #24 → next-dev-loop bloqué pour toutes les
stories de l'epic.

La version 16.3.0 **stable** n'est pas encore publiée sur npm au 2026-06-29
(`dist-tag latest = 16.2.9`). Seules les versions pre-release existent dans la
série 16.3.x :

- `canary` : builds quotidiens/hebdo, instabilité assumée
- `preview` : release candidates ("preview.N"), plus stables que les canary

## Décision

Pinner `next@16.3.0-preview.5` et `eslint-config-next@16.3.0-preview.5`
(versions identiques publiées sur npm, dist-tag `preview`).

Engagement explicite : **migrer vers `next@16.3.0` stable** dès sa publication sur
npm (vérifier régulièrement `npm dist-tags next`, story de maintenance courte).

## Alternatives

| Option | Raison du rejet |
|---|---|
| Rester en 16.2.9 | `/_next/mcp` indisponible → next-dev-loop bloqué indéfiniment |
| Passer en 16.3.0-canary.70 | Canary = build quotidien non stabilisé, risque plus élevé |
| Passer en Next.js 15.3.9 (dernier stable 15.x) | Downgrade impossible (projet initialisé en 16.x) ; risque de régressions et perte de nouvelles features 16.x |
| Attendre le stable 16.3 | Bloque toutes les stories suivantes, coût d'opportunité élevé |

## Conséquences

**Positifs**
- `/_next/mcp` opérationnel : next-dev-loop débloqué pour l'ensemble de l'epic
- `preview.5` est la version la plus stable de la série 16.3.x disponible
- Toutes les gates CI (format / lint / typecheck / coverage 100 % / build / e2e) passent sans modification
- App familiale perso, pas de SLA public → risque lié au preview acceptable

**Négatifs / vigilance**
- `preview` n'est pas une release stable ; bugs potentiels non encore corrigés
- La migration vers le stable 16.3.x devra être effectuée dès parution
  (story de maintenance, aucune regression attendue : la diff devrait être minimale)
- Dépendance `@playwright/test` passée de `^1.49.0` à `^1.51.1` (peer dep Next 16.3)

**Specs à mettre à jour** : STACK.md (version Next.js, note preview → stable à suivre).
