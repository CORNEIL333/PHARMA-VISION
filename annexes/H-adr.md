<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe H — Décisions d'architecture (ADR)

Format court : contexte, décision, conséquences. Une nouvelle décision s'ajoute à la fin avec le numéro suivant. Une décision remplacée reste dans le fichier, marquée « remplacée par ADR-n ».

---

### ADR-001 — Nœud local autonome avant le cloud
- **Contexte** : le réseau est instable ; l'adoption par les pharmaciens est le premier risque ; les règles sur les données de santé freinent l'hébergement distant.
- **Décision** : le premier livrable est un serveur local qui fonctionne seul. Le cloud vient après (L1).
- **Conséquences** : utile dès le premier jour, risque juridique minimal ; les formats d'échange doivent être définitifs dès L0.

### ADR-002 — TypeScript strict et Node.js 24 LTS
- **Contexte** : construction par des agents IA ; revue par des experts ; une seule langue du serveur à l'interface.
- **Décision** : TypeScript 5 en mode `strict` sur Node.js 24 LTS, en ESM.
- **Conséquences** : moins d'erreurs à l'exécution, code plus lisible pour la revue ; une étape de build.

### ADR-003 — SQLite en WAL sur le nœud, PostgreSQL dans le cloud
- **Contexte** : un serveur par officine, au plus une dizaine de postes, aucun administrateur de base sur place.
- **Décision** : SQLite via `better-sqlite3`, en mode WAL avec `synchronous=FULL` et des écritures en `BEGIN IMMEDIATE`. PostgreSQL est réservé au cloud.
- **Conséquences** : zéro administration, sauvegarde en ligne simple, écritures sérialisées (suffisant pour le volume visé) ; la base n'est pas partagée entre officines (ce qui n'est pas souhaité).

### ADR-004 — Stock calculé à partir de mouvements en ajout seul
- **Contexte** : plusieurs postes vendent en même temps ; le stock doit être auditable ; il faudra synchroniser sans conflit.
- **Décision** : aucune quantité n'est stockée ; le stock est la somme des mouvements, en ajout seul.
- **Conséquences** : pas de conflit d'écriture, historique complet ; les requêtes de stock passent par des vues indexées.

### ADR-005 — Journal chaîné et points de contrôle signés plutôt qu'une blockchain
- **Contexte** : il faut une garantie de non-falsification et de non-répudiation de niveau « registre distribué », pour des acteurs identifiés, avec des données de santé.
- **Décision** : chaîne SHA-256 sur la forme canonique RFC 8785, points de contrôle Ed25519, puis journal de transparence en arbre de Merkle (RFC 9162) au cloud en L1.
- **Conséquences** : falsification détectable localement, puis par un tiers ; pas de coût par transaction ni d'exposition publique ; la clé du nœud doit être protégée.

### ADR-006 — Interface React servie localement, sans ressource Internet (complétée par ADR-011)
- **Contexte** : fonctionnement hors ligne ; postes hétérogènes ; politique CSP stricte.
- **Décision** : React 19 et Vite, build statique servi par le serveur ; polices et icônes embarquées ; CSP `default-src 'self'`.
- **Conséquences** : aucune installation sur les postes ; une mise à jour du serveur met à jour tous les postes.

### ADR-007 — TLS obligatoire sur le réseau local
- **Contexte** : le Wi-Fi d'une officine est partagé ou peu protégé ; des mots de passe et des ordonnances circulent.
- **Décision** : HTTPS avec un certificat auto-signé généré à l'installation ; empreinte affichée pour vérification ; HTTP refusé par défaut.
- **Conséquences** : un avertissement du navigateur au premier accès, à valider une fois par poste (ou installer le certificat sur les postes).

### ADR-008 — Ventes en régularisation au démarrage
- **Contexte** : le stock initial n'est jamais saisi complètement le jour de l'installation ; bloquer une vente ferait abandonner l'outil.
- **Décision** : pendant 30 jours (paramétrable), un produit sans stock peut être vendu sur un lot technique de régularisation, signalé dans la clôture.
- **Conséquences** : adoption facilitée ; l'écart est visible et doit être régularisé par une réception ou un inventaire.

### ADR-009 — Politique d'ordonnance « tous les médicaments » par défaut
- **Contexte** : depuis le 1er juillet 2024, une ordonnance est exigée pour tout médicament ; l'application réelle varie.
- **Décision** : la politique par défaut est `all_medicines` ; la politique `flagged` existe, mais la changer est une décision du titulaire, tracée dans le journal.
- **Conséquences** : conformité par défaut ; les produits sensibles exigent toujours une ordonnance.

### ADR-010 — Aucune intégration externe simulée
- **Contexte** : le MVP doit être évalué comme un produit réel ; une fausse intégration donnerait une image trompeuse.
- **Décision** : les intégrations (cloud, Mobile Money, WhatsApp, IA) sont absentes et prévues seulement par des interfaces. Les paiements électroniques sont enregistrés avec une référence saisie.
- **Conséquences** : le périmètre est honnête et l'évaluation budgétaire est fiable.

### ADR-011 — Application de bureau Tauri 2 pour les postes de travail
- **Contexte** : l'équipe veut une interface au rendu d'application native, dans le style de Kiro, de Qoder ou de macOS. Les postes des officines sont souvent anciens (Windows, 4 Go de mémoire). L'impression des tickets et la confiance dans le serveur local doivent être maîtrisées. Une grille de comparaison notée (Tauri 4,6/5, Electron 3,1/5) a été validée par le porteur du projet le 26 octobre 2026.
- **Décision** : chaque poste utilise une application **Tauri 2**. Elle affiche l'interface servie par le serveur appairé (même origine), vérifie le certificat du serveur contre une autorité locale appairée, imprime directement en ESC/POS et se met à jour depuis le serveur local avec des paquets signés en Ed25519. Le pont natif est limité à trois commandes ; les plugins d'accès large (`shell`, `fs`, `http`) sont interdits. L'interface utilise Tailwind CSS v4 et shadcn/ui. Le navigateur reste possible en secours, et le titulaire peut l'interdire.
- **Alternatives écartées** : Electron (installateur et mémoire 5 à 10 fois plus lourds, surface d'attaque plus large) ; application qui embarque sa propre copie de l'interface (deux versions à maintenir et cookies inter-origines) ; serveur réécrit en Rust (plus lent à produire, spécification déjà écrite en TypeScript).
- **Conséquences** : une petite base Rust à maintenir dans `apps/officine/desktop/` ; un certificat de signature de code à acheter pour Windows ; le serveur génère une autorité de certification locale à l'installation ; une interface unique pour l'application et le navigateur ; une mise à jour du serveur met à jour l'interface de tous les postes.

### ADR-012 — Phase B : serveur central (cloud L1) et back-office, après le gestionnaire
- **Contexte** : le porteur du projet a demandé le 26 octobre 2026 que, dès le gestionnaire d'officine terminé, la construction enchaîne sur le côté serveur : synchronisation, référentiel, rappels, journal de transparence, sauvegarde et bascule, back-office. Le document 02 décrit ces composants sans exigences numérotées.
- **Décision** :
  1. L'agent écrit d'abord `docs/10-cloud-spec.md` (exigences numérotées CL-, SY-, RF-, RA-, TL-, DI-, BO-, OP-, avec critères d'acceptation), à partir du document 02 (sections 14, 15, 17, 22), du document 04 (FR-CORE-01 à 06 et 08) et du document 06 (section 7). Ce document fait foi pour la phase B.
  2. **Pile** : même langage et mêmes outils que le nœud (TypeScript strict, Node.js 24, Fastify 5, TypeBox, Vitest, Playwright) ; **PostgreSQL 17** (base principale + réplique en flux sur un second hôte) ; bus d'événements = table « outbox » transactionnelle dans PostgreSQL (pas de Kafka au pilote) ; identité de l'équipe = **Keycloak** (OpenID Connect, MFA obligatoire) ; sauvegardes = **pgBackRest** (complète quotidienne + archivage continu des WAL, dépôt chiffré AES-256, copie hors site) ; fichiers chiffrés derrière une interface `BlobStore` (stockage dans PostgreSQL au pilote).
  3. **Liaison nœud ↔ cloud** : enrôlement du nœud par un jeton à usage unique émis par le back-office, enregistrement de sa clé publique Ed25519 ; envoi par lots en HTTPS avec épinglage du certificat du cloud ; chaque lot porte un point de contrôle signé ; le cloud vérifie la chaîne, dédoublonne par identifiant et accuse réception. Côté nœud, la synchronisation est **désactivée par défaut** et s'active par un paramètre du titulaire (`cloud_sync_enabled`) ; c'est le seul appel réseau sortant autorisé, et uniquement vers l'adresse configurée.
  4. **Journal de transparence** (RFC 9162) : les points de contrôle des nœuds sont ajoutés à un arbre de Merkle ; têtes d'arbre signées ; preuves d'inclusion et de cohérence vérifiables par un tiers.
  5. **Hors phase B** (ne pas construire) : canaux patient (app, WhatsApp, USSD), paiements Mobile Money, Connect pour les partenaires, Observatoire, IA, dispensaire.
- **Dépendances ajoutées pour `apps/cloud` et `apps/backoffice`** : `pg`, `jose` (vérification des jetons OIDC), plus la pile d'interface déjà autorisée pour le back-office.
- **Conséquences** : GUARDRAILS 18 est levée **uniquement** pour la synchronisation optionnelle du nœud vers le cloud configuré ; RPO 15 minutes et RTO 4 heures (document 02, section 14.4) deviennent des critères de recette mesurés par des scripts de restauration et de bascule.
