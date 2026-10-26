<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe E — Registre des risques

Méthode inspirée d'**ISO 31000:2018**. Probabilité (P) et impact (I) notés de 1 à 5 ; criticité = P × I. Revue chaque semaine pendant le pilote.

| ID | Risque | Catégorie | P | I | Criticité | Traitement | Responsable |
|---|---|---|---|---|---|---|---|
| R-01 | Les pharmaciens n'adoptent pas l'outil au quotidien | Produit | 3 | 5 | 15 | Pilote co-conçu, caisse plus rapide que le cahier, ventes en régularisation 30 jours, formation sur place | Porteur du projet |
| R-02 | Vente d'un lot rappelé ou périmé à cause d'un défaut logiciel | Sûreté patient | 2 | 5 | 10 | Règles bloquantes, tests à propriétés, garde-fous, revue humaine | Tech lead |
| R-03 | Perte de données après une panne matérielle | Fiabilité | 2 | 5 | 10 | WAL + `synchronous=FULL`, onduleur, sauvegarde quotidienne chiffrée et copie USB, restauration testée | Tech lead |
| R-04 | Vol du serveur ou d'une clé USB de sauvegarde | Sécurité | 2 | 4 | 8 | Chiffrement du disque (LUKS2) et des sauvegardes, clés hors de la base | Tech lead |
| R-05 | Fraude interne masquée par une modification de la base | Sécurité | 2 | 4 | 8 | Tables en ajout seul, journal chaîné, points de contrôle signés, rapport de fraude ; ancrage cloud en L1 | Tech lead |
| R-06 | Usurpation d'un compte pharmacien pour valider des ordonnances | Sécurité | 3 | 4 | 12 | TOTP, ré-authentification, verrouillage, comptes individuels, journal | Titulaire |
| R-07 | Code produit par les agents IA incorrect ou non sûr | Développement | 4 | 4 | 16 | Tests écrits avant le code du domaine, CI stricte, agent relecteur, revue humaine, garde-fous | Tech lead |
| R-08 | Dépendance vulnérable découverte en production | Sécurité | 3 | 3 | 9 | Dépendances minimales et figées, audit à chaque build, SBOM, mise à jour signée | Tech lead |
| R-09 | Désaccord de l'Ordre ou de la DPML sur le modèle | Réglementaire | 2 | 5 | 10 | Présentation dès J5, MVP sans vente en ligne ni données patient nominatives | Pharmacien référent |
| R-10 | Non-conformité à la loi n° 2024/017 | Réglementaire | 2 | 4 | 8 | AIPD, DPO, minimisation, données locales, registre des traitements | DPO |
| R-11 | Catalogue réel indisponible ou de mauvaise qualité | Données | 3 | 3 | 9 | Échantillon de démarrage, fiches locales, validation par le référentiel en L1 | Porteur du projet |
| R-12 | Délai de 14 jours intenable | Planning | 4 | 3 | 12 | Plan par exigences, retrait des priorités S avant toute baisse de qualité sur les M | Tech lead |
| R-13 | Horloge du serveur fausse (péremptions, journal) | Fiabilité | 2 | 3 | 6 | NTP, alerte d'écart avec les postes, heure du serveur qui fait foi | Tech lead |
| R-14 | Coupure d'électricité prolongée | Fiabilité | 4 | 3 | 12 | Onduleur, arrêt propre automatique, mode papier de secours documenté, saisie a posteriori | Titulaire |
| R-15 | Perte de la clé de récupération | Continuité | 2 | 4 | 8 | Impression en deux exemplaires, conservation au coffre, procédure de remplacement | Titulaire |
