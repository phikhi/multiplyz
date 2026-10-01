# Scène TEDDy

`world.js` reprend le pilote « Le passage des lucioles » validé le 10 septembre 2026 (`TEDDy/.design/multiplyz-feerique/niveau-pilote/world.js`). Le décor, Teddy et Lumo sont conservés.

Adaptations d’intégration : module ES, import local de Three.js, total de questions variable, retrait du canvas au démontage. `createTeddyForest(root)` expose seulement `setState({ phase, completed, total, paused, reduced })` et `dispose()`.

`three.module.min.js` est le bundle Three.js r169 déjà utilisé dans le prototype. Licence MIT : `THREE-LICENSE.txt`. Aucun téléchargement au runtime. Le wrapper React est `src/components/game/ForestScene.tsx`.

Le modèle reste procédural. La validation artistique ne vaut pas mesure de fluidité sur tous les ordinateurs.
