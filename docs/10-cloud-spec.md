<!-- VisionPharma · documentation projet · v1.0 · 2026-10-29 · écrit par l'agent (ADR-012), à relire en priorité -->

# Spécification de construction — serveur central VisionPharma (cloud L1) et back-office

Ce document fait foi pour la phase B (ADR-012). Il suit le format du document 05 : chaque exigence a un identifiant, une priorité (**M** obligatoire, **S** souhaitable, **C** si le temps le permet) et des critères d'acceptation qui sont des tests automatisés, sauf mention « manuel ».

Sources : document 02 (sections 14, 15, 17 et 22), document 04 (FR-CORE-01 à 06 et 08, NFR, SEC), document 06 (section 7), document 03 (section 26).

---

## 0. Règles communes

1. **Mêmes règles que le nœud** : pas d'émulation hors des tests, pas de donnée inventée, aucun secret dans le dépôt, journaux techniques sans secret ni donnée de santé, montants en entiers XAF, horodatage `timestamptz` en UTC.
2. **Le cloud ne réécrit jamais l'histoire d'une officine.** Les événements d'un nœud sont stockés tels qu'ils ont été signés. Les vues (disponibilité, statut de synchronisation) en sont dérivées.
3. **Écriture transactionnelle** : toute écriture métier se fait dans une seule transaction PostgreSQL, qui contient aussi sa ligne d'audit (`audit_log`) et, le cas échéant, sa ligne de bus (`outbox`). Les verrous de ligne explicites (`SELECT … FOR UPDATE`) ou le niveau `SERIALIZABLE` s'appliquent là où deux écrivains peuvent se croiser : chaîne d'un nœud, numéro de version du référentiel, arbre de transparence.
4. **Migrations** : fichiers `NNN_*.sql`, jamais modifiés une fois publiés.
5. **Hors périmètre** (ne pas construire) : canaux patient, réservations, paiements, consentements patient, Connect, Observatoire, IA, dispensaire.

## 1. Architecture

```
apps/officine ──HTTPS épinglé, requêtes signées Ed25519──▶ apps/cloud (API Fastify) ──▶ PostgreSQL 17 primaire ──flux──▶ réplique
                                                                 ▲                              │
apps/backoffice (React, OIDC + PKCE) ──jeton d'accès──────────────┘          pgBackRest (complète + WAL, dépôt AES-256, copie hors site)
                                     Keycloak (realm « visionpharma », MFA obligatoire)
packages/protocol : JCS, empreintes, points de contrôle, signature des requêtes, arbre de Merkle (RFC 9162) — partagé par le nœud et le cloud
```

### 1.1 Authentification d'un nœud (sans secret partagé)

Chaque requête d'un nœud porte trois en-têtes :
- `X-VP-Node` : identifiant du nœud ;
- `X-VP-Date` : instant UTC ISO 8601 ;
- `X-VP-Signature` : signature Ed25519 en base64url, faite avec la clé du nœud, du message `VPREQ1|<node_id>|<date>|<méthode>|<chemin>|<sha256 hex du corps>`.

Le cloud accepte une requête si :
- la clé publique du nœud est enrôlée et non révoquée ;
- l'horloge est à moins de 5 minutes ;
- le couple (nœud, signature) n'a pas été vu dans les 10 dernières minutes (anti-rejeu).

### 1.2 Épinglage côté nœud

Le titulaire saisit l'adresse du cloud et l'empreinte SHA-256 de sa **clé publique** (SPKI). Le nœud n'accepte que ce certificat, même s'il est valide pour une autorité publique.

### 1.3 Contrat nœud ↔ cloud (types dans `packages/protocol`)

| Route | Requête | Réponse |
|---|---|---|
| `POST /enrol/v1` | jeton, `node_id`, `kid`, clé publique PEM, point de contrôle signé (preuve de possession de la clé) | `EnrolmentResponse` : `pharmacy_id`, clés publiques de publication et du journal |
| `POST /sync/v1/batches` (signée) | `SyncBatch` : événements CloudEvents, point de contrôle du dernier, produits et lots cités | `SyncAck` : identifiants accusés, tête acceptée |
| `GET /sync/v1/recalls?since=N` (signée) | — | `{ items: Signed<RecallNotice>[] }` triés par `version` |
| `POST /sync/v1/recalls/:id/ack` (signée) | `{ version }` | `{ ok: true }` |
| `GET /sync/v1/referential?since=N` (signée) | — | `{ versions: Signed<ReferentialVersion>[] }` triées |

Les publications (rappels, versions du référentiel) sont signées par la clé de publication du cloud : message `VPPUB1|<kind>|<JCS du contenu>`. Le nœud vérifie cette signature en plus de l'épinglage TLS.

---

## 2. Exigences

### 2.1 Enrôlement et annuaire des officines (CL)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| CL-01 | M | Le back-office (rôle `admin` ou `support`) émet un **jeton d'enrôlement à usage unique** pour une officine de l'annuaire. Le jeton fait 32 octets, il expire au bout de 72 heures, et seule son empreinte est stockée. | Le jeton s'affiche une seule fois ; jeton expiré, déjà utilisé ou inconnu : 401. Événement d'audit `enrolment.token_issued`. |
| CL-02 | M | Enrôlement : le nœud envoie le jeton, son `node_id`, sa clé publique Ed25519, son `kid` et son premier point de contrôle signé par cette clé. Le cloud enregistre la clé, lie le nœud à l'officine et renvoie l'identifiant d'officine et l'empreinte de la clé publique du certificat du cloud. | Signature du point de contrôle invalide : 422, rien n'est enregistré. Un second enrôlement du même jeton : 401. Le même `node_id` déjà actif : 409. |
| CL-03 | M | Révocation d'un nœud (`admin`, motif obligatoire). Ses requêtes sont refusées ; son historique est conservé. | Requête signée d'un nœud révoqué : 401 ; audit `node.revoked`. |
| CL-04 | M | Rotation de la clé d'un nœud : l'événement `system.key_rotated` du nœud, signé par l'ancienne et la nouvelle clé, est accepté par la synchronisation et met à jour la clé active. | Double signature vérifiée ; une seule signature valide : lot refusé. |
| CL-05 | M | Annuaire : licence (numéro et date de l'autorisation MINSANTE), titulaire et numéro ONPC, région, district de santé, coordonnées, horaires, tour de garde. Création et modification (`admin`, `referentiel`), chaque champ modifié étant audité. | Validation identique au dossier d'installation (docs/11) ; audit `pharmacy.updated` avec la liste des champs. |
| CL-06 | S | Le dossier d'installation saisi sur le nœud (docs/11) peut être envoyé au cloud par le nœud (événement `system.profile_updated` + contenu chiffré de bout en bout pour le support) : **non construit en phase B** ; l'annuaire est saisi dans le back-office. | — |

### 2.2 Passerelle de synchronisation (SY)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| SY-01 | M | `POST /sync/v1/batches` : lot de 1 à 1 000 événements consécutifs du nœud (enveloppe CloudEvents de l'annexe C), plus le point de contrôle signé du dernier événement et la correspondance `product_id → ref_code, gtin` des produits cités. Corps compressé (gzip), 10 Mo au plus. | Lot valide : 200 avec `acked` = identifiants acceptés ; requête non signée : 401 ; corps trop grand : 413. |
| SY-02 | M | Vérifications avant écriture : empreinte de chaque événement (même calcul que le nœud, `packages/protocol`), chaînage `prev_hash`, continuité de `seq` avec le dernier événement reçu du nœud, signature du point de contrôle par la clé active du nœud. | Vecteurs de l'annexe C : identiques dans `packages/protocol`, `apps/officine` et `apps/cloud`. Un octet modifié : lot refusé avec le `seq` fautif. |
| SY-03 | M | **Idempotence** : un événement déjà reçu (même identifiant, même empreinte) est accusé sans être réécrit ; un lot rejoué entièrement est accusé à l'identique. | Rejouer un lot 3 fois : 1 seule ligne par événement, mêmes accusés. |
| SY-04 | M | **Quarantaine** : une rupture de chaîne (même `seq` et empreinte différente, trou, `prev_hash` faux) ne fusionne rien ; le nœud passe en état `quarantined`, une alerte est créée pour le back-office, et les lots suivants sont refusés en 409 `chain_quarantined` jusqu'à la levée par un `admin` avec motif. | Test : fourche détectée, aucun événement de la fourche n'est écrit, alerte visible. |
| SY-05 | M | Les accusés portent la tête acceptée (`seq`, `hash`). Le nœud marque `synced_at` sur les événements accusés, et seulement eux. | Test de bout en bout nœud ↔ cloud. |
| SY-06 | M | Les événements acceptés sont publiés dans la table `outbox`, dans la même transaction ; des consommateurs idempotents (disponibilité, accusés de rappel, journal de transparence) les traitent. | Une erreur d'un consommateur ne bloque pas la réception et le traitement reprend. |
| SY-07 | M | Robustesse : 10 000 événements envoyés avec des coupures réseau aléatoires arrivent tous, une seule fois, dans l'ordre. | Scénario RB-02. |

### 2.3 Référentiel médicament (RF)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| RF-01 | M | Le référentiel est tenu dans le cloud. Champs : ceux de l'annexe I, plus le statut d'autorisation et les équivalences génériques. Import CSV (format de l'annexe I) et édition par le rôle `referentiel`. | Même validation que I-04 ; rapport d'import. |
| RF-02 | M | Publication versionnée : une version (entier croissant, sans trou) fige les fiches modifiées depuis la version précédente. Elle est signée par la clé de publication du cloud (Ed25519). | Deux publications simultanées : versions N et N+1, jamais deux N. |
| RF-03 | M | `GET /sync/v1/referential?since=N` renvoie les versions suivantes, dans l'ordre. Le nœud les applique dans l'ordre, sans toucher au stock, au prix local ni aux seuils (même règle que I-04). | Test : le nœud en version 3 reçoit 4 et 5, puis passe en 5 ; le prix local n'est pas touché. |
| RF-04 | M | Le nœud refuse une version mal signée ou non consécutive. | Signature modifiée : refus, la version du nœud reste la même. |

### 2.4 Rappels prioritaires (RA)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| RA-01 | M | Un rappel est saisi dans le back-office (rôle `admin` ou `referentiel`, MFA) : référence, produit (`ref_code`), lot ou tous les lots, motif, source, zone (tout le pays ou des régions). Il est signé par la clé de publication. | Audit `recall.broadcast`. |
| RA-02 | M | **Canal prioritaire** : `GET /sync/v1/recalls?since=N` est interrogé par le nœud toutes les 60 secondes, avant toute autre synchronisation. Le nœud applique le rappel dès sa réception (Q-01, source `DPML`), ce qui bloque la vente. | Rappel publié, nœud en ligne : vente refusée en `recalled_lot` en moins de 5 minutes (RB-05). |
| RA-03 | M | Accusé de blocage : le nœud envoie `POST /sync/v1/recalls/{id}/ack` après application. Son événement `recall.published` arrive aussi par la synchronisation. Le back-office suit les accusés par officine. | Liste des officines sans accusé après 15 minutes. |
| RA-04 | S | Clôture d'un rappel par le cloud, propagée de la même façon (Q-02). | Le lot redevient vendable. |

### 2.5 Disponibilité consolidée (DI)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| DI-01 | M | Stock par officine et par produit du référentiel (`ref_code`), dérivé des mouvements des événements reçus (`payload.movements`, correspondance produit du lot). Seuls les lots vendables comptent : ni rappelés, ni périmés, ni lot de régularisation. | Le stock d'un produit égale la somme des mouvements ; vente, annulation, réception, ajustement. |
| DI-02 | M | Fraîcheur (document 02, §15.3) : synchronisation de moins d'1 h = `disponible` ; de 1 à 24 h = `a_confirmer` ; au-delà de 24 h, l'officine n'apparaît plus dans la recherche de stock. | Tests aux bornes, horloge injectée. |
| DI-03 | M | `GET /api/v1/availability?ref_code=&region=` : réservé à l'équipe dans cette phase (pas de canal patient). Réponse : officines, quantité, fraîcheur ; aucune donnée de vente détaillée. | Droits ; tests de fraîcheur. |

### 2.6 Journal de transparence (TL)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| TL-01 | M | Chaque point de contrôle accepté (SY-02) devient une feuille d'un arbre de Merkle conforme à la RFC 9162 (§2.1 : feuille `0x00 ‖ données`, nœud `0x01 ‖ gauche ‖ droite`, SHA-256). Données de la feuille = `VPCKPT1|node_id|seq|hash|signature|kid`. | Vecteurs de test de la RFC 6962/9162 reproduits. |
| TL-02 | M | Tête d'arbre signée (STH) : taille, racine, horodatage, signée par la clé du journal (Ed25519, distincte de la clé de publication). Une nouvelle tête est émise au plus toutes les 60 s quand l'arbre change. | Signature vérifiable avec la clé publique publiée. |
| TL-03 | M | Preuves d'**inclusion** (feuille → tête) et de **cohérence** (tête m → tête n), servies publiquement : `GET /tl/v1/sth`, `/tl/v1/proof/inclusion?leaf_hash=&tree_size=`, `/tl/v1/proof/consistency?first=&second=`. | Preuves vérifiées par le vérificateur indépendant. |
| TL-04 | M | Vérificateur indépendant (`scripts/tl-verify`) : sans accès à la base, il vérifie une preuve d'inclusion d'un point de contrôle d'officine et la cohérence entre deux têtes. | RB-07. |
| TL-05 | S | Le nœud récupère la preuve d'inclusion de ses propres points de contrôle et l'affiche dans l'écran Système. | — |

### 2.7 Routage par criticité (CR)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| CR-01 | S | Les événements `demand.unmet` reçus alimentent un compteur par produit, par district et par jour. Le score combine gravité (criticité 1 à 3 de la fiche), rareté (nombre d'officines de la région avec stock disponible) et volume (demandes distinctes sur 24 h), selon les poids du document 03, §26.2. La substituabilité et la vulnérabilité ne sont pas encore disponibles. | Tests de score sur des cas chiffrés. |
| CR-02 | S | Niveaux 1, 2 et 3. Les officines de la même région qui ont le produit en stock disponible reçoivent une alerte par le canal descendant (`GET /sync/v1/alerts`) : immédiatement en niveau 1, groupée toutes les heures en niveau 2, une fois par jour en niveau 3. | Tests de routage par niveau ; aucune donnée patient dans l'alerte. |

### 2.8 Back-office (BO)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| BO-01 | M | Connexion par Keycloak (OIDC, code d'autorisation + PKCE). L'API vérifie le jeton (`jose`, JWKS, émetteur, audience, expiration) et exige l'authentification multifacteur (`amr` contient `otp`). | Jeton sans MFA, expiré ou d'un autre émetteur : 401 (RB-10). |
| BO-02 | M | Rôles à moindre privilège : `admin`, `referentiel`, `support`, `lecture`. Matrice unique côté API, testée cellule par cellule. | Test exhaustif rôle × route. |
| BO-03 | M | Journal d'audit en ajout seul (déclencheurs, comme sur le nœud) : qui, quoi, quand, adresse, objet. Tout accès à une donnée nominative (titulaire, contacts) exige un **motif** saisi, qui est journalisé. | Lecture d'une fiche titulaire sans motif : 428 `justification_required`. |
| BO-04 | M | Écrans : réseau (nœuds, versions, dernière synchronisation, nœuds silencieux de plus de 24 h, quarantaines), annuaire, jetons d'enrôlement, référentiel (import, publication), rappels (diffusion, accusés), disponibilité, journal de transparence (tête courante), audit. | Tests Playwright et axe. |

### 2.9 Exploitation (OP)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| OP-01 | M | `deploy/cloud/compose.yaml` démarre : PostgreSQL 17 primaire, réplique en flux, Keycloak (realm exporté sans secret), API cloud (qui sert aussi le back-office) et pgBackRest. TLS partout, y compris entre services, avec une autorité de développement générée par un script. | `docker compose up` puis contrôles de santé verts. |
| OP-02 | M | pgBackRest : sauvegarde complète quotidienne et archivage continu des WAL, dans un dépôt chiffré AES-256-CBC (chiffrement de pgBackRest), avec une seconde destination pour la copie hors site. | `pgbackrest check` vert ; WAL archivés. |
| OP-03 | M | `scripts/restore-test` : restauration sur un hôte vide, mesure du RPO (dernière transaction restaurée par rapport à la dernière validée) et du RTO, rapport écrit. Cible : RPO ≤ 15 min, RTO ≤ 4 h. | Rapport produit avec les mesures (RB-09). |
| OP-04 | M | `scripts/failover-test` : arrêt brutal du primaire, promotion de la réplique, reprise de l'API, mesure des pertes et de la durée, rapport. | RB-08. |
| OP-05 | M | `GET /health` (base, réplication, retard en octets) et `GET /metrics` (format Prometheus : lots reçus, refusés, quarantaines, retard de l'outbox, nœuds silencieux). Journaux JSON sans secret ni donnée de santé. | Tests ; aucun champ `payload` dans les journaux techniques. |
| OP-06 | M | Clés du cloud (publication, journal de transparence) hors de la base : fichiers 0600 dans un volume, montés en lecture seule ; empreintes publiées dans le README. | Le démarrage échoue si une clé manque. |

---

## 3. Côté nœud (apps/officine)

C'est **le seul appel réseau sortant autorisé** (GUARDRAILS 18, ADR-012). Il est désactivé par défaut et ne vise que l'adresse configurée.

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| NO-01 | M | Paramètres : `cloud_sync_enabled` (faux par défaut), `cloud_url` (HTTPS) et `cloud_spki_sha256` (empreinte épinglée), modifiables par le titulaire ré-authentifié. L'enrôlement se fait par un jeton saisi dans l'écran Système. | Sans activation, aucune connexion sortante (test : aucune requête). |
| NO-02 | M | `SyncTransport` : client HTTPS (`node:https`) avec épinglage de la clé publique, requêtes signées (§1.1), envoi par lots de la file `synced_at IS NULL`, marquage des événements accusés seulement, reprise après coupure avec attente exponentielle plafonnée à 5 minutes. | Faux certificat (autre clé) : aucune donnée envoyée. |
| NO-03 | M | `RecallFeed` : interrogation toutes les 60 s, avant l'envoi. Application du rappel dans une transaction par un compte système inactif `cloud.visionpharma` (il ne peut pas se connecter), puis accusé de blocage. | RB-05. |
| NO-04 | M | `RemoteCatalog` : versions du référentiel appliquées dans l'ordre, signature vérifiée, prix local, stock et seuils conservés. | RF-03, RF-04. |
| NO-05 | M | Écran Système → Synchronisation : état (désactivé, connecté, en échec avec la raison), dernière synchronisation, taille de la file, version du référentiel, derniers rappels reçus. | Test e2e. |

---

## 4. Scénarios de recette de la phase B

Scénarios de bout en bout : un vrai nœud `apps/officine` et un vrai `apps/cloud` sur un vrai PostgreSQL, en HTTPS.

| ID | Scénario | Attendu |
|---|---|---|
| RB-01 | Enrôler un nœud avec un jeton du back-office | Le nœud apparaît comme actif, première synchronisation acceptée |
| RB-02 | 10 000 événements envoyés avec des coupures réseau aléatoires | Tous reçus une seule fois, dans l'ordre ; la file du nœud est vide |
| RB-03 | Rejouer un lot déjà accusé | Mêmes accusés, aucune ligne de plus |
| RB-04 | Lot avec un octet modifié, puis fourche de chaîne | Lot refusé ; puis nœud en quarantaine, alerte visible |
| RB-05 | Rappel diffusé dans le back-office | Vente bloquée sur le nœud en moins de 5 minutes, accusé visible |
| RB-06 | Fraîcheur de la disponibilité | « disponible » sous 1 h, « à confirmer » de 1 à 24 h, absente au-delà |
| RB-07 | Preuve d'inclusion d'un point de contrôle d'officine | Vérifiée par `tl-verify`, sans accès à la base |
| RB-08 | Primaire arrêté brutalement | Réplique promue, API reprise ; perte et durée mesurées dans le rapport |
| RB-09 | Restauration depuis pgBackRest sur un hôte vide | RPO et RTO mesurés et sous les cibles |
| RB-10 | Connexion au back-office sans second facteur | Refusée |

## 5. Écrans du back-office

BUI-01 connexion (Keycloak), BUI-02 tableau du réseau, BUI-03 fiche nœud (versions, synchronisation, quarantaine, révocation), BUI-04 annuaire et fiche officine, BUI-05 jetons d'enrôlement, BUI-06 référentiel (import, publication), BUI-07 rappels (diffusion, accusés), BUI-08 disponibilité, BUI-09 journal de transparence, BUI-10 audit.
