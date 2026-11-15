# Direction design — application mobile patient VisionPharma

> **Statut : proposition de design à partir des besoins documentés.** L’exploration de `apps/GUI_MODEL/` sur la branche `mobile` montre qu’elle contient actuellement le document de besoins, mais pas de maquettes graphiques ou d’écrans mobiles existants. Cette direction formalise donc une proposition cohérente à valider, et non la description de maquettes déjà réalisées.

## 1. Références et principes retenus

Le design doit servir la promesse de l’application : aider le patient à trouver un médicament, comparer les officines et les prix, puis réserver sans acheter en ligne.

Principes retenus des besoins et du produit :

- **Patient d’abord :** vocabulaire simple, une action principale visible par écran, pas de jargon pharmaceutique inutile.
- **Disponibilité transparente :** afficher clairement la fraîcheur de chaque information ; ne jamais présenter une donnée ancienne comme un stock confirmé.
- **Réservation, pas vente :** le bouton et les messages parlent de demande de réservation ; la confirmation appartient à l’officine et au pharmacien.
- **Confiance et sécurité :** rendre visibles l’officine choisie, le statut de la réservation, le consentement et les étapes nécessitant une validation professionnelle.
- **Conçu pour des appareils modestes :** écrans légers, images facultatives et optimisées, parcours utilisables avec une connexion lente.
- **Accessibilité :** viser WCAG 2.2 AA, textes lisibles, contrastes suffisants, cibles tactiles confortables, prise en charge du grossissement et des préférences de réduction des animations.
- **Canaux complémentaires :** l’app ne remplace ni WhatsApp ni USSD. Les parcours doivent rester compréhensibles sans supposer que chaque patient possède un smartphone récent.

## 2. Direction visuelle proposée

### Identité

Une interface de santé sobre, rassurante et contemporaine, sans imagerie alarmiste ni codes visuels de vente agressive. L’accent principal reprend le **turquoise/vert médical** de l’interface existante de l’officine, avec une base neutre et des couleurs sémantiques distinctes pour les états.

### Couleurs et thèmes

- Reprendre les jetons existants de `apps/officine/web/src/styles/tokens.css` lorsqu’ils sont réutilisables : fond, surfaces, texte, accent, bordure, danger, avertissement et succès.
- La web-app d’officine est sombre par défaut et propose un thème clair. Pour l’application patient, **prévoir le thème clair comme présentation initiale recommandée**, plus familier pour une app grand public ; proposer le sombre si le produit et les tests le confirment.
- Ne pas coder des couleurs en dur dans chaque écran : centraliser les couleurs en jetons mobiles afin de garder une apparence cohérente et testable.
- Couleurs d’état accompagnées d’un libellé et/ou d’une icône ; la couleur ne doit jamais être le seul moyen de communiquer une information.
- Éviter les grands aplats saturés. Réserver l’accent aux actions principales, aux liens importants et aux éléments de marque.

### Typographie et formes

- Utiliser une police sans empattement lisible et disponible localement ou embarquée dans l’application.
- Hiérarchie courte : titre d’écran, titre de carte, texte courant, information secondaire ; chiffres et prix facilement repérables.
- Laisser les montants en XAF lisibles et alignés ; ne pas réduire leur taille pour faire tenir une carte trop dense.
- Cartes et champs à coins modérément arrondis, bordures sobres, ombres discrètes uniquement lorsqu’elles clarifient la hiérarchie.
- Icônes accompagnées de libellés dans la navigation principale ; éviter les icônes ambiguës seules.

## 3. Navigation et structure

Proposition de navigation principale à quatre destinations :

1. **Accueil** — recherche immédiate, raccourcis et pharmacies de garde.
2. **Rechercher** — recherche de médicament, résultats et filtres.
3. **Réservations** — demandes en cours et historique utile.
4. **Compte** — profil, consentements, préférences et aide.

Utiliser une barre de navigation inférieure sur les écrans principaux. La recherche doit rester accessible rapidement depuis l’accueil et depuis les résultats. Les détails, formulaires et étapes de réservation s’ouvrent dans des écrans secondaires avec un titre explicite et un retour visible.

Ne pas ajouter une section dédiée aux fonctions non encore construites. Les entrées visibles doivent mener à des parcours fonctionnels, conformément à la règle produit de ne pas présenter de fonctions factices ou de boutons « bientôt disponible ».

## 4. Écrans et composants à concevoir

### 4.1 Accueil

- En-tête léger avec marque, zone actuelle et accès au compte.
- Champ de recherche proéminent : « Quel médicament recherchez-vous ? ».
- Raccourcis textuels et iconographiques vers pharmacies de garde et réservations en cours.
- Liste compacte de pharmacies proches ou de garde, si les données nécessaires sont disponibles.
- Messages explicatifs lorsque la localisation est refusée ou indisponible : proposer la saisie manuelle d’une ville ou d’un quartier plutôt que bloquer le parcours.

### 4.2 Recherche et résultats

- Recherche par nom du médicament ; prévoir des résultats tolérants aux variantes typographiques si le service le permet.
- Résultats sous forme de cartes d’officine avec nom, distance si disponible, prix, état de disponibilité et heure de dernière synchronisation.
- Présenter l’état avec texte explicite :
  - **Disponible** — données synchronisées depuis moins d’une heure ;
  - **À confirmer auprès de la pharmacie** — données âgées de 1 à 24 heures ;
  - **Stock non affiché** — données de plus de 24 heures ; l’officine peut être proposée dans l’annuaire, pas comme stock disponible.
- Filtres simples : distance/zone, pharmacie de garde, prix si ces données sont présentes et fiables.
- Une option générique doit être identifiée comme une alternative à discuter, sans donner l’impression que l’application prescrit ou substitue automatiquement.
- Prévoir les états chargement, aucun résultat, erreur réseau, localisation indisponible et résultats dont la fraîcheur ne permet pas de confirmer le stock.

### 4.3 Détail d’un médicament et d’une officine

- Séparer clairement les informations produit des informations propres à l’officine.
- Afficher le prix communiqué par l’officine, la date de fraîcheur du stock et les coordonnées utiles disponibles.
- Montrer les conditions de disponibilité sans promettre une réservation avant confirmation de l’officine.
- Bouton d’action : **« Demander une réservation »**, avec un rappel que la demande doit être validée par le pharmacien.

### 4.4 Ordonnance

- Expliquer pourquoi l’ordonnance est demandée et qui pourra la consulter.
- Permettre la prise ou le choix d’une photo, avec un aperçu avant envoi et une option d’annulation/remplacement.
- Demander uniquement les informations nécessaires au parcours ; éviter les champs non justifiés.
- Indiquer clairement que l’envoi ne vaut ni validation de l’ordonnance ni confirmation de délivrance.
- Prévoir des états d’envoi, d’échec et de confirmation de réception sans afficher de données sensibles dans les notifications système.

### 4.5 Demande et suivi d’une réservation

Afficher une progression lisible, par exemple :

1. Demande envoyée.
2. En attente de validation de l’officine.
3. Validée ou refusée par le pharmacien.
4. Acompte demandé, si applicable, après validation.
5. En préparation.
6. Prête au retrait ou remise au livreur, si la livraison est autorisée et disponible.
7. Retirée/remise, ou expirée/annulée.

- Distinguer visuellement les états **en attente**, **confirmé**, **refusé**, **expiré** et **terminé**, avec une explication textuelle.
- N’afficher l’acompte qu’après validation de l’officine. Expliquer le montant, le destinataire et les conditions avant redirection vers le prestataire agréé.
- Présenter le code de remise avec contraste et taille suffisants, seulement lorsque le parcours le justifie. Éviter de l’exposer sur l’écran verrouillé ou dans une notification.
- Rendre visibles la date limite de retrait et les règles de remboursement communiquées par l’officine.

### 4.6 Compte, consentement et préférences

- Connexion par numéro de téléphone et code à usage unique ; parcours de saisie du code simple, avec délai de renvoi clairement indiqué.
- Écran de préférences pour les notifications et consentements, avec possibilité de retirer un consentement.
- Expliquer les usages de chaque consentement séparément (par exemple rappels et carnet familial), sans cases précochées.
- Prévoir l’accès à l’aide, aux informations de confidentialité et à la suppression ou à la gestion des données selon les procédures applicables.

## 5. Règles d’interaction

- Un bouton principal par écran ; les actions secondaires restent visuellement secondaires.
- Toujours préserver la saisie du patient en cas de perte réseau et proposer de réessayer sans duplication de réservation.
- Confirmer les actions ayant des conséquences importantes : envoi d’une ordonnance, annulation d’une réservation ou déclenchement d’un paiement.
- Ne pas donner un état « réservé » tant que le pharmacien n’a pas confirmé.
- Ne pas utiliser de faux indicateur de stock en temps réel : afficher le dernier horodatage connu et les règles de fraîcheur.
- Utiliser des messages d’erreur utiles, en français courant, qui indiquent une prochaine action possible.
- Les animations sont courtes et non essentielles à la compréhension ; respecter la préférence système de réduction des animations.

## 6. États à prévoir pour chaque écran

Chaque écran important doit avoir des conceptions explicites pour :

- chargement ;
- contenu normal ;
- liste vide ;
- erreur récupérable et possibilité de réessayer ;
- absence ou lenteur du réseau ;
- contenu mis en cache et date de mise à jour ;
- permission refusée (localisation, appareil photo, notifications) ;
- session expirée ;
- état d’accessibilité avec texte agrandi.

Le cache hors ligne documenté concerne explicitement l’annuaire. Ne pas laisser entendre que les prix, les stocks ou les réservations restent actualisés ou disponibles hors connexion sans exigences et mécanismes supplémentaires.

## 7. Accessibilité et petits écrans

- Cibles tactiles suffisamment grandes et espacées ; ne pas concentrer des actions destructives à côté des actions principales.
- Contraste vérifié pour le texte courant, les états, les boutons et les composants désactivés.
- Taille de texte adaptable au réglage système ; éviter les hauteurs fixes qui coupent les libellés agrandis.
- Compatibilité avec lecteur d’écran : ordre de lecture cohérent, libellés accessibles, annonces des changements de statut.
- Ne jamais communiquer une disponibilité, un refus ou une erreur uniquement par une couleur ou une icône.
- Tester au minimum les petits écrans, les grandes tailles de texte, le mode contraste et le mode de réduction des animations.

## 8. Périmètre visuel de la première version

Pour une première version mobile, concevoir en priorité les parcours suivants :

1. Accueil et recherche.
2. Résultats avec fraîcheur explicite.
3. Détail officine/médicament.
4. Connexion par téléphone et code à usage unique.
5. Envoi d’ordonnance si le produit et le cadre réglementaire le permettent.
6. Demande, décision du pharmacien et suivi de réservation.
7. Compte, préférences et consentements nécessaires aux fonctions effectivement livrées.

Les fonctions comme carnet familial, rappels de prise, livraison, paiements intégrés, signalement d’effets indésirables et assistant vocal nécessitent des décisions produit, réglementaires et techniques supplémentaires avant d’être présentées comme disponibles.

## 9. Références internes examinées

- `apps/GUI_MODEL/BESOINS-APPLICATION-MOBILE.md` — synthèse des besoins de l’app patient et décisions à clarifier.
- `apps/officine/web/src/styles/tokens.css` — jetons visuels de l’interface actuelle de l’officine ; référence à adapter, pas maquette mobile.
- `apps/officine/web/src/styles/app.css` — typographie, couleurs sémantiques, focus visible et prise en compte de la réduction des animations.
- `docs/01-vision-strategie.md` — promesse des canaux patients, règles de réservation et feuille de route.
- `docs/02-specifications-composants.md`, section 16 — fonctionnalités, parcours patient, système, liaisons et garde-fous.
- `docs/03-fonctionnalites-avancees.md`, sections 26 et 29 — demandes non satisfaites et fonctionnalités patient ultérieures.
- `docs/04-cahier-des-charges.md` — exigences patient, OWASP MASVS, WCAG, cadre légal et lots.
- `docs/05-mvp-officine-spec.md` — exclusion explicite de l’application mobile du MVP L0.

## 10. À valider avant production des maquettes

- Confirmer le thème clair par défaut pour le patient et l’usage des jetons de l’officine.
- Valider les quatre destinations de navigation et le nom des sections.
- Définir les données réellement disponibles dans les cartes de résultats (distance, prix, stock, horaires).
- Confirmer les parcours d’ordonnance, d’acompte, de retrait et de livraison avec les responsables métier et juridiques.
- Choisir le framework mobile, les plateformes minimales et la stratégie de cache.
- Faire relire les écrans par des patients et pharmaciens, puis vérifier accessibilité, faible débit et appareils d’entrée de gamme.
