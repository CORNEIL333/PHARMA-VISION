<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Plan de mise en production en 14 jours

**Objectif réaliste** : en 14 jours, VisionPharma Officine (L0) est en production dans **1 à 3 officines pilotes**, avec un kit d'évaluation complet remis aux experts dès le **jour 7**.

**Ce qui n'est pas réaliste en 14 jours**, et qu'il faut dire clairement à l'équipe et aux experts :
- Le cloud, la synchronisation, WhatsApp, Connect et l'Observatoire ne peuvent pas être en production sûre en deux semaines.
- Les démarches avec l'Ordre, la DPML et l'Autorité de protection des données ne dépendent pas de nous.
- Mettre en ligne des données patient sans analyse d'impact serait illégal.

Le MVP autonome est le bon choix justement pour cette raison : **les données restent dans l'officine**, le patient n'est identifié que par des initiales, et il n'y a aucun transfert. Le risque juridique est minimal, et le logiciel est utile dès le premier jour.

Calendrier : J1 = mardi 27 octobre 2026, J14 = lundi 9 novembre 2026.

---

## 1. Piste technique (agents IA, sous la direction du tech lead)

| Jour | Livrable | Exigences | Sortie vérifiable |
|---|---|---|---|
| J1 | Socle : dépôt, CI (typage, lint, tests, audit, SBOM), configuration, base, migrations, **journal chaîné avec vecteurs de test** | I-01, I-05, J-01, J-02, J-03 | Les vecteurs de l'annexe C passent en CI |
| J2 | Mots de passe, TOTP, sessions, CSRF, en-têtes, matrice des droits, comptes | A-01 à A-08, U-01 à U-03 | Test exhaustif de la matrice |
| J3 | Catalogue : import CSV, recherche, codes-barres, décodage GS1, activation | I-04, C-01 à C-06 | 50 000 fiches importées en moins de 60 s |
| J4 | Stock : lots, mouvements, FEFO, ajustements, inventaire, destruction, valorisation | S-01 à S-09 | Test de concurrence S-04 |
| J5 | Fournisseurs, commandes, suggestions, réception | R-01 à R-06 | Cycle commande, réception, stock |
| J6 | Caisse : sessions, ventes atomiques, paiements, annulation, clôture, ticket | V-01 à V-10 | Test d'injection d'erreur V-04 |
| J7 | Ordonnances, rappels, péremptions ; **interface caisse complète** (design system de la section 8.1) ; installation Docker ; évaluation dans le navigateur | O-01 à O-06, Q-01 à Q-04 | **Version d'évaluation remise aux experts** |
| J8 | Demandes non satisfaites, rapports | D-01 à D-03, P-01 à P-08 | Rapports exacts sur un jeu de données de recette |
| J9 | Sauvegarde, restauration, vérification du journal, écran Système, garde | B-01 à B-05, J-04 à J-06, G-01 | Restauration sur une machine neuve avec la clé de récupération |
| J10 | Durcissement : liste ASVS 5.0, tests de charge (10 postes), coupure de courant, mise à jour avec retour arrière | NFR-PE, NFR-RE, SEC-* | Rapport de durcissement |
| J11 | Paquet natif et service systemd, installation sur le **mini-PC réel**, import du **catalogue réel** ; **application de bureau Tauri** : appairage, épinglage, impression ESC/POS, mises à jour signées, installateurs | NFR-FL-01, CT-01, W-01 à W-08 | Installation en moins de 30 min chronométrée |
| J12 | Recette par deux pharmaciens, corrections | document 08 | Procès-verbal de recette |
| J13 | Revue de sécurité externe ou test d'intrusion léger, corrections | SEC-OP-04 | Rapport sans faille critique ni élevée ouverte |
| J14 | Mise en production dans la première officine pilote, formation, astreinte | — | Premières ventes réelles, journal vérifié en fin de journée |

**Règle de pilotage** : chaque soir, le tech lead vérifie que la CI est verte, que les exigences du jour ont leurs tests, et met à jour le tableau d'avancement. Une journée qui dérape est rattrapée en retirant du **S**, jamais en sautant des tests sur du **M**.

---

## 2. Piste humaine (à mener en parallèle, dès J1)

| Échéance | Action | Responsable |
|---|---|---|
| J1 | Choisir les 1 à 3 officines pilotes et obtenir leur accord écrit | Porteur du projet |
| J2 | Commander le matériel : mini-PC, onduleur, lecteur GS1, imprimante 80 mm, clé USB de sauvegarde | Porteur du projet |
| J3 | Acheter un certificat de signature de code Windows (délai de validation de plusieurs jours) | Porteur du projet |
| J3 | Obtenir le catalogue réel d'un grossiste-répartiteur (export CSV) | Porteur du projet |
| J3 | Désigner le délégué à la protection des données (même provisoire) et ouvrir le registre des traitements | Porteur du projet |
| J5 | Demander un rendez-vous à l'Ordre national des pharmaciens et à la DPML pour présenter le MVP | Pharmacien référent |
| J7 | Remettre le kit d'évaluation aux experts (annexe J) | Tech lead |
| J8 | Rédiger l'analyse d'impact simplifiée du MVP (trame à l'annexe G) | DPO |
| J10 | Signer la convention de pilote avec chaque officine | Porteur du projet |
| J12 | Organiser la recette avec deux pharmaciens | Pharmacien référent |
| J14 | Former le personnel de l'officine pilote (2 heures) | Tech lead et pharmacien référent |

**Opportunité de calendrier** : la date limite du MIT Solve Global Health Challenge est le **6 novembre 2026**, soit J11. La version d'évaluation de J7 suffit comme prototype démontrable.

---

## 3. Risques du plan

| Risque | Probabilité | Parade |
|---|---|---|
| Le matériel n'arrive pas à temps | Moyenne | Démarrer le pilote sur un PC portable dédié, avec onduleur |
| Le catalogue réel n'est pas disponible | Moyenne | Démarrer avec l'échantillon, puis activer les fiches au fil des scans (C-03) |
| Les agents IA produisent du code non conforme | Élevée | Garde-fous, tests écrits avant le code du domaine, revue humaine de chaque fusion |
| Une faille est trouvée en J13 | Moyenne | Reporter la mise en production plutôt que de livrer avec une faille critique ou élevée |
| Le personnel n'adopte pas l'outil | Moyenne | Formation, pharmacien référent sur place le premier jour, ventes en régularisation autorisées 30 jours |

---

## 4. Après J14

| Période | Objectif |
|---|---|
| Semaines 3 à 6 | Stabiliser le pilote ; jalon 1 (70 % des ventes saisies) ; étendre à 10 officines |
| Semaines 4 à 10 | L1 : cœur de données, synchronisation, journal de transparence, back-office |
| Semaines 8 à 14 | L2 : canal patient WhatsApp, réservations, alerte de retour en stock |
| Ensuite | Feuille de route des documents [01](01-vision-strategie.md) et [02](02-specifications-composants.md) |
