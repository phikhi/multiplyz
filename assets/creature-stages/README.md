# Arts de croissance TEDDy

82 PNG transparents de 768 × 768 : ado et adulte pour les 41 compagnons présents au catalogue familial le 10 septembre 2026. Le bébé est toujours l’illustration originale, passée comme référence à Gemini/Nano Banana. Les couleurs, traits distinctifs et identité sont conservés ; les nouvelles illustrations développent silhouette, proportions et pose. Six planches bébé / ado / adulte sont dans [le dossier de contrôle](../../docs/playthroughs/teddy-evolution/).

## Production et provenance

Moteur choisi explicitement par l’utilisateur : générateur Gemini du projet, `generateImage`, modèle configuré `gemini-2.5-flash-image`. Style de base et exclusions issus d’ART. Aucune utilisation de l’API OpenAI.

`prompts.json` est le **plan final de prompts reproductibles**, avec chemin et empreinte du bébé ; ce n’est pas l’historique exact de chaque appel. La production a commencé sur fond blanc, puis les variantes à renforcer ont été reprises sur fond magenta. Les premières variantes déjà satisfaisantes ont été conservées. Les sources brutes et essais écartés sont conservés localement dans `storage/creature-stages/` et `storage/creature-stages/rejected/`. Les fichiers PNG de ce dossier sont les dérivés finaux à conserver, indépendamment de la disponibilité du fournisseur.

Préparation reproductible depuis les sources brutes : `prepare-creature-stage-cutouts.ts`, puis `normalize-creature-stage-art.py`. Le premier détoure le fond connecté ; le second retire les résidus magenta, normalise le sujet dans 640 × 640 et le centre sur 768 × 768. Le pilote Bulle, déjà publié et utilisé dans les contrôles, conserve exactement ses octets relus. `inspect-creature-stage-art.py` produit les six planches et les mesures alpha/empreintes. Les scripts de préparation sont des outils de production ; leur résultat doit être relu avant une nouvelle publication.

## Publication

`reviewed.json` associe chaque identité et son bébé aux empreintes exactes des deux variantes inspectées. Depuis `app/`, avec Node 22 :

```sh
node --conditions=react-server --import tsx scripts/publish-creature-stages.ts --database=data/UNE_BASE_EXISTANTE.sqlite
```

La commande exige une base existante explicitement nommée. Elle vérifie les empreintes, copie les fichiers dans `public/generated/socle/creature/`, applique les migrations de schéma et ajoute uniquement les références de stades compatibles. Elle n’exécute aucun seed et ne remplace jamais la base. Faire d’abord une sauvegarde SQLite cohérente et une répétition sur copie isolée. Une seconde publication est sans effet sur le catalogue ; un fichier différent sous une référence déjà utilisée est refusé.

Les futurs mondes générés conservent leurs créatures et leur progression. Leur pipeline de production devra fournir des variantes relues avant d’en proposer l’évolution ; aucune liste de six mondes ne limite le moteur d’évolution.
