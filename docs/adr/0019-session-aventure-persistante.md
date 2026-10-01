# 0019. Une session d’aventure persistée, avec une cible fixe

- **Statut** : accepted — réalisation de la tranche demandée le 10 septembre 2026.
- **Type** : data / arch.
- **Références** : SYNC.md ; moteur ENGINE.md ; brief et prototype TEDDy validés dans le dossier voisin `.design/multiplyz-feerique/`.

Une session conserve côté serveur les questions effectivement composées par le moteur, le monde et le niveau visés, la première tentative, l’étape d’aide et le reçu final. Résoudre de nouveau le « niveau courant » au renvoi d’une fin de niveau pouvait créditer le nœud suivant. L’identifiant de session et sa révision fixent désormais la portée d’une commande : un renvoi restitue le dernier état confirmé ; une commande d’une ancienne session ne termine jamais une nouvelle étape.

`adventure_sessions` possède une ligne par profil, supprimée avec celui-ci. Son état JSON contient une petite liste de questions et une machine d’état bornée ; les tentatives, la maîtrise, la progression et l’économie conservent leurs tables et services existants. Ce choix évite une seconde reconstruction pédagogique depuis un historique d’événements. Il impose de migrer explicitement les checkpoints lors d’une future modification incompatible de leur format.

Tentative, maîtrise et checkpoint sont atomiques. À la dernière question, progression, portefeuille, journal et reçu le sont aussi. La rencontre et les gains ne s’affichent qu’après confirmation. Le reçu reste consultable jusqu’à son acquittement (retour au chemin ou visite du compagnon) ; le prochain démarrage peut alors remplacer la session close. L’ancien endpoint recevant simplement des étoiles ne réalise plus d’écriture.

Le client garde uniquement une intention en attente (clé par profil), ainsi que la saisie et le temps actif de la question. Il la renvoie au retour du réseau ou à la réouverture. Aucune partie hors ligne ni maîtrise locale n’est introduite. Plusieurs écrans partagent le checkpoint : la première commande acceptée à une révision donnée fait foi. Une intention non reçue par le serveur ne peut être récupérée que dans le navigateur qui la conserve ; les états confirmés sont récupérables sur un autre appareil.

La commande `close` peut porter une préférence locale facultative `destination: "companion"`. Elle reste dans l’intention du navigateur pendant les renvois ; elle ne change aucune récompense ni le checkpoint serveur. Après confirmation de fermeture, le client construit la route de fiche depuis l’identifiant légendaire du reçu. Les anciennes intentions sans destination continuent de revenir à la carte.

La scène 3D reçoit seulement la phase, le nombre de questions terminées, le total, la pause, la préférence de mouvement et la visibilité de Lumo (masqué lors d’une rencontre légendaire). Elle n’a aucune capacité d’écriture dans le jeu. Les niveaux restent de longueur déterminée par le moteur, avec son plafond de nouveaux faits et sa taille configurable pour le gardien.
