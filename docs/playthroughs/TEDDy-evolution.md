# TEDDy — évolution cosmétique et vrais arts de stades

10 septembre 2026. Tranche livrée localement dans `app/`, branche `feat/teddy-first-slice`, techniquement vérifiée. **Essai utilisateur à venir**, comme pour boutique/œufs et achat ciblé avec éclats. La direction artistique et les deux premières tranches conservent leur validation acquise.

## Parcours livré

Collection → fiche d’un compagnon → **Faire grandir mon compagnon**. La page montre les deux véritables illustrations, le prochain stade, le coût et le solde restant. La confirmation dépense les tarifs configurés : **40 éclats pour ado, puis 100 pour adulte**. Le retour affiche le nouveau stade sur la fiche et dans l’album. Le manque d’éclats laisse le compagnon tel quel et permet de reprendre le chemin.

Les 41 compagnons du catalogue actuel ont leurs **82 nouvelles illustrations ado/adulte**, générées avec le **Gemini/Nano Banana du projet**, choix explicite de l’utilisateur. Chaque génération utilise le bébé original comme référence. Silhouettes, proportions et poses changent ; couleurs et signes distinctifs conservent l’identité. Les originaux bébé sont intacts. Les six planches sont inspectées sur fond sombre ; les restes de fond magenta ont été corrigés avant publication. [Production, plan de prompts et manifeste des fichiers relus](../../assets/creature-stages/README.md).

| Univers | Bébé → ado → adulte |
| --- | --- |
| 0 | [Planche](teddy-evolution/art-world-0.png) |
| 1 | [Planche](teddy-evolution/art-world-1.png) |
| 2 | [Planche](teddy-evolution/art-world-2.png) |
| 3 | [Planche](teddy-evolution/art-world-3.png) |
| 4 | [Planche](teddy-evolution/art-world-4.png) |
| 5 | [Planche](teddy-evolution/art-world-5.png) |

Nom choisi, histoire, quantité et date d’acquisition restent identiques. L’évolution n’apporte aucun avantage pédagogique ou économique. Les légendaires déjà acquises peuvent grandir. Les nouveaux mondes générés suivent le même contrat lorsqu’ils possèdent leurs variantes publiées ; leurs thèmes, créatures et progression restent préservés. La diversité des futurs décors reste un chantier confirmé, distinct de cette livraison.

## Reprise et contrôles techniques

[ADR 0022](../adr/0022-evolution-cosmetique-persistante.md) : transaction SQLite `immediate`, `debitWalletInTx`, modification du stade et reçu persistant ensemble. La clé profil / compagnon / stade d’origine restitue la même transition à chaque rejeu. L’acquittement est lui aussi reprenable, et une session d’un autre profil ne peut dépenser dans le portefeuille initial. Le chargement du nouvel art précède la possibilité de confirmer ; un art absent ou identique est refusé.

**70 nouveaux tests**, **128 contrôles ciblés réussis** : évolution 30, actions 20, écran 13, publication 7 ; collection 33, album 4, reçus d’œufs 7 et achat ciblé 14. Cas contrôlés : prix configurés, propriété, entrées client falsifiées, solde insuffisant, art manquant, catalogue incomplet, légendaires et monde généré, rejeu après acquittement et après stade adulte, identité conservée, refus sans débit, chargement des images et panne d’écriture.

Les trois gardes d’annulation après débit échouent effectivement lorsque la transaction est retirée expérimentalement ; source restaurée, les 30 tests du module repassent. [Trace de mutation](teddy-evolution/transaction-mutation.txt). TypeScript, lint ciblé et format ciblé passent ; build production webpack réussi. Drizzle régénéré sans changement de schéma supplémentaire. **Suite globale, couverture globale et ancien canari non relancés ni adaptés** : ils attendent la stabilisation finale, gates inchangés.

## Jeu réel sur base isolée

`data/teddy-evolution-check.sqlite` continue, par SQLite backup, le parcours `teddy-shards-check.sqlite`. Aucune écriture de seed ni injection de progression/récompense durant ce parcours. Le navigateur gagne **145 éclats** en jouant **30 niveaux, 99 calculs**, et en ouvrant **20 œufs supplémentaires**. Certains niveaux ont moins de dix questions selon le moteur et les faits éligibles existants ; ce comportement pédagogique n’est pas modifié.

Bulle passe bébé → ado pour 40, puis ado → adulte pour 100. Il reste **5 éclats**, avec exactement deux dépenses d’évolution. Réponses d’achat et d’acquittement perdues, fermeture et réouverture, double clic et second navigateur sont exercés. Une ancienne intention du second navigateur reprend encore le même reçu après acquittement dans le premier. Nom, quantité, date et identifiant de possession restent identiques.

Le premier passage a révélé un bouton bloqué quand l’image avait fini de charger avant l’hydratation React. Le composant vérifie désormais aussi `complete` et `naturalWidth` à son montage ; un test garde ce cas. La continuation ado → adulte a été rejouée avec succès sur le build corrigé, en conservant la progression déjà jouée.

`scripts/check-teddy-evolution.mjs` conserve cette **continuation depuis le stade ado et sa première dépense**, pas un seed de démarrage. La base de contrôle livrée est maintenant adulte : ne pas la remettre artificiellement au stade ado pour relancer le script. Son mode `--inspect-catalogue` reste utilisable sans dépense ; il a vérifié les **82 réponses HTTP, leurs empreintes et leur décodage 768 × 768**, ainsi que l’aperçu d’une légendaire réellement possédée. [Preuve du parcours](teddy-evolution/verification.json), [livraison des arts](teddy-evolution/catalogue-delivery.json).

Captures et géométrie vérifiées de **1280 à 320 px**, mouvement réduit, cibles d’au moins 44 px, aucun débordement horizontal ni `pageerror`, focus clavier visible. Même art sur reçu, fiche et album : [confirmation adulte](teddy-evolution/adult-preview-1280.png), [rencontre mobile](teddy-evolution/adult-320.png), [fiche](teddy-evolution/03-adult-detail.png), [album](teddy-evolution/04-adult-album.png), [légendaire](teddy-evolution/legendary-preview-1280.png), [focus](teddy-evolution/keyboard-focus.png).

## Données familiales et aperçu

Base active conservée : **`data/multiplyz.sqlite`**, jamais remplacée ni seedée. Sauvegarde cohérente préalable : `data/backups/teddy-before-evolution-20260910T184846Z.sqlite`, SHA-256 `c1ef6306c06d683978ac3a0978fe097c21f896bf519ef0099807b9f4f3f074cd`.

La publication a d’abord été répétée sur une copie isolée, puis appliquée à la base active. **Les 23 autres tables applicatives préexistantes restent strictement identiques** ; les 41 identités du catalogue sont identiques. Seuls `max_stage` et `art_ref_stages` reçoivent les nouveaux stades. `evolution_receipts` est vide dans la base familiale : aucun compagnon familial n’a été fait grandir pour les contrôles. L’entrée de migration Drizzle est ajoutée ; intégrité `ok`. [Comparaison familiale](teddy-evolution/data-preservation.json), [répétition sur copie](teddy-evolution/migration-rehearsal.json).

Aperçu familial : **http://127.0.0.1:3217**. Depuis `app/`, Node 22, démarrage direct sans seed :

```sh
DATABASE_PATH=data/multiplyz.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

Les changements antérieurs et nouveaux restent locaux, sans commit, PR, merge ou déploiement. Suite convenue : **usage quotidien → espace parent → mondes réellement différents → stabilisation et mise en service familiale**.
