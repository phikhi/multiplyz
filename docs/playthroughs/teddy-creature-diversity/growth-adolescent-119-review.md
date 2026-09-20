# Refus Gemini de l’ado — appel 119

11 septembre 2026. `growth-adolescents/2feea837-600e-4ecc-ac29-9d8b56a5f5aa-result.json` est conservé tel quel : résultat stopped, aucune galerie, **8,65 € réservés cumulés**. L’appel image 119 a répondu HTTP 200 mais `finishReason: PROHIBITED_CONTENT`, en moins d’une seconde. Aucun fichier brut 119, aucun dessin d’ado enregistré, aucune des trois inspections lancée. Le bébé et l’adulte de Vrillou restent exactement ceux validés par l’utilisateur. Son accord sur l’adulte n’est pas remis en question.

## Cause établie et limite du diagnostic

La [documentation officielle Gemini](https://ai.google.dev/api/generate-content#FinishReason) distingue `PROHIBITED_CONTENT` (arrêt lié à un contenu potentiellement interdit) de `NO_IMAGE` (absence d’image attendue). Le code traitait seulement SAFETY avant de chercher des pixels ; il masquait donc ce refus sous « réponse sans image (aucune inlineData) ». Le test reproduit l’erreur en rejouant une réponse minimale identique au statut archivé, sans réseau.

Le motif exact du filtre n’est pas disponible : l’ancien journal ne conservait ni `finishMessage` ni `safetyRatings`. Ne pas affirmer que le mot « adolescent » ou une autre formulation précise en est la cause, ni présenter le refus comme un verdict de qualité de l’ado — aucun ado n’a été livré. Diagnostic ajouté séparément : `growth-adolescents/2feea837-600e-4ecc-ac29-9d8b56a5f5aa-diagnosis.json`. Ancien résultat, trace et réservation 0,10 € inchangés.

## Corrections techniques

Le client signale désormais tout code de fin explicite différent de STOP avant d’accepter des octets, y compris si une réponse bloquée contient des pixels partiels. Aucun réessai automatique de ce refus ; seuils, contrôles de sécurité et modèle inchangés. L’absence d’image après STOP garde son diagnostic distinct. Les futures traces conservent le message de fin, les catégories de sécurité, l’identifiant de réponse et la version du modèle lorsqu’ils sont fournis ; les messages sont expurgés de la clé API. Cela n’invente pas les informations manquantes de l’appel 119.

## Demande animale clarifiée, passe unique préparée

Le brief décrit explicitement un **gecko végétal imaginaire à quatre pattes**, personnage non humain de jeu de calcul. Il garde la forme juvénile entre bébé et adulte, ses couleurs, pieds-feuilles, queue fourchue, proportions et rendu doux. Aucune désactivation ni réduction des filtres. Une formulation plus claire ne garantit pas que le fournisseur l’acceptera ; tout nouveau refus sera affiché et arrêtera cette passe, sans chaîne automatique d’autres formulations.

Nouveau fichier `growth-adolescent-clarification.json`, sans modification de l’accord original : empreintes de l’accord bébé/adulte, du résultat arrêté et des deux lignes de trace de l’appel 119. Le chargeur refuse un résultat modifié, un échec différent, une ancienne QA ou une génération ayant déjà un brouillon d’image. Même contrôle des fichiers, du catalogue, du monde futur, du budget et des deux bases en lecture seule avant chaque requête.

Depuis app/ sous Node 22, dans le Terminal utilisateur (réseau Gemini toujours indisponible ici) :

```sh
node --conditions=react-server --import tsx scripts/worldgen-pilot.ts --growth-adolescent-clarification
```

Plan sans API exécuté : **une image + trois QA fraîches**, bébé et adulte exacts réutilisés, **0,25 € supplémentaires / cumul prévu 8,90 € / plafond autorisé 30 €**. Nouveau marqueur `growth-adolescent-clarification-started.json`, brouillon/diagnostics/bilan dans `growth-adolescent-clarifications/`, galerie `preview-growth-adolescent-clarification-*.html`. Aucun appel réel de cette passe lancé ici. Ne pas relancer `--growth-adolescent`, ni effacer de marqueur, ni revenir aux anciennes passes.

**81 tests ciblés distincts passent**, dont 16 nouveaux sur les diagnostics et quatre sur cette clarification ; typage/lint/format ciblés passent. Rejeu rouge puis vert du diagnostic de l’appel 119. Suivi sans API : 119 appels, 8,65 € réservés. **26 tables familiales identiques, intégrité ok**, aucune écriture de base/seed/migration/restauration. Aucun nouveau dessin validé ou publié, aucune reprise des anciens tests globaux/couverture/canari, aucun nouvel essai familial/WebGL.

La refonte 0–5 et les autres évolutions du pilote restent à faire. Le socle seul était estimé à 20,50 € hors corrections ; 8,90 € + 20,50 € = 29,40 €, **hors reprises des autres âges du pilote**. Recalculer après établissement de la méthode, sans hausse automatique de plafond ni engagement global prématuré.
