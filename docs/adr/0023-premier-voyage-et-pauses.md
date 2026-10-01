# ADR 0023 — Le premier voyage et la pause partagent le checkpoint d’aventure

10 septembre 2026 · Retenu pour la tranche TEDDy usage quotidien.

Le diagnostic de l’ancien écran vivait dans la mémoire du navigateur. Un premier voyage interrompu devait donc recommencer, alors que les niveaux TEDDy possédaient déjà une reprise fiable. Le diagnostic initial et le recalibrage deviennent des aventures persistantes : mêmes commandes, révisions, aides et intentions locales que les niveaux.

Les ajouts à `Adventure` sont optionnels dans le JSON de `adventure_sessions` : `diagnostic` (type de voyage et premières réponses), `paused`, `breakOfferedDay`, `restReason`. Les anciennes lignes restent lisibles ; aucune migration SQL, réinitialisation ou copie de base n’est nécessaire. Une aventure active reste prioritaire, même si le parent demande un recalibrage ou si le plafond est atteint entre-temps.

Le serveur reprend `selectDiagnostic`, `diagnosticToQuestions`, `buildSubmission`, `seedDiagnostic` et `seedRecalibration`. Il juge la réponse numérique et conserve la première tentative ; les aides et réessais ne l’améliorent pas artificiellement. L’amorce de maîtrise ou sa fusion monotone est écrite avec le checkpoint final dans la même transaction. Le diagnostic n’écrit ni `attempts`, ni progression, ni portefeuille, ni journal économique. Le paramètre de taille existant est respecté (18 par défaut) ; l’adaptation légère disponible dans le moteur reste hors de ce branchement, comme dans l’ancien parcours.

Pause et reprise sont des commandes idempotentes. L’interface confirme l’arrêt après enregistrement, propose un renvoi accessible à l’intérieur de la boîte de pause si le réseau échoue et retrouve la même question sur un autre appareil authentifié. Une commande restée uniquement dans le stockage local demeure propre au navigateur qui l’a saisie ; il n’existe pas de jeu hors ligne ni de transfert magique d’une intention non reçue.

Le retour quotidien `/reprendre` est une lecture authentifiée : aventure active (ou `/repos` si elle est en pause), rencontre d’œuf, achat ciblé, évolution non acquittée, plafond parental, diagnostic/recalibrage, puis carte. Il ne crée pas de nouvelle dépense. Le raccourci d’accueil n’est affiché que pour une session enfant valide côté serveur ; les autres profils et l’espace parent gardent leurs codes. Les actions d’aventure vérifient aussi le profil attendu par le navigateur.

La fin d’un niveau évalue les réglages parentaux existants. Une suggestion douce apparaît au seuil configuré, une seule fois par jour ; l’enfant peut continuer. Le jour de cette invitation est transmis au prochain checkpoint. Le plafond a priorité et interdit une nouvelle partie jusqu’au lendemain, sans couper la partie active ni perdre ses gains. La décision et le reçu clos sont enregistrés ensemble et ne sont pas recalculés au rejeu.

Le temps conserve la définition du suivi parental existant : amplitude bornée entre les réponses du jour, dans le fuseau configuré, hors diagnostic. Ce n’est pas un chronomètre d’activité : une longue interruption entre deux réponses peut compter dans cette amplitude. Cette limite doit rester visible dans les explications du futur espace parent ; aucun minuteur supplémentaire n’est introduit dans cette tranche.

Sources : [AUTH](../../AUTH.md), [SYNC](../../SYNC.md), [parcours vérifié](../playthroughs/TEDDy-quotidien.md). La refonte de l’espace parent, les décors distincts des mondes et la stabilisation des anciens tests restent des tranches séparées.
