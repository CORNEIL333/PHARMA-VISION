# Besoins de l’application mobile patient — VisionPharma

> Synthèse des besoins relatifs à l’application mobile patient, regroupés à partir des documents produit et de spécification du dépôt. Ce fichier est une synthèse de travail : il ne remplace pas les documents sources lorsqu’une exigence détaillée ou un arbitrage reste à confirmer.

## 1. Rôle et promesse

L’application mobile est un canal patient de VisionPharma. Elle doit aider une personne à savoir **où trouver un médicament, à quel prix, et à le réserver**. Elle s’appuie sur les données du cœur VisionPharma et des officines connectées.

**Principe essentiel :** l’application permet de rechercher et de réserver ; elle ne vend pas de médicaments en ligne. La délivrance demeure un acte du pharmacien.

## 2. Périmètre et calendrier

- L’application mobile patient **n’est pas incluse dans le MVP autonome L0** : la spécification L0 la place explicitement hors périmètre.
- Le cahier des charges situe l’application mobile en **L4 / V2**. La feuille de route du document 01 prévoit une application Android dans la phase Réseau (mois 6 à 12), sous réserve du jalon du pilote.
- Le document 02 distingue les canaux : WhatsApp est prioritaire au début ; l’application Android complète est prévue en V2 ; iOS est mentionné en V3.
- Les tableaux de fonctionnalités du document 02 emploient parfois le libellé « MVP » pour des fonctions des canaux patients. Pour éviter de confondre ce MVP fonctionnel avec le MVP L0 de l’officine, **ce document retient que l’application native patient est à construire après L0**, dans la phase patient/réseau prévue par la feuille de route.

## 3. Utilisateurs et contexte d’usage

- Patients et familles au Cameroun, y compris les personnes qui recherchent une pharmacie de garde ou un médicament en rupture.
- Le smartphone n’étant pas universel, l’application doit s’inscrire dans un ensemble de canaux complémentaires : WhatsApp et USSD. L’USSD permet notamment un accès sans smartphone.
- L’application vise aussi les téléphones d’entrée de gamme et des conditions de connectivité limitées.

## 4. Fonctionnalités attendues

### Recherche et information

- Rechercher un médicament et les officines proches qui le proposent.
- Afficher les prix et, lorsqu’un équivalent approprié existe, présenter une option générique moins chère. La substitution touchant à la délivrance reste à valider par un pharmacien.
- Rechercher les pharmacies de garde.
- Présenter la fraîcheur de la disponibilité :
  - synchronisation de moins d’une heure : « Disponible » ;
  - de 1 à 24 heures : « À confirmer auprès de la pharmacie » ;
  - au-delà de 24 heures : l’officine ne figure plus dans les résultats de stock, mais peut rester dans l’annuaire.

### Ordonnance

- Permettre la transmission ou la photo d’une ordonnance.
- L’ordonnance ne doit être visible que par l’officine choisie par le patient.
- La validation de l’ordonnance et de la délivrance revient au pharmacien ; l’application ne remplace pas cette validation.

### Réservation et retrait

- Permettre au patient d’envoyer une demande de réservation à une officine.
- La réservation n’est confirmée qu’après validation du pharmacien.
- Après validation seulement, le parcours peut demander un acompte Mobile Money par l’intermédiaire d’un agrégateur agréé.
- Fournir le suivi de la réservation et un code de remise/retrait.
- Une réservation non retirée expire après un délai défini par l’officine ; les règles de remboursement doivent être affichées.
- Une livraison est envisagée en V2 : l’officine prépare, scelle et valide le colis avant enlèvement ; le patient confirme la remise par un code unique. Les produits sensibles et ceux nécessitant la chaîne du froid sont exclus du schéma initial. Le dispositif doit être validé avec l’Ordre et la DPML avant lancement.

### Fonctions ultérieures

Les documents envisagent, selon les versions et priorités :

- livraison (V2) ;
- carnet familial et rappels de prise (V2) ;
- alertes de rappel de lot (V2) ;
- alerte de retour en stock ;
- abonnement de renouvellement pour les maladies chroniques (V2) ;
- vérification d’une boîte à partir d’une photo et du numéro de lot (V2) ;
- budget santé familial et paiement par un proche (V2) ;
- signalement d’un effet indésirable (V2) ;
- assistant vocal en français, anglais et pidgin (V3) ;
- épargne ou tontine santé (V3).

Ces fonctions ultérieures ne sont pas toutes spécifiées au même niveau et doivent être priorisées avant leur conception détaillée.

## 5. Parcours principal de réservation

1. Le patient transmet une ordonnance si nécessaire et recherche un médicament.
2. L’application affiche les officines, les disponibilités avec leur fraîcheur, et les prix.
3. Le patient demande une réservation.
4. L’officine reçoit la demande ; un pharmacien la valide ou la refuse.
5. Si elle est validée, l’acompte peut être demandé via un agrégateur Mobile Money agréé.
6. L’officine prépare et scelle le produit.
7. Le patient suit la réservation et récupère le produit avec le code de remise ; si une livraison encadrée est disponible, il confirme la remise par un code unique.

Le patient ne doit pas payer pour un produit indisponible ou pour une ordonnance refusée.

## 6. Exigences techniques et d’expérience

- **Plateformes :** Android d’abord, iOS ensuite.
- **Technologie envisagée :** Flutter ou React Native ; le choix reste à confirmer. L’objectif est une base de code multiplateforme.
- **Taille cible Android :** moins de 30 Mo.
- **Connectivité :** mode données réduites et cache hors ligne de l’annuaire. Cette mention concerne explicitement l’annuaire ; les documents ne promettent pas que la recherche de stock ou la réservation fonctionnent intégralement hors connexion.
- **Authentification :** numéro de téléphone et code à usage unique ; aucun mot de passe à mémoriser. Le cahier des charges précise un numéro au format E.164 et une limitation de débit.
- **Accessibilité :** WCAG 2.2 niveau AA ; gros caractères et parcours vocaux mentionnés comme objectifs d’accessibilité de l’écosystème. L’USSD constitue un canal complémentaire, pas une fonction de l’application.
- **Réactivité cible :** recherche patient en moins de 2 secondes sur réseau 3G.

## 7. Intégrations et données échangées

- **Cœur de données, par API REST authentifiée :** recherche, disponibilité, réservations, compte et consentements.
- **Mobile Money :** acomptes et remboursements via un agrégateur ; VisionPharma ne détient pas les fonds.
- **Notifications :** les documents prévoient notifications et rappels, avec préférences et consentement. Les canaux complémentaires comprennent SMS et WhatsApp.
- **Officine :** reçoit les réservations à traiter et renvoie leur statut au cœur de données.
- **Livraison, si activée :** échange du statut de course et de l’heure estimée via Connect/webhooks.

## 8. Sécurité, vie privée et garde-fous

- Respecter le principe de minimisation des données et les règles applicables aux données de santé.
- Prévoir un registre de consentements révocables ; obtenir le consentement explicite avant les rappels, le carnet familial ou les notifications concernées.
- Ne rendre une ordonnance accessible qu’à l’officine choisie par le patient.
- Appliquer l’authentification sécurisée, la limitation de débit et les droits d’accès adaptés.
- Viser OWASP MASVS 2 pour la sécurité de l’application mobile et WCAG 2.2 AA pour l’accessibilité.
- Ne pas effectuer de vente en ligne et ne pas fournir de conseil médical personnalisé. Un assistant doit renvoyer vers un pharmacien.
- Les règles de protection des données du projet prévoient notamment une analyse d’impact, un DPO et une autorisation préalable pour les transferts de données hors du Cameroun, conformément aux éléments décrits dans le cahier des charges. À faire valider juridiquement avant mise en production.

## 9. Décisions restant à prendre

1. Confirmer le découpage de livraison : WhatsApp d’abord, puis application Android en V2 ; iOS en V3.
2. Arbitrer les fonctions à livrer dans la première version de l’application (recherche, garde, ordonnance, réservation, suivi) et celles à reporter.
3. Choisir Flutter ou React Native et préciser les versions minimales d’Android/iOS prises en charge.
4. Définir précisément ce qui est disponible hors connexion : cache annuaire seulement, ou davantage.
5. Définir les règles de fraîcheur, les libellés et les comportements si les données de stock sont anciennes ou absentes.
6. Préciser le fournisseur d’authentification par code à usage unique, les notifications, l’agrégateur Mobile Money et leurs responsabilités de traitement des données.
7. Définir les durées d’expiration, d’annulation et de remboursement des réservations et acomptes.
8. Faire valider juridiquement le parcours de livraison, les ordonnances et le traitement des données de santé.

## 10. Documents sources

- [docs/01-vision-strategie.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/01-vision-strategie.md) — vision produit, canaux patient, roadmap, contraintes d’accès et de livraison.
- [docs/02-specifications-composants.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/02-specifications-composants.md) — section 16 (fonctionnalités, parcours, système, liaisons et garde-fous des canaux patient), et sections relatives à la disponibilité et aux exigences non fonctionnelles.
- [docs/03-fonctionnalites-avancees.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/03-fonctionnalites-avancees.md) — demandes non satisfaites et fonctionnalités patient envisagées.
- [docs/04-cahier-des-charges.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/04-cahier-des-charges.md) — lots, exigences patient, sécurité mobile, accessibilité et cadre légal.
- [docs/05-mvp-officine-spec.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/05-mvp-officine-spec.md) — confirme que l’application mobile patient est hors du MVP L0.
- [docs/11-dossier-installation.md](https://github.com/CORNEIL333/PHARMA-VISION/blob/2043c8ce1cdcb4997592fe888de5d3bdc5e2e047/docs/11-dossier-installation.md) — contexte réglementaire et données de l’officine ; source de contexte, pas spécification de l’app patient.
