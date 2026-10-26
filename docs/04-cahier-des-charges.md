<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Cahier des charges VisionPharma

Ce cahier des charges suit la structure de **ISO/IEC/IEEE 29148:2018** (spécification des exigences) et classe la qualité selon **ISO/IEC 25010:2023**. Chaque exigence porte un identifiant stable, une priorité MoSCoW et un critère de vérification. La sécurité vise **OWASP ASVS 5.0 niveau 2** sur tout le système, et le **niveau 3** pour l'authentification, la cryptographie et le journal des transactions.

Le périmètre est l'écosystème complet. Seul le **nœud pharmacie (VisionPharma Officine)** fait partie de la première livraison. Ses exigences détaillées et testables sont dans [05-mvp-officine-spec.md](05-mvp-officine-spec.md).

---

## 1. Objet et contexte

### 1.1 Objet

Construire VisionPharma, l'infrastructure de données du médicament au Cameroun :
- un logiciel de gestion d'officine qui fonctionne hors ligne ;
- un cœur de données cloud ;
- des canaux patient (app, WhatsApp, USSD) ;
- un portail partenaires (VisionPharma Connect) ;
- un Observatoire.

La vision et les choix produit sont dans les documents [01](01-vision-strategie.md), [02](02-specifications-composants.md) et [03](03-fonctionnalites-avancees.md).

### 1.2 Parties prenantes

| Partie prenante | Attente principale |
|---|---|
| Titulaire d'officine | Un outil plus rapide que le cahier, fiable sans réseau, qui réduit les pertes |
| Pharmacien, préparateur, caissier | Une caisse rapide, des alertes claires, aucune vente bloquée sans raison |
| Patient | Trouver, comparer, réserver ; protection de ses données |
| Ordre national des pharmaciens, DPML, LANACOME | Respect de la réglementation, traçabilité, rappels effectifs |
| Autorité de protection des données | Conformité à la loi n° 2024/017 |
| ONG, assureurs, grossistes, livreurs | Des API fiables, sécurisées, documentées |
| Équipe VisionPharma et agents IA de développement | Des exigences claires, testables, sans ambiguïté |

### 1.3 Définitions

Voir [annexes/A-glossaire.md](../annexes/A-glossaire.md).

---

## 2. Référentiel normatif

Les normes ci-dessous sont **appliquées** (A), c'est-à-dire que la conformité est vérifiée, ou **de référence** (R), c'est-à-dire qu'elles guident la conception sans audit formel au MVP.

### 2.1 Ingénierie et qualité

| Norme | Statut | Usage dans le projet |
|---|---|---|
| ISO/IEC/IEEE 29148:2018 | A | Structure et rédaction des exigences |
| ISO/IEC 25010:2023 | A | Modèle de qualité (section 6) |
| ISO/IEC/IEEE 12207:2017 | R | Processus du cycle de vie logiciel |
| ISO/IEC/IEEE 29119 | R | Stratégie et documentation de test |
| NIST SP 800-218 (SSDF 1.1) | A | Développement sécurisé : revue, analyse, gestion des vulnérabilités |
| SLSA v1.0, niveau 2 au MVP puis 3 | A | Intégrité de la chaîne de build |
| SBOM CycloneDX 1.6 ou SPDX 2.3 | A | Inventaire des dépendances livré avec chaque version |

### 2.2 Sécurité de l'information et santé

| Norme | Statut | Usage |
|---|---|---|
| ISO/IEC 27001:2022 et 27002:2022 | R au MVP, A visée à 24 mois | Système de management de la sécurité, mesures de l'annexe A |
| ISO 27799:2025 | R | Sécurité de l'information de santé |
| ISO/IEC 27701 | R | Management de la vie privée |
| ISO/IEC 27017 et 27018 | R | Sécurité et données personnelles dans le cloud (composants cloud) |
| NIST Cybersecurity Framework 2.0 | R | Organisation : gouverner, identifier, protéger, détecter, répondre, rétablir |
| ISO 22301:2019 | R | Continuité d'activité |
| ISO 31000:2018 | R | Méthode de gestion des risques |

### 2.3 Sécurité applicative et identité

| Norme | Statut | Usage |
|---|---|---|
| OWASP ASVS 5.0 | A | Niveau 2 partout ; niveau 3 pour l'authentification, la gestion de session, la cryptographie et la journalisation |
| OWASP Top 10 (dernière édition) et OWASP API Security Top 10 2023 | A | Liste de contrôle en revue de code et en test |
| OWASP MASVS 2 | A (app mobile) | Sécurité de l'application patient |
| NIST SP 800-63-4 | A | Mots de passe, authentification multifacteur, sessions |
| OAuth 2.0 (RFC 6749) avec les recommandations de sécurité RFC 9700, OpenID Connect Core 1.0 | A (cloud et Connect) | Identité des utilisateurs et des partenaires |

### 2.4 Cryptographie

| Norme | Statut | Usage |
|---|---|---|
| TLS 1.3 (RFC 8446), TLS 1.2 minimum avec suites AEAD | A | Tous les transports |
| AES-256-GCM (NIST SP 800-38D) | A | Chiffrement au repos des fichiers, sauvegardes, champs sensibles |
| SHA-256 (FIPS 180-4) | A | Chaînage du journal, empreintes |
| Ed25519 (RFC 8032) | A | Signature des points de contrôle du journal |
| scrypt (RFC 7914) ou Argon2id (RFC 9106) | A | Dérivation de clés et hachage des mots de passe |
| JSON Canonicalization Scheme (RFC 8785) | A | Forme canonique des événements avant hachage |
| Arbres de Merkle façon RFC 9162 (Certificate Transparency 2.0) | A (cloud), R (nœud) | Preuves d'inclusion et de cohérence du journal |
| Horodatage RFC 3161 | R | Ancrage temporel opposable des points de contrôle |
| NIST SP 800-57 | A | Cycle de vie et rotation des clés |
| FIPS 140-3 | R | Modules cryptographiques validés quand l'hébergeur les propose |
| FIPS 203 (ML-KEM), FIPS 204 (ML-DSA) | R | Plan de migration post-quantique (section 7.6) |

### 2.5 Interopérabilité et données

| Norme | Statut | Usage |
|---|---|---|
| HL7 FHIR R4 (4.0.1), compatible R5 | A (cloud, Connect) | Ordonnances, dispensation, produits, structures de santé |
| GS1 GTIN, GS1 DataMatrix, Application Identifiers (01, 10, 17, 21) | A | Identification des produits ; lecture du lot et de la péremption au scan |
| GS1 EPCIS 2.0 | R | Événements de traçabilité de la chaîne d'approvisionnement |
| CloudEvents 1.0.2 | A | Enveloppe de tous les événements échangés |
| OpenAPI 3.1 | A | Contrats de toutes les API |
| ISO 8601, ISO 4217 (XAF), ISO 3166-1 (CM), E.164, UTF-8 | A | Dates, monnaie, pays, téléphones, texte |
| DHIS2 Web API, ADX | A (Observatoire) | Export vers le système national d'information sanitaire |

### 2.6 Accessibilité, IA et dispositifs

| Norme | Statut | Usage |
|---|---|---|
| WCAG 2.2 niveau AA | A | Interfaces web, de bureau et mobile |
| ISO/IEC 42001:2023 | R | Système de management de l'IA |
| ISO/IEC 23894:2023 et NIST AI RMF 1.0 | R | Gestion des risques liés à l'IA |
| IEC 62304 et ISO 14971 | R | Discipline de cycle de vie et d'analyse de risque pour les fonctions d'aide à la dispensation (interactions, lecture d'ordonnance). Le MVP n'est pas un dispositif médical : il ne diagnostique ni ne prescrit. |
| OpenTelemetry | A (cloud) | Traces, métriques et journaux techniques |

### 2.7 Cadre légal

| Texte | Effet sur le projet |
|---|---|
| Loi n° 2024/017 du 23 décembre 2024 sur les données personnelles, en vigueur le 23 juin 2026 | Base légale, consentement, analyse d'impact, délégué à la protection des données, autorisation préalable pour tout transfert hors du Cameroun, droits des personnes |
| Loi n° 2010/012 sur la cybersécurité et la cybercriminalité | Sécurité des systèmes, conservation des traces |
| Loi n° 90/035 sur l'exercice de la pharmacie, article 53 | Interdiction de vendre sur la voie publique : on réserve, on ne vend pas en ligne |
| Règle de l'ordonnance obligatoire, depuis le 1er juillet 2024 | Chaque délivrance concernée est liée à une ordonnance validée |
| Règlementation COBAC et BEAC sur les paiements | Mobile Money uniquement via un agrégateur agréé ; aucune détention de fonds par VisionPharma |
| PCI DSS v4.0.1 | Non applicable au MVP (pas de carte) ; obligatoire si un paiement par carte est un jour traité directement |
| RGPD (UE) | Référence de bonnes pratiques et exigence si un hébergement dans l'UE est autorisé |

---

## 3. Périmètre et lots

| Lot | Composant | Livraison | Document de référence |
|---|---|---|---|
| **L0** | **VisionPharma Officine, autonome** | **Première livraison, sous 14 jours** | [05-mvp-officine-spec.md](05-mvp-officine-spec.md) |
| L1 | Cœur de données et synchronisation | Après L0 | [02](02-specifications-composants.md), sections 14 et 15 |
| L2 | Canal patient WhatsApp | Après L1 | [02](02-specifications-composants.md), section 16 |
| L3 | Back-office | Avec L1 | [02](02-specifications-composants.md), section 17 |
| L4 | Connect, Observatoire, app mobile | V2 | [02](02-specifications-composants.md), sections 18 et 19 |
| L5 | Module dispensaire, assistant vocal | V3 | [02](02-specifications-composants.md), sections 20 et 21 |

**Contrainte de conception de L0** : l'officine doit fonctionner seule, mais chaque donnée qu'elle produit est déjà au format d'échange final (événements CloudEvents, identifiants UUID, référentiel commun). Le branchement au cloud ne doit demander aucune migration de données.

---

## 4. Exigences fonctionnelles de haut niveau

Format : `ID · priorité · exigence · vérification`. Priorités : **M** (Must), **S** (Should), **C** (Could), **W** (Won't, pas dans ce cycle).

### 4.1 Officine (L0) — résumé

Le détail testable de chaque exigence est dans le document 05.

| ID | Prio | Exigence | Vérification |
|---|---|---|---|
| FR-OFF-01 | M | Le logiciel fonctionne entièrement sans Internet, sur le réseau local de l'officine, avec plusieurs postes simultanés | Test hors ligne, 5 postes |
| FR-OFF-02 | M | Les comptes ont quatre rôles (titulaire, pharmacien, préparateur, caissier), et les droits sont contrôlés côté serveur | Tests d'autorisation |
| FR-OFF-03 | M | Le catalogue dormant est préchargé ; une fiche s'active au premier événement réel | Tests C-01 à C-06 |
| FR-OFF-04 | M | Le stock est tenu par lot, avec sortie FEFO, et calculé comme somme de mouvements en ajout seul | Tests S-01 à S-08 |
| FR-OFF-05 | M | La caisse gère les ventes multi-lignes, plusieurs modes de paiement, l'annulation tracée et la clôture | Tests V-01 à V-10 |
| FR-OFF-06 | M | Toute délivrance qui l'exige est liée à une ordonnance validée par un pharmacien | Tests O-01 à O-05 |
| FR-OFF-07 | M | Un lot rappelé ou périmé ne peut pas être vendu | Tests Q-01 à Q-04 |
| FR-OFF-08 | M | Les commandes fournisseurs sont suggérées et les réceptions rapprochées | Tests R-01 à R-06 |
| FR-OFF-09 | M | Les demandes non satisfaites au comptoir sont capturées | Tests D-01 à D-03 |
| FR-OFF-10 | M | Les rapports de clôture, de péremptions, de ventes, de stock et de conformité sont produits | Tests P-01 à P-07 |
| FR-OFF-11 | M | Un journal intègre et chaîné est vérifiable à tout moment | Tests J-01 à J-06 |
| FR-OFF-12 | M | Les sauvegardes sont chiffrées, automatiques, et la restauration est vérifiée | Tests B-01 à B-05 |
| FR-OFF-13 | S | Le statut de garde est géré | Test G-01 |
| FR-OFF-14 | S | Des alertes de fraude interne de base sont produites (annulations, écarts de caisse) | Test P-08 |
| FR-OFF-15 | M | Les postes utilisent une application de bureau Tauri 2 signée, appairée au serveur, qui vérifie son certificat, imprime en ESC/POS et se met à jour depuis le serveur avec des paquets signés | Tests W-01 à W-08 |

### 4.2 Cœur de données (L1)

| ID | Prio | Exigence | Vérification |
|---|---|---|---|
| FR-CORE-01 | M | Les lots d'événements des nœuds sont reçus, avec dédoublonnage par identifiant et accusé de réception | Test d'idempotence |
| FR-CORE-02 | M | Le référentiel médicament versionné est publié, et les mises à jour différentielles sont envoyées aux nœuds | Test de propagation |
| FR-CORE-03 | M | Un rappel de lot est propagé en priorité ; il est bloquant sur le nœud dès sa réception | Test de bout en bout, moins de 5 minutes quand le nœud est en ligne |
| FR-CORE-04 | M | La disponibilité consolidée par produit et par officine est fournie, avec sa fraîcheur | Test des seuils de 1 h et 24 h |
| FR-CORE-05 | M | Les points de contrôle des nœuds sont vérifiés et ancrés dans un journal de transparence (arbre de Merkle) | Preuve d'inclusion vérifiable |
| FR-CORE-06 | M | L'identité et les accès reposent sur OIDC, avec authentification multifacteur pour les rôles sensibles | Test d'authentification |
| FR-CORE-07 | M | Le registre des consentements est révocable, avec preuve | Test de révocation |
| FR-CORE-08 | S | Le service de criticité route les demandes non satisfaites (document 03, section 26) | Tests de routage par niveau |

### 4.3 Canaux patient (L2, L4)

| ID | Prio | Exigence | Vérification |
|---|---|---|---|
| FR-PAT-01 | M | La recherche d'un produit renvoie les officines qui l'ont, avec la fraîcheur de l'information | Test des seuils |
| FR-PAT-02 | M | La réservation n'est confirmée qu'après validation du pharmacien, puis l'acompte est demandé | Test de séquence |
| FR-PAT-03 | M | Aucune vente en ligne, aucun conseil médical personnalisé | Revue et test des réponses de l'assistant |
| FR-PAT-04 | M | Connexion par numéro E.164 et code à usage unique ; limitation de débit | Test d'authentification |
| FR-PAT-05 | S | Alerte « de retour en stock » | Test de notification |

### 4.4 Connect et Observatoire (L4)

| ID | Prio | Exigence | Vérification |
|---|---|---|---|
| FR-CON-01 | M | OAuth2 par identifiants client, avec des périmètres par usage | Test de refus hors périmètre |
| FR-CON-02 | M | Webhooks signés (HMAC-SHA256), horodatés, avec rejeu protégé | Test de signature et de fenêtre temporelle |
| FR-CON-03 | M | Ressources FHIR R4 pour les ordonnances et la dispensation | Validation avec un validateur FHIR |
| FR-OBS-01 | M | Seul un agrégat d'au moins 5 officines peut être publié | Test de suppression des petits effectifs |
| FR-OBS-02 | S | Export DHIS2 | Test d'import dans une instance de test |

---

## 5. Exigences d'interface

| ID | Exigence |
|---|---|
| IF-01 | Toutes les API HTTP sont décrites en OpenAPI 3.1 et versionnées dans le chemin (`/v1`). |
| IF-02 | Tous les événements utilisent l'enveloppe CloudEvents 1.0.2 en JSON ; schémas dans [annexes/C-evenements.md](../annexes/C-evenements.md). |
| IF-03 | Le lecteur de codes-barres est un périphérique en émulation clavier (USB HID) ; le logiciel décode les GS1 DataMatrix (AI 01 GTIN, 10 lot, 17 péremption, 21 série). |
| IF-04 | L'impression des tickets se fait sur une imprimante thermique 80 mm, en ESC/POS directement depuis l'application de bureau (USB ou réseau), ou par le pilote du système en secours. |
| IF-07 | L'application de bureau ne communique qu'avec le serveur appairé, en HTTPS, et n'expose à l'interface que trois commandes natives (W-05). |
| IF-05 | L'import du catalogue se fait en CSV UTF-8, au format de [annexes/I-format-import-catalogue.md](../annexes/I-format-import-catalogue.md). |
| IF-06 | Les exports comptables sont en CSV UTF-8, séparateur point-virgule, montants entiers en XAF. |

---

## 6. Exigences de qualité (ISO/IEC 25010:2023)

| Caractéristique | ID | Exigence mesurable |
|---|---|---|
| Adéquation fonctionnelle | NFR-FS-01 | 100 % des critères d'acceptation M du document 05 passent en recette |
| Efficacité de performance | NFR-PE-01 | Scan d'un article jusqu'à la ligne affichée : moins de 300 ms au 95e centile sur le matériel de référence |
| | NFR-PE-02 | Recherche dans un catalogue de 50 000 fiches : moins de 150 ms au 95e centile |
| | NFR-PE-03 | Validation d'une vente de 10 lignes : moins de 500 ms au 95e centile, avec 10 postes actifs |
| Compatibilité | NFR-CO-01 | Application de bureau sur Windows 10/11 x64 et Ubuntu 24.04 Desktop ; en secours, Chrome, Edge ou Firefox des deux dernières versions majeures ; écran minimum de 1280 × 720 |
| | NFR-CO-02 | Application de bureau : installateur de moins de 20 Mo (hors chargeur WebView2), moins de 200 Mo de mémoire au repos sur un poste de 4 Go |
| Capacité d'interaction (utilisabilité) | NFR-IC-01 | Un caissier novice réalise une vente de 3 articles en moins de 60 secondes après 1 heure de formation |
| | NFR-IC-02 | Caisse entièrement utilisable au clavier ; WCAG 2.2 AA |
| Fiabilité | NFR-RE-01 | Aucune perte de transaction validée en cas de coupure de courant (base en journal WAL, `synchronous=FULL`, onduleur) |
| | NFR-RE-02 | Le nœud fonctionne au moins 30 jours sans Internet |
| | NFR-RE-03 | RPO du nœud : 0 transaction validée. RTO après panne du serveur local : moins de 2 heures avec une sauvegarde |
| Sécurité | NFR-SE-01 | OWASP ASVS 5.0 niveau 2 vérifié ; niveau 3 pour les chapitres authentification, sessions, cryptographie et journalisation |
| | NFR-SE-02 | Zéro vulnérabilité critique ou élevée connue dans les dépendances au moment de la livraison |
| Maintenabilité | NFR-MA-01 | Couverture de tests du code métier (domaine) d'au moins 85 % des lignes et 100 % des invariants listés |
| | NFR-MA-02 | Typage strict, lint sans erreur, aucune fonction de plus de 60 lignes dans le domaine |
| Flexibilité (portabilité) | NFR-FL-01 | Installation en moins de 30 minutes sur une machine vierge à partir de l'image livrée |
| Sûreté (safety) | NFR-SF-01 | Aucune fonction ne délivre un lot rappelé ou périmé, ni un produit soumis à ordonnance sans ordonnance validée (tests bloquants) |

---

## 7. Exigences de sécurité

### 7.1 Principes

1. **Défense en profondeur** : réseau, application, données, journal.
2. **Moindre privilège** pour chaque rôle, chaque service et chaque partenaire.
3. **Sécurité par défaut** : TLS actif, aucun compte par défaut, mots de passe forts imposés.
4. **Données minimales** pour chaque destinataire.
5. **Tout est tracé** dans un journal qui ne peut pas être modifié sans que cela se voie.

### 7.2 Authentification et sessions (NIST SP 800-63-4, ASVS chapitres 6 et 7)

| ID | Exigence |
|---|---|
| SEC-AU-01 | Mots de passe d'au moins 12 caractères, sans règle de composition imposée, comparés à une liste de mots de passe compromis ou courants ; jamais de rotation forcée sans compromission. |
| SEC-AU-02 | Hachage scrypt (N = 2^17, r = 8, p = 1) ou Argon2id (m = 19 Mio, t = 2, p = 1 au minimum), avec sel unique par compte. |
| SEC-AU-03 | Second facteur TOTP (RFC 6238) obligatoire pour le titulaire et pour toute action d'administration ; recommandé pour les pharmaciens. |
| SEC-AU-04 | Verrouillage progressif après 5 échecs (15 minutes), journalisé ; limitation de débit par adresse IP. |
| SEC-AU-05 | Jeton de session aléatoire de 256 bits, stocké uniquement sous forme d'empreinte côté serveur ; cookie `HttpOnly`, `Secure`, `SameSite=Strict`. |
| SEC-AU-06 | Expiration après 30 minutes d'inactivité et 12 heures au maximum ; déconnexion de toutes les sessions possible par le titulaire. |
| SEC-AU-07 | Ré-authentification exigée pour les actions sensibles : annulation de vente, ajustement de stock, création d'un rappel, gestion des comptes, restauration. |

### 7.3 Contrôle d'accès

| ID | Exigence |
|---|---|
| SEC-AC-01 | Chaque route est refusée par défaut ; l'autorisation est vérifiée côté serveur à partir d'une matrice rôle × action unique. |
| SEC-AC-02 | Les décisions d'autorisation sont testées automatiquement pour chaque rôle et chaque route. |
| SEC-AC-03 | Le support VisionPharma n'accède au nœud qu'avec l'accord du titulaire, pour une durée limitée, et chaque accès est tracé. |

### 7.4 Protection des données

| ID | Exigence |
|---|---|
| SEC-DA-01 | Toutes les connexions sont en TLS, y compris sur le réseau local (certificat généré à l'installation, empreinte affichée pour vérification). |
| SEC-DA-02 | Les images d'ordonnance et les sauvegardes sont chiffrées en AES-256-GCM, avec une clé de données propre à l'officine. |
| SEC-DA-03 | Les clés sont stockées hors de la base, avec des droits de fichier en 0600, et une clé de récupération est imprimée et remise au titulaire à l'installation. |
| SEC-DA-04 | Les données patient sont réduites au minimum au MVP : pseudonyme ou initiales, aucun numéro national d'identité. |
| SEC-DA-05 | Les durées de conservation sont paramétrées par type de donnée et appliquées par une tâche planifiée. |
| SEC-DA-06 | Aucune télémétrie ni aucun appel réseau sortant au MVP ; tout appel réseau futur est explicite et configurable. |

### 7.5 Intégrité transactionnelle : le journal chaîné

L'objectif est d'atteindre le niveau de garantie d'un registre distribué (ajout seul, falsification détectable, non-répudiation) **sans blockchain publique**. Une chaîne publique n'apporterait ni confidentialité ni gain de confiance pour un système à opérateurs identifiés, et elle ajouterait des coûts, de la latence et une dépendance réseau.

| ID | Exigence |
|---|---|
| SEC-LG-01 | Chaque transaction métier produit un événement immuable, numéroté sans trou (`seq`) et identifié par un UUID. |
| SEC-LG-02 | Chaque événement contient le SHA-256 de l'événement précédent. L'empreinte porte sur la forme canonique RFC 8785 de l'événement. |
| SEC-LG-03 | Un point de contrôle signé en Ed25519 par la clé du nœud scelle la chaîne au moins tous les 100 événements, à chaque clôture de caisse et chaque jour. |
| SEC-LG-04 | Les tables d'événements, de mouvements de stock et de points de contrôle refusent toute modification et toute suppression au niveau de la base (déclencheurs). |
| SEC-LG-05 | Les états dérivés (stock par lot, totaux de caisse) peuvent être recalculés depuis les événements ; la vérification compare ce recalcul à l'état stocké. |
| SEC-LG-06 | Une commande de vérification signale le premier événement altéré, le point de contrôle invalide ou l'écart de projection, avec son numéro. |
| SEC-LG-07 | À partir de L1, les points de contrôle sont envoyés au cloud et inscrits dans un journal de transparence en arbre de Merkle (RFC 9162). Les preuves d'inclusion et de cohérence peuvent être vérifiées par un tiers (Ordre, auditeur). |
| SEC-LG-08 | (R) Ancrage quotidien de la racine de Merkle par un horodatage RFC 3161 auprès d'une autorité de confiance. |

La spécification technique complète est dans [06-architecture-securite.md](06-architecture-securite.md).

### 7.6 Agilité cryptographique

| ID | Exigence |
|---|---|
| SEC-CR-01 | Chaque élément chiffré ou signé porte l'identifiant de l'algorithme et de la clé (`alg`, `kid`) pour permettre la rotation et le changement d'algorithme. |
| SEC-CR-02 | Seules les primitives de la section 2.4 sont autorisées ; aucune cryptographie maison. |
| SEC-CR-03 | Plan post-quantique : TLS hybride (X25519 + ML-KEM-768) dès que les bibliothèques et l'hébergeur le permettent ; signatures des points de contrôle doublées en ML-DSA quand elles sont disponibles dans l'environnement d'exécution. |

### 7.7 Chaîne logicielle (SSDF, SLSA)

| ID | Exigence |
|---|---|
| SEC-SC-01 | Les dépendances sont figées (fichier de verrouillage) et analysées à chaque build ; aucune vulnérabilité critique ou élevée n'est tolérée. |
| SEC-SC-02 | Un SBOM CycloneDX est produit à chaque version. |
| SEC-SC-03 | Les builds se font en CI à partir de la branche principale protégée ; les artefacts et images sont signés (Sigstore cosign ou équivalent). |
| SEC-SC-04 | Une analyse statique (SAST) et une détection de secrets tournent à chaque demande de fusion. |
| SEC-SC-05 | Les mises à jour du nœud sont des paquets signés, vérifiés avant installation, avec retour arrière automatique. |
| SEC-SC-06 | Les installateurs de l'application de bureau sont signés (Authenticode sous Windows ; notarisation sous macOS si cette plateforme est livrée) ; ses mises à jour sont signées en Ed25519 et vérifiées avant installation. |
| SEC-SC-07 | L'application de bureau ne charge que l'origine du serveur appairé, épingle son autorité de certification, et n'active aucune capacité Tauri en dehors de la liste de W-05. |

### 7.8 Détection, réponse et continuité

| ID | Exigence |
|---|---|
| SEC-OP-01 | Les événements de sécurité (connexions, échecs, verrouillages, changements de droits, annulations, restaurations) sont journalisés dans le journal chaîné. |
| SEC-OP-02 | Un plan de réponse aux incidents prévoit la notification à l'Autorité de protection des données et aux personnes concernées. |
| SEC-OP-03 | Une sauvegarde chiffrée quotidienne est faite sur le disque local et sur un support amovible ; la restauration est testée chaque mois. |
| SEC-OP-04 | Des tests d'intrusion sont réalisés avant la mise en production pilote, puis chaque année. |

---

## 8. Exigences liées à l'IA

| ID | Exigence |
|---|---|
| AI-01 | L'IA ne diagnostique jamais et ne prescrit jamais. |
| AI-02 | Toute suggestion qui touche à la délivrance (lecture d'ordonnance, substitution, interaction) est validée par un pharmacien identifié. |
| AI-03 | Chaque suggestion est journalisée : modèle, version, entrée (empreinte), sortie, décision humaine. |
| AI-04 | Chaque modèle peut être désactivé par officine. |
| AI-05 | Les données d'entraînement sont pseudonymisées ; aucune ordonnance nominative ne sort du périmètre de l'officine sans consentement. |
| AI-06 | Au MVP L0, aucune fonction d'IA ne dépend du réseau : la lecture d'ordonnance par IA arrive avec L1, derrière une interface déjà prévue. |

---

## 9. Contraintes

| ID | Contrainte |
|---|---|
| CT-01 | Matériel de référence du nœud : mini-PC x86-64, 4 cœurs, 8 Go de mémoire, SSD de 256 Go, Ubuntu Server 24.04 LTS, onduleur d'au moins 30 minutes. |
| CT-02 | Postes : PC existants sous Windows 10/11 x64 ou Ubuntu 24.04 Desktop avec l'application de bureau ; tablette ou autre poste en navigateur récent en secours ; réseau local filaire ou Wi-Fi WPA2/WPA3. |
| CT-03 | Langue de l'interface : français au MVP, anglais en S ; textes externalisés pour la traduction. |
| CT-04 | Monnaie : XAF en entiers, sans décimale. |
| CT-05 | Heure : stockée en UTC, affichée en heure du Cameroun (UTC+1, Africa/Douala). |
| CT-06 | Pile technique du MVP : voir [annexes/H-adr.md](../annexes/H-adr.md), décisions ADR-001 à ADR-011. |

---

## 10. Vérification et acceptation

| Moyen | Ce qui est vérifié |
|---|---|
| Tests unitaires et de domaine | Invariants de stock, de caisse, d'ordonnance, de rappel et de journal |
| Tests d'intégration de l'API | Chaque route, chaque rôle, chaque erreur prévue |
| Tests de bout en bout (navigateur) | Les parcours de recette du document [08](08-tests-et-recette.md) |
| Tests de résistance | 10 postes, 10 000 ventes simulées sur une journée, coupure de courant pendant une vente |
| Revue de sécurité | Liste de contrôle ASVS 5.0, analyse des dépendances, test d'intrusion |
| Recette métier | Deux pharmaciens réalisent les scénarios de recette sur des données de démonstration |

**Critère de livraison de L0** : toutes les exigences M du document 05 passent ; NFR-SE-01, NFR-SE-02 et NFR-SF-01 sont vérifiées ; le kit d'évaluation pour les experts ([annexes/J-kit-experts.md](../annexes/J-kit-experts.md)) est complet.

---

## 11. Traçabilité

Chaque exigence de ce document renvoie à une section de vision (documents 01 à 03). Chaque exigence M de L0 renvoie à au moins un test. La matrice de traçabilité est maintenue dans [08-tests-et-recette.md](08-tests-et-recette.md), section 4.
