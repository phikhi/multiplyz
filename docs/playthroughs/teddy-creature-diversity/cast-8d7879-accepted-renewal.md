# Six lignées validées, refonte du socle engagée côté outillage

## Accord et état enregistré

L’utilisateur répond **« ok c’est bon aussi »** au bilan complet `8d7879f2-ddca-4953-bfa6-10e5a34185ce`. Cet accord porte sur les six lignées et leurs trois âges. Vrillou, Samarine, Nacélie, Rosélice, Spirélis et Arbélune sont désormais acceptés artistiquement et ont dix-huit verdicts positifs. Conserver ces images ; ne pas relancer leur génération ou leur inspection.

Le bilan réel et la trace confirment les appels 193–210 : dix-huit inspections HTTP 200, `fullValidation:true`. Identité et croissance sont positives sur les douze âges suivants ; milieu et distinction sur les dix-huit images ; visage lisible aux trois âges d’Arbélune. Le nouveau fichier `data/teddy-world-pilot/validated-cast-approval.json` lie l’accord au bilan, à la trace, au marqueur, au brouillon et aux dix-huit PNG par empreintes. Le chargeur recontrôle les verdicts et ces fichiers avant toute utilisation.

**210 appels / 14 € réservés / plafond cumulé 40 € déjà autorisé.** Aucun appel Gemini supplémentaire exécuté par l’agent. Les réservations sont prudentes, ce n’est pas une facture réelle du fournisseur.

La validation de cette faune ne publie pas le monde 6. L’assemblage complet du pilote, ses décors/Teddy et la mise en service restent à finaliser. Les anciennes tentatives et leurs refus restent des archives, distinctes de cet accord final.

## Premier lot : sept bébés du monde 0

L’[inventaire actualisé](renewal-a12556c1-99fd-49b1-b493-7d11d8e6bfb8/plan.json) conserve les correspondances des 41 créatures des mondes 0–5 et les empreintes de leurs arts actuels. Il ne compte plus une seconde fois les évolutions du pilote déjà terminées. Les 41 nouveaux noms sont libres face au catalogue et entre eux. Les six thèmes enregistrés sont conservés, y compris les deux forêts différentes.

Les [fiches du monde 0](renewal-world-0.json) décrivent les trois âges avant de dessiner :

| Créature | Identité et rôle forestier |
| --- | --- |
| Mycélou | Champignon vivant en éventail plissé, recyclage des feuilles |
| Tavelle | Coléoptère fouisseur à six pattes, aération du sol |
| Orsil | Corps en quatre sections et huit coussinets, transport de fibres |
| Pivertin | Oiseau à queue d’appui, refuges dans le bois tendre |
| Fougrette | Fougère vivante qui se déploie, réserve de gouttes |
| Lucéran | Insecte à deux ailes et abdomen lumineux, fleurs nocturnes |
| Tormille | Gardien au corps de tronc creux horizontal, abris du sous-bois |

Ce monde est celui du sous-bois dense et humide. La forêt du monde 4 conservera les berges, saules et mares ouvertes. La croissance prévue développe le corps, les proportions et les structures propres à chaque espèce ; aucune simple pose, recoloration ou tenue ne tient lieu d’évolution.

Pour commencer, depuis `app/` dans le Terminal utilisateur sous Node 22 :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --renewal-0-babies
```

Aperçu du plan sans API, déjà exécuté : `--renewal-0-babies-plan`.

Cette passe produit **sept bébés et sept inspections**, sans évolution ni publication. La comparaison utilise les anciens compagnons à tous leurs âges, les dix-huit arts du pilote accepté et les six autres bébés du lot. Les références historiques servent à détecter les ressemblances en QA ; les nouveaux dessins partent de descriptions anatomiques propres à leur milieu.

Coût de réservation : **1,05 € supplémentaire / 15,05 € cumulé**. Tous les dessins et contrôles de la passe doivent tenir dans le budget avant son lancement. L’accès Gemini reste bloqué pour l’agent ; aucune nouvelle tentative ni contournement, les appels réels sont laissés au Terminal utilisateur comme précédemment.

## Arrêt, conservation et suite

`scripts/worldgen-renewal.ts` ouvre les deux bases en lecture seule et emploie le verrou pilote existant. La recette, le catalogue, les arts historiques, l’accord final et le plafond sont revérifiés avant chaque requête. Les identifiants, espèces, raretés et appartenances au tirage des œufs sont enregistrés pour la future correspondance ; aucune possession, session, évolution ou donnée familiale ne change.

Les fichiers de cette passe sont dans `data/teddy-world-pilot/renewal/0/` : marqueur `babies-started.json`, brouillons après chaque image, diagnostics après chaque inspection et bilan final. Les réponses image brutes et les réservations rejoignent le journal cumulatif existant. La galerie `preview-renewal-0-babies-<run>.html` est actualisée après chaque bébé. Après interruption/refus, conserver ces fichiers et le marqueur : aucune répétition automatique. Une reprise éventuelle réutilisera le travail disponible après diagnostic, elle n’est pas encore une option du CLI.

Seul le lot du monde 0 a ses fiches complètes et sa commande prête. Les mondes 1–5 ont leur proposition et leurs correspondances, mais leurs plans anatomiques détaillés restent à écrire. Les images et la distinction réelle du premier lot seront examinées avant ses évolutions.

La refonte complète prévue représente 123 images, 41 inspections des bébés puis 123 inspections finales : **20,50 € supplémentaires / 34,50 € cumulés**, hors corrections et éventuels autres appels de finalisation du pilote. Marge restante prévisionnelle : 5,50 € sur 40 €.

## Vérification de cette tranche

**16 tests ciblés distincts passent** : accord final et pixels inchangés, conservation des correspondances, génération des bébés, refus de milieu/ressemblance, orchestration HTTP simulée de sept dessins et sept QA, interruptions pendant génération/inspection, checkpoints, absence de retry, plafond cumulé et suivi. Les bases temporaires de ces simulations gardent exactement leurs octets ; aucun test n’utilise la base familiale.

Typage, lint et format passent. Le plan réel sans API vérifie les sources actuelles. Le contrôle de préservation familial confirme **26 tables inchangées et intégrité ok**. Aucun seed/migration/restauration, aucun serveur démarré, aucun nouvel essai familial/WebGL. Les anciens tests, leur adaptation, la couverture globale et le canari restent différés jusqu’à la stabilisation.
