# VisionPharma — documentation du projet

**VisionPharma** est l'infrastructure de données du médicament au Cameroun. Elle commence par un logiciel de gestion d'officine qui fonctionne hors ligne, puis relie les officines, les patients et les partenaires de santé.

Version 3.1 · 26 octobre 2026 · projet tutoré universitaire. Nouveauté de la 3.1 : application de bureau Tauri 2 pour les postes et design system de l'interface (ADR-011).

## Par où commencer

| Vous êtes… | Lisez |
|---|---|
| **Personne qui lance Qoder** | [`PROMPT-MAITRE-QODER.md`](PROMPT-MAITRE-QODER.md) : les prompts à coller (démarrage, relance, relecture) ; [`PROMPT-AUTONOME-QODER.md`](PROMPT-AUTONOME-QODER.md) : construction complète en boucle, sans intervention ; [`PROMPT-QODER-GESTIONNAIRE-PUIS-SERVEUR.md`](PROMPT-QODER-GESTIONNAIRE-PUIS-SERVEUR.md) : finit le gestionnaire puis enchaîne sur le serveur central et le back-office |
| **Agent IA (Qoder)** qui construit le logiciel | [`AGENTS.md`](AGENTS.md), puis [`GUARDRAILS.md`](GUARDRAILS.md), puis [`docs/05-mvp-officine-spec.md`](docs/05-mvp-officine-spec.md). Les règles sont aussi dans [`.qoder/rules/`](.qoder/rules/). |
| **Tech lead** | [`COLLABORATION.md`](COLLABORATION.md), [`docs/07-plan-14-jours.md`](docs/07-plan-14-jours.md), [`docs/06-architecture-securite.md`](docs/06-architecture-securite.md) |
| **Expert chargé de l'évaluation et du budget** | [`annexes/J-kit-experts.md`](annexes/J-kit-experts.md), puis [`docs/04-cahier-des-charges.md`](docs/04-cahier-des-charges.md) |
| **Jury, partenaire, investisseur** | [`docs/01-vision-strategie.md`](docs/01-vision-strategie.md), [`docs/09-viabilite-financement.md`](docs/09-viabilite-financement.md) |
| **Pharmacien référent** | [`docs/05-mvp-officine-spec.md`](docs/05-mvp-officine-spec.md), sections 5 et 6, et [`docs/08-tests-et-recette.md`](docs/08-tests-et-recette.md), section 3 |

## Contenu

```
README.md                      ce fichier
PROMPT-MAITRE-QODER.md         prompts à coller dans Qoder (démarrage, relance, relecteur)
PROMPT-AUTONOME-QODER.md       prompt de construction autonome en boucle, jusqu'au produit complet
PROMPT-QODER-GESTIONNAIRE-PUIS-SERVEUR.md   gestionnaire (phase A) puis serveur central et back-office (phase B)
AGENTS.md                      consignes pour les agents IA (lu automatiquement par Qoder)
GUARDRAILS.md                  règles non négociables
COLLABORATION.md               comment humains et agents travaillent ensemble
.qoder/rules/                  règles Qoder (toujours actives ou par dossier)
docs/
  01-vision-strategie.md       Partie I : diagnostic, benchmark, produit, portail, brainstorming, modèle économique
  02-specifications-composants.md  Partie II : chaque composant, ses fonctions, ses liaisons
  03-fonctionnalites-avancees.md   Partie III : produits introuvables, catalogue dormant, rapports, innovations
  04-cahier-des-charges.md     cahier des charges et référentiel normatif international
  05-mvp-officine-spec.md      spécification de construction du MVP (source de vérité pour le code)
  06-architecture-securite.md  architecture, menaces, journal chaîné, cryptographie
  07-plan-14-jours.md          plan de mise en production
  08-tests-et-recette.md       stratégie de test, scénarios de recette, traçabilité
  09-viabilite-financement.md  viabilité, impact, financement
annexes/
  A-glossaire.md
  B-modele-donnees.md          schéma SQL de référence (vérifié)
  C-evenements.md              catalogue d'événements et vecteurs de test du journal
  D-api-officine.md            routes de l'API
  E-registre-risques.md
  F-sources.md
  G-trame-aipd.md              analyse d'impact sur la protection des données
  H-adr.md                     décisions d'architecture
  I-format-import-catalogue.md
  I2-catalogue-echantillon.md  échantillon de catalogue de démarrage
  J-kit-experts.md             kit d'évaluation et base d'estimation
```

## Mise en place dans le dépôt

1. Créer le dépôt Git et y copier tout le contenu de ce dossier, à la racine.
2. Ouvrir le dépôt dans Qoder : `AGENTS.md` et `.qoder/rules/` sont pris en compte automatiquement (espace de travail de confiance).
3. Le code du MVP sera créé dans `apps/officine/`, comme décrit dans `AGENTS.md`.

Les diagrammes sont écrits en Mermaid : ils s'affichent dans GitHub, GitLab, Qoder et la plupart des éditeurs Markdown.

## Documents à produire ensuite

Hors du périmètre de cette livraison, à faire pendant ou après le pilote : modèle financier détaillé, conditions d'utilisation et politique de confidentialité, contrats (abonnement, pilote, traitement des données), note de présentation pour l'Ordre et la DPML, manuel utilisateur et guide de formation de l'officine, documentation développeur de Connect.
