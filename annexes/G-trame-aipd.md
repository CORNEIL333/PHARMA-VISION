<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe G — Trame d'analyse d'impact (AIPD) du MVP Officine

Trame à compléter par le DPO avant la mise en production pilote. Elle suit la logique de la loi n° 2024/017 et les bonnes pratiques d'ISO/IEC 29134. Ce document n'est pas un avis juridique : il doit être relu par un juriste.

## 1. Description du traitement

| Rubrique | Contenu pour le MVP |
|---|---|
| Responsable du traitement | L'officine (titulaire), pour ses propres données de gestion. VisionPharma est **fournisseur du logiciel** au MVP (aucune donnée ne lui est transmise). |
| Finalités | Gestion des ventes, du stock, des commandes et des ordonnances ; obligations réglementaires de traçabilité |
| Personnes concernées | Personnel de l'officine ; patients (de façon minimale) ; prescripteurs |
| Données | Personnel : identifiant, nom, rôle, journaux de connexion. Patients : référence pseudonyme ou initiales, ordonnance (photo, prescripteur, date, produits). Prescripteurs : nom, numéro d'inscription. |
| Données sensibles | Oui : les ordonnances révèlent des informations de santé |
| Lieu de stockage | Serveur dans l'officine ; sauvegardes chiffrées sur un support local. **Aucun transfert** hors de l'officine au MVP. |
| Durées de conservation | À fixer par type, avec un juriste (paramétrables dans le logiciel) |
| Destinataires | Personnel habilité de l'officine selon son rôle |

## 2. Nécessité et proportionnalité

| Question | Réponse à documenter |
|---|---|
| Base légale | Obligation légale (ordonnance obligatoire, traçabilité pharmaceutique) et intérêt légitime pour la gestion |
| Minimisation | Pas de nom complet du patient, pas de numéro d'identité, pas de téléphone au MVP |
| Information des patients | Affiche en officine, texte à rédiger |
| Droits des personnes | Accès et rectification par le titulaire ; procédure à écrire |
| Sous-traitants | Aucun au MVP. En L1, l'hébergeur cloud et VisionPharma deviennent sous-traitants : nouvelle AIPD |

## 3. Risques pour les personnes

| Risque | Source | Mesures existantes (document 06) | Risque résiduel |
|---|---|---|---|
| Accès illégitime à une ordonnance | Personnel non habilité, vol de matériel | Droits par rôle, chiffrement AES-256-GCM, disque chiffré, journal | À évaluer |
| Modification non désirée | Erreur ou fraude interne | Tables en ajout seul, journal chaîné et signé | À évaluer |
| Disparition des données | Panne, vol, incendie | Sauvegardes chiffrées, copie USB, restauration testée | À évaluer |

## 4. Plan d'action

| Action | Échéance | Responsable |
|---|---|---|
| Désigner le DPO et ouvrir le registre des traitements | J3 | Porteur du projet |
| Rédiger l'affiche d'information des patients | J8 | DPO |
| Fixer les durées de conservation | J10 | DPO et juriste |
| Valider l'AIPD et la signer | J12 | Titulaire de l'officine pilote et DPO |
