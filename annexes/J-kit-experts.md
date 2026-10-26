<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe J — Kit d'évaluation pour les experts

Ce kit permet à une équipe d'experts d'évaluer le MVP VisionPharma Officine et de chiffrer un budget. Il est remis au **jour 7** du plan (document 07), puis mis à jour en J14.

## 1. Ce qui est remis

| Élément | Où |
|---|---|
| Vision, benchmark, modèle économique | `docs/01-vision-strategie.md` |
| Spécifications de tous les composants | `docs/02-specifications-composants.md`, `docs/03-fonctionnalites-avancees.md` |
| Cahier des charges et référentiel normatif | `docs/04-cahier-des-charges.md` |
| Spécification détaillée du MVP, avec ses critères d'acceptation | `docs/05-mvp-officine-spec.md` |
| Architecture et sécurité | `docs/06-architecture-securite.md` |
| Plan de tests et de recette | `docs/08-tests-et-recette.md` |
| Code source, historique Git, résultats de la CI, SBOM | dépôt `apps/officine/` |
| Image Docker signée et paquet d'installation | publication de la version |
| Base de démonstration (catalogue échantillon, comptes de test, une semaine d'activité de recette) | fournie avec la version, clairement marquée « démonstration » |

## 2. Ce que les experts peuvent vérifier eux-mêmes

1. **Installer** le logiciel sur une machine neuve en suivant le `README` (objectif : moins de 30 minutes).
2. **Jouer** les scénarios de recette RC-01 à RC-25 (document 08).
3. **Relancer** la suite de tests et la vérification du journal (`npm test`, `npm run verify-ledger`).
4. **Contrôler** les vecteurs de test du journal (annexe C, section 4) avec leur propre outil.
5. **Altérer** volontairement la base et constater la détection (RC-15).
6. **Auditer** les dépendances (SBOM, `npm audit`) et la configuration de sécurité (liste ASVS du document 08, section 5).

## 3. Questions auxquelles nous attendons une réponse

| Thème | Question |
|---|---|
| Qualité | Le code est-il maintenable par une équipe humaine ? Quels sont les points de dette ? |
| Sécurité | Quels écarts avec ASVS 5.0 niveau 2, et niveau 3 pour l'authentification, les sessions, la cryptographie et la journalisation ? |
| Architecture | Les choix des ADR 001 à 011 tiennent-ils pour 100 puis 1 000 officines ? |
| Budget | Quel coût pour finir L0, puis pour L1 (cloud et synchronisation) et L2 (canal WhatsApp) ? |
| Équipe | Quelle équipe minimale pour l'exploitation et le développement sur 12 mois ? |
| Conformité | Quelles actions restent nécessaires avant un déploiement à plus de 10 officines ? |

## 4. Base d'estimation proposée pour L0

Ordres de grandeur pour une équipe **sans** agents IA, à confronter au temps réellement constaté avec Qoder. Ils servent à cadrer la discussion, pas de devis.

| Bloc | Exigences | Complexité | Jours-personne |
|---|---|---|---|
| Socle, CI, configuration, migrations | I-01, I-05 | Faible | 4 à 6 |
| Journal chaîné, points de contrôle, vérification | J-01 à J-06 | Élevée | 5 à 8 |
| Authentification, TOTP, sessions, droits, comptes | A-01 à A-08, U-01 à U-03 | Élevée | 6 à 9 |
| Catalogue, import, recherche, GS1, activation | I-04, C-01 à C-07 | Moyenne | 5 à 8 |
| Stock, lots, FEFO, inventaire | S-01 à S-09 | Élevée | 6 à 9 |
| Fournisseurs, commandes, réception | R-01 à R-06 | Moyenne | 5 à 7 |
| Caisse, ventes, paiements, clôture, ticket | V-01 à V-10 | Élevée | 8 à 12 |
| Ordonnances et chiffrement des images | O-01 à O-06 | Moyenne | 3 à 5 |
| Rappels et péremptions | Q-01 à Q-05 | Faible | 2 à 4 |
| Demande non satisfaite | D-01 à D-03 | Faible | 1 à 2 |
| Rapports | P-01 à P-08 | Moyenne | 5 à 8 |
| Sauvegarde et restauration | B-01 à B-05 | Moyenne | 4 à 6 |
| Interface (tous les écrans) et design system | section 8 du document 05 | Élevée | 15 à 22 |
| Application de bureau Tauri (appairage, épinglage, impression, mises à jour, installateurs signés) | W-01 à W-11 | Moyenne | 5 à 8 |
| Installation (Docker, paquet natif, systemd) | NFR-FL-01 | Moyenne | 3 à 5 |
| Tests de bout en bout, de charge et de résistance | document 08 | Moyenne | 6 à 9 |
| Durcissement et revue de sécurité | SEC-* | Moyenne | 4 à 6 |
| **Total** | | | **87 à 134** |

Coûts hors développement à prévoir : certificat de signature de code Windows (renouvellement annuel), matériel par officine (mini-PC, onduleur, lecteur GS1 2D, imprimante 80 mm, clé USB), test d'intrusion externe, accompagnement juridique (AIPD, contrats, conditions d'utilisation), DPO, formation et assistance sur place pendant le pilote.
