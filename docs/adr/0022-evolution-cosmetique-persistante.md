# ADR 0022 — Une seule évolution par compagnon et par stade

10 septembre 2026 · Accepté dans la tranche TEDDy évolution.

Une évolution est une transition irréversible de la possession : pour un profil et un compagnon donnés, bébé → ado ne peut se produire qu’une fois. Le reçu utilise donc la clé canonique `[profileId, characterId, fromStage]`, plutôt qu’un identifiant arbitraire par clic. Deux appareils ou un ancien onglet retrouvent ainsi la même transition, y compris après acquittement ou passage au stade suivant, sans nouveau débit.

La migration additive `0021_teddy_evolution_receipts.sql` conserve le prix, les arts avant/après et le solde historique de la transition. La transaction SQLite `immediate` vérifie la possession et le consentement (stade, tarif et art proposé), appelle `debitWalletInTx`, change seulement `collection.stage`, puis inscrit le reçu. Une panne de journal, de possession ou de reçu annule tout. Le stade suivant attend l’acquittement du précédent ; le navigateur garde son intention par profil et compagnon avant l’envoi, puis reprend achat ou acquittement après une réponse perdue. La session serveur interdit tout rejeu sur un autre profil.

Les prix configurés sont de 40 puis 100 éclats, indépendamment de la rareté. Les légendaires déjà acquises peuvent grandir. Nom choisi, identité, date d’acquisition, quantité, monde et pédagogie restent inchangés. Un nouveau monde généré suit le même contrat ; il devient évolutif seulement lorsqu’il possède de vrais arts de stades publiés.

La publication artistique est explicite et séparée des seeds : elle vérifie l’empreinte du bébé et des fichiers relus, ajoute les références ado/adulte et `max_stage=3` seulement aux entrées correspondant exactement au catalogue d’origine (`max_stage=1`, aucun art de stade). Elle conserve les variantes personnalisées et ne crée aucun compagnon. Les originaux bébé restent intacts. Les références publiées sont immuables : un remplacement sous la même URL est refusé, afin que le consentement et les reçus continuent de désigner les mêmes images.

Sources canoniques : [ECONOMY §4.4](../../ECONOMY.md#44-évolution-éclats), [ART §9](../../ART.md#9-évolution-cosmétique--teddy), [parcours vérifié](../playthroughs/TEDDy-evolution.md).
