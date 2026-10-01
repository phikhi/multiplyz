# TEDDy — créatures intégrées au jeu

Le lot visuel approuvé (« tout est bon », puis « ok go » pour l’intégration) est installé dans la **base familiale active**, sans seed, migration, remplacement ou restauration.

- **41 créatures existantes** : mêmes identifiants, espèces techniques, raretés, pools d’œufs et trois stades. Seuls les noms par défaut, histoires et références d’images changent. Les surnoms personnels restent prioritaires et intacts.
- **6 créatures du pilote** : monde 6 magique actif, uniquement après vérification qu’il est au-delà des mondes réservés par la progression ou une session. Déblocage par le boss précédent inchangé. Catalogue runtime complet, trois âges et descriptions écologiques.
- **141 images de créatures**, dont Friselot ado corrigé, et **3 décors/variante du pilote** copiés à l’identique dans `storage/generated`. Originaux conservés ; tous les arts de Teddy et thèmes du socle inchangés.

L’import est une publication locale du catalogue expressément relu par le propriétaire. Il ne simule aucune QA automatique et ne crée aucun faux job réussi. Les 18 stades du pilote et ses trois assets de monde disposent déjà de contrôles positifs conservés ; le socle renouvelé porte la validation visuelle globale. Worker, garde des mondes déjà ouverts, modération parent et contrôles des prochaines générations restent inchangés.

`scripts/publish-reviewed-renewal.ts` prépare un plan précis ; `--apply` installe les fichiers immuables puis applique la transaction. Les sources/images sont hachées, les lignes d’origine comparées, les modifications limitées à quatre colonnes pour le socle. Toute anomalie familiale annule la transaction. La réexécution est idempotente, y compris après entrée dans le nouveau monde. Aucun appel Gemini ; budget conservé **29,65 € / 40 €**.

Preuves dans `data/teddy-world-pilot/` : `renewal-visual-approval.json`, `renewal-publication-plan.json`, `renewal-publication.json`, `renewal-serving-check.json`, `renewal-preservation-check.json`. La copie SQLite de secours avant import est indiquée dans le reçu ; elle ne remplace jamais la base active.

Vérifications : 4 tests de transaction ciblés (préservation, idempotence, dérive, monde réservé, rollback), test du statut, typage/lint/format. Comparaison indépendante contre la copie cohérente : **25 tables familiales intactes**, 41 identifiants conservés, seuls les quatre champs prévus modifiés ; intégrité SQLite correcte. La vraie route d’images renvoie les **144 PNG exacts**, les références des 47 créatures correspondent aux trois âges approuvés ; référence invalide refusée (404). La préparation rejouée reconnaît l’installation complète. Les thèmes futurs restent calculés à partir du catalogue courant.

Le lancement direct du serveur local a été refusé par l’environnement (`listen EPERM`, port 3217). Aucun nouveau parcours navigateur ni essai enfant n’est revendiqué. Pour ouvrir le résultat, dans le Terminal utilisateur depuis `app/`, sous Node 22 :

```sh
DATABASE_PATH=data/multiplyz.sqlite node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3217
```

Ne pas lancer `pnpm dev` ni les anciennes commandes de génération. Leur vérification de préservation compare logiquement l’ancien catalogue ; employer les nouveaux reçus pour cette livraison. Suite : stabilisation visuelle/runtime sur le serveur familial, puis mise en service. Ancienne couverture, adaptation globale et canari restent différés à cette stabilisation finale. Changements locaux conservés, aucun commit/push/déploiement distant.
