<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Spécification de construction — VisionPharma Officine (MVP L0)

Ce document est la source de vérité pour construire le premier livrable : un logiciel de gestion d'officine **réel, autonome et prêt pour la production**, qui tourne sur un serveur local dans l'officine, sans Internet. Les postes de travail utilisent une **application de bureau Tauri 2** (ADR-011) ; un navigateur reste possible en secours. Il est écrit pour être exécuté par des agents IA de développement (Qoder) sous la supervision d'un tech lead humain.

Toute exigence porte un identifiant (`S-03`, `V-07`, etc.). Les tests portent le même identifiant dans leur nom.

---

## 0. Règle « sans émulation »

Le MVP doit fonctionner pour de vrai, pas en démonstration.

1. **Aucun bouchon (mock) ni faux service dans le code de production.** Les bouchons sont autorisés uniquement dans `test/`.
2. **Toute fonction visible fonctionne de bout en bout** avec persistance réelle. Une fonction qui n'est pas prête est **absente** de l'interface : pas de bouton « bientôt disponible ».
3. **Pas de données inventées** dans l'application. Le seul jeu de données livré est l'échantillon de catalogue, marqué comme tel ; le vrai catalogue est importé (I-04).
4. **Les intégrations externes** (cloud, Mobile Money, WhatsApp, IA) sont **hors périmètre**. Leur place est prévue par des interfaces documentées, mais **rien ne simule leur réponse**. Un paiement Mobile Money est enregistré avec la référence de transaction saisie par le caissier.
5. **Démarrable par un tiers** : un expert doit pouvoir installer, initialiser et utiliser le logiciel en suivant seulement le `README` de l'application.

---

## 1. Périmètre

### 1.1 Dans le MVP

| Module | Code | Résumé |
|---|---|---|
| Installation et initialisation | I | Premier démarrage, compte titulaire, clés, certificat TLS, import du catalogue |
| Authentification et comptes | A, U | Connexion, TOTP, sessions, rôles, gestion des comptes |
| Catalogue dormant | C | Référentiel préchargé, activation au premier événement, fiches locales, codes-barres |
| Stock et lots | S | Lots, FEFO, ajustements, inventaire, destruction, stock comme somme de mouvements |
| Réception et commandes | R | Fournisseurs, suggestion de commande, bons de commande, réception, retours |
| Caisse et ventes | V | Sessions de caisse, ventes, paiements, tickets, annulations, clôture |
| Ordonnances | O | Saisie, photo chiffrée, validation par un pharmacien, lien avec la vente |
| Sécurité sanitaire | Q | Rappels de lots, péremptions, produits sensibles |
| Demande non satisfaite | D | Capture au comptoir, liste, résolution |
| Rapports | P | Clôture, péremptions, ventes, stock valorisé, stock immobilisé, conformité, fraude |
| Journal intègre | J | Chaîne d'événements, points de contrôle signés, vérification, file d'envoi |
| Sauvegarde et restauration | B | Sauvegarde chiffrée planifiée, copie miroir, restauration vérifiée |
| Garde | G | Statut de garde et horaires |

### 1.2 Hors du MVP (ne pas construire)

- Synchronisation cloud, référentiel distant, rappels reçus du cloud. La file d'envoi **existe** (J-05), mais rien ne l'envoie.
- Canaux patient, réservations, Connect, Observatoire.
- Lecture d'ordonnance par IA, prévision par IA. La suggestion de commande du MVP est une règle déterministe (R-02).
- Intégration Mobile Money ou carte bancaire : on enregistre une référence saisie à la main.
- Tiers payant électronique : la méthode `tiers_payant` enregistre la part et l'organisme, sans facturation électronique.
- Application mobile.

---

## 2. Pile technique imposée

Les justifications sont dans [annexes/H-adr.md](../annexes/H-adr.md).

| Couche | Choix |
|---|---|
| Langage | TypeScript 5, mode `strict`, ESM |
| Exécution | Node.js 24 LTS |
| Serveur HTTP | Fastify 5, schémas JSON (TypeBox) sur chaque route, en entrée et en sortie |
| Base de données | SQLite 3 via `better-sqlite3`, mode WAL, `foreign_keys=ON`, `synchronous=FULL`, transactions `BEGIN IMMEDIATE` pour toute écriture |
| Migrations | Fichiers SQL numérotés, appliqués au démarrage, jamais modifiés une fois publiés |
| Interface | React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui (Radix) ; aucune ressource chargée depuis Internet ; build statique servi par le serveur (section 8) |
| Application de bureau des postes | Tauri 2 (cœur Rust) qui affiche l'interface servie par le serveur appairé ; Windows 10/11 x64 et Ubuntu 24.04 Desktop ; macOS en option (section 8 bis, ADR-011) |
| Cryptographie | Module `node:crypto` uniquement (scrypt, AES-256-GCM, Ed25519, SHA-256, `randomBytes`) |
| Tests | Vitest (unitaires et intégration), Playwright (bout en bout) |
| Qualité | ESLint (recommandé + règles de sécurité), Prettier, `tsc --noEmit` |
| Livraison | Serveur : image Docker multi-étapes non-root **et** installation native avec service systemd sur Ubuntu Server 24.04 LTS. Postes : installateurs Tauri signés (MSI ou NSIS pour Windows, .deb pour Ubuntu) |

Dépendances de production limitées à : `fastify`, `@fastify/static` (version sans vulnérabilité connue), `@fastify/cookie`, `@sinclair/typebox`, `better-sqlite3`. Toute autre dépendance de production doit être justifiée dans une ADR.

Dépendances de l'interface (embarquées dans le build, jamais chargées depuis Internet) : `react`, `react-dom`, `tailwindcss`, composants `shadcn/ui` et primitives `@radix-ui/*`, `cmdk`, `react-resizable-panels`, `motion`, `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-hook-form`, `zod`, `lucide-react`, `sonner`, `recharts`, polices Inter ou Geist en fichiers locaux.

Dépendances de l'application de bureau (Rust) : `tauri` 2, `tauri-plugin-updater`, `tauri-plugin-single-instance`, `tauri-plugin-window-state`, `rustls` (vérification du certificat), et une bibliothèque ESC/POS pour l'impression. Les plugins `shell`, `fs`, `http` et tout plugin d'accès large au système sont **interdits**.

---

## 3. Arborescence attendue

```
apps/officine/
  README.md                 # installation, exploitation, dépannage
  package.json
  server/
    src/
      config.ts             # lecture de l'environnement, valeurs par défaut sûres
      app.ts                # construction de l'instance Fastify (testable)
      main.ts               # démarrage HTTPS, tâches planifiées
      db/
        index.ts            # ouverture, pragmas, exécuteur de migrations
        migrations/001_init.sql
      domain/               # règles métier pures, sans HTTP
        ledger.ts           # chaîne d'événements, points de contrôle, vérification
        catalog.ts
        stock.ts            # FEFO, mouvements, inventaire
        sales.ts
        cash.ts
        prescriptions.ts
        recalls.ts
        orders.ts
        demand.ts
        reports.ts
      security/
        passwords.ts        # scrypt, liste de mots de passe interdits
        totp.ts             # RFC 6238
        sessions.ts
        rbac.ts             # matrice rôle × action, unique source de vérité
        crypto.ts           # AES-256-GCM, gestion des clés
      http/
        routes/*.ts         # une route = un schéma + une permission + un appel de domaine
        hooks.ts            # en-têtes de sécurité, CSRF, authentification
      jobs/
        backup.ts
        checkpoints.ts
        retention.ts
    test/
  web/
    src/                    # écrans React (design system en section 8)
      components/ui/        # composants shadcn/ui générés dans le dépôt
      styles/tokens.css     # jetons de design (couleurs, rayons, espacements)
  desktop/                  # application de bureau Tauri 2
    src-tauri/
      src/main.rs           # démarrage, appairage, vérification du certificat
      src/commands.rs       # pont natif minimal : print_receipt, open_cash_drawer, device_info
      capabilities/         # permissions Tauri, figées et testées
      tauri.conf.json
    pairing/                # petit écran local d'appairage (seul contenu embarqué)
  scripts/
    init.ts  import-catalog.ts  backup.ts  restore.ts  verify-ledger.ts  gen-tls.sh
  data/
    catalogue-echantillon.csv
  deploy/
    Dockerfile  docker-compose.yml  visionpharma-officine.service  .env.example
```

---

## 4. Modèle de données

Le schéma de référence complet est dans [annexes/B-modele-donnees.md](../annexes/B-modele-donnees.md). Principes non négociables :

1. **Le stock est la somme des mouvements.** La table `stock_movements` est en ajout seul (déclencheurs qui refusent `UPDATE` et `DELETE`). Les quantités par lot et par produit sont des vues.
2. **Toute écriture métier crée un événement** dans `events`, dans la **même transaction** que la modification. Pas d'événement sans modification, pas de modification sans événement.
3. **Montants** en entiers XAF. **Dates** en ISO 8601 UTC (`2026-10-26T14:05:03.123Z`). Dates de péremption en `AAAA-MM-JJ` (le dernier jour du mois si le GS1 donne `00` comme jour).
4. **Identifiants** UUID v4 pour toute entité synchronisable ; numéros lisibles séparés (`V-2026-000123` pour les ventes, `BC-2026-0042` pour les bons de commande) tirés d'un compteur transactionnel.

---

## 5. Exigences détaillées et critères d'acceptation

Format des critères : **Étant donné / Quand / Alors**. Chaque critère est un test automatisé, sauf mention « manuel ».

### 5.1 Installation et initialisation (I)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| I-01 | M | Un script d'initialisation crée la base, les répertoires (droits 0700), la clé de données AES-256, la paire Ed25519 du nœud, l'identifiant du nœud (UUID), une **autorité de certification locale** (ECDSA P-256, 10 ans) et le certificat TLS du serveur signé par elle (2 ans ; noms : nom d'hôte et adresse IP du réseau local). | Quand on lance `init` sur un répertoire vide, alors tous les éléments existent avec les bons droits. Relancé, il refuse d'écraser l'existant sans `--force`. |
| I-02 | M | Le premier compte créé est le titulaire, avec un mot de passe conforme (A-02) et l'enrôlement TOTP obligatoire. | Sans titulaire, toutes les routes renvoient vers l'écran de configuration initiale ; après création, cet écran n'est plus accessible. |
| I-03 | M | Une **clé de récupération** (24 mots ou 32 octets en base32) est affichée une seule fois et doit être confirmée. Elle chiffre une copie de la clé de données. | La restauration sur une nouvelle machine réussit avec la sauvegarde et la clé de récupération seulement (B-04). |
| I-04 | M | Le catalogue est importé depuis un CSV (format de l'annexe I) ; toutes les fiches sont en statut `dormant`. L'import de 50 000 lignes prend moins de 60 secondes. | Une ligne invalide est rejetée avec son numéro et sa raison ; les lignes valides sont importées ; un rapport d'import est produit. Réimporter met à jour les fiches par `ref_code` sans toucher au stock. |
| I-05 | M | Le serveur refuse de démarrer en HTTP simple, sauf si `VP_REQUIRE_TLS=false` est posé explicitement (et cela est journalisé). | Test de démarrage. |
| I-06 | M | L'empreinte SHA-256 de l'autorité locale est affichée dans l'écran Système et sur l'écran de connexion, pour l'appairage des postes (W-02) et la vérification dans un navigateur. | Test : l'empreinte affichée est celle du fichier de l'autorité. |

### 5.2 Authentification et comptes (A, U)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| A-01 | M | Connexion par identifiant et mot de passe, puis code TOTP si activé. | Mauvais mot de passe ou mauvais code : message générique identique, sans dire lequel est faux. |
| A-02 | M | Mot de passe d'au moins 12 caractères, refusé s'il figure dans la liste des 10 000 mots de passe les plus courants (embarquée) ou s'il contient l'identifiant. | Tests sur des exemples refusés et acceptés. |
| A-03 | M | Hachage scrypt N=2^17, r=8, p=1, sel de 16 octets, format `scrypt$N$r$p$sel$empreinte`, comparaison en temps constant. | Test de format ; un hachage modifié échoue. |
| A-04 | M | Après 5 échecs, le compte est verrouillé 15 minutes ; l'événement `security.account_locked` est journalisé. Limitation de débit de 10 tentatives par minute et par adresse IP. | Test de verrouillage et de levée automatique. |
| A-05 | M | Session : jeton de 32 octets aléatoires dans un cookie `vp_sid` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`) ; empreinte SHA-256 stockée en base ; inactivité de 30 minutes ; durée maximale de 12 heures. | Une session expirée renvoie 401 ; un jeton volé en base (empreinte) ne permet pas de se connecter. |
| A-06 | M | Protection CSRF : chaque requête qui modifie quelque chose porte l'en-tête `X-CSRF-Token` égal au jeton de la session ; sinon 403. | Test sur toutes les routes `POST`, `PUT`, `PATCH`, `DELETE`. |
| A-07 | M | Ré-authentification (mot de passe, plus TOTP si activé) de moins de 5 minutes pour : annulation de vente, ajustement, destruction, rappel, gestion des comptes, restauration, export de journal. | Test : l'action échoue avec `reauth_required` puis réussit après ré-authentification. |
| A-08 | M | En-têtes de sécurité sur toutes les réponses : `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restrictive, `Cache-Control: no-store` sur l'API. | Test d'en-têtes. |
| U-01 | M | Le titulaire crée, désactive et réactive des comptes, change un rôle, réinitialise un mot de passe (changement imposé à la connexion suivante) et coupe toutes les sessions d'un utilisateur. | Chaque action produit un événement `user.*`. Un compte désactivé ne peut plus se connecter, et ses sessions sont supprimées. |
| U-02 | M | Le dernier titulaire actif ne peut pas être désactivé ni rétrogradé. | Test. |
| U-03 | M | La matrice des droits est celle de la section 6 ; elle est la seule source de vérité, et un test vérifie chaque cellule. | Test exhaustif rôle × action. |

### 5.3 Catalogue dormant (C)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| C-01 | M | Recherche dans tout le catalogue (dormant compris) par nom, DCI, dosage ou code-barres, insensible à la casse et aux accents. | 50 000 fiches : réponse en moins de 150 ms au 95e centile. Les fiches actives apparaissent en premier. |
| C-02 | M | Une fiche dormante devient `active` au premier événement réel : réception, inventaire, commande, ou vente avec régularisation (V-05). | L'événement `catalog.item_activated` porte la cause. Une recherche seule n'active rien. |
| C-03 | M | Le scan d'un code-barres inconnu propose d'associer ce code à une fiche existante (recherche) ou de créer une **fiche locale** (`local_only=1`). | L'association produit `catalog.barcode_linked`. La fiche locale produit `catalog.local_item_created`. |
| C-04 | M | Le décodage GS1 DataMatrix extrait le GTIN (AI 01), le lot (AI 10), la péremption (AI 17) et le numéro de série (AI 21), avec ou sans le caractère séparateur FNC1/GS. | Jeu de tests avec des chaînes GS1 réelles. |
| C-05 | M | Une fiche sans vente ni stock depuis 12 mois passe en `sleeping` (tâche quotidienne) et redevient `active` au prochain événement. | Test avec horloge injectée. |
| C-06 | M | Le prix de vente de l'officine est modifiable par le titulaire ou un pharmacien ; le prix conseillé du référentiel reste visible ; chaque changement produit `catalog.price_changed`. | Test de droits et d'événement. |
| C-07 | S | Les étiquettes internes (code-barres Code 128) peuvent être imprimées pour les produits sans code. | Manuel. |

### 5.4 Stock et lots (S)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| S-01 | M | Le stock d'un lot est la somme de ses mouvements ; aucune colonne de quantité n'est modifiée directement. | `UPDATE` ou `DELETE` sur `stock_movements` échoue au niveau de la base. |
| S-02 | M | Sortie FEFO : à la vente, le système prend d'abord le lot qui périme le plus tôt, parmi les lots vendables (non périmés, non rappelés, quantité positive). | Lots A (péremption 2027-01) et B (2026-12) : la vente prend B. |
| S-03 | M | Une vente qui demande plus que le lot FEFO se répartit sur plusieurs lots, une ligne de mouvement par lot. | Test avec 3 lots. |
| S-04 | M | Aucun lot ne descend sous zéro, sauf le lot technique de régularisation (V-05). | Deux ventes concurrentes de la dernière unité : une seule réussit (transactions `BEGIN IMMEDIATE`). |
| S-05 | M | Ajustement manuel (+ ou −) par un pharmacien ou le titulaire, avec un motif obligatoire choisi dans une liste (casse, vol, erreur de saisie, don, autre avec texte). | Mouvement `adjustment` et événement `stock.adjusted` avec le motif. |
| S-06 | M | Inventaire : une session d'inventaire (complète ou par rayon) enregistre les quantités comptées par lot ; à la validation, un mouvement `inventory` corrige l'écart de chaque lot. | Écart de −2 sur un lot : un mouvement de −2, et le rapport d'inventaire montre la valeur de l'écart. |
| S-07 | M | Destruction des périmés et des rappelés, avec motif et numéro de procès-verbal. | Mouvement `destroy`, événement `stock.destroyed`. |
| S-08 | M | Le stock valorisé est calculé au coût d'achat du lot (premier entré, premier sorti au niveau du lot). | Test sur un exemple chiffré. |
| S-09 | S | Seuils minimum et maximum par produit, modifiables. | Utilisés par R-02. |

### 5.5 Réception et commandes (R)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| R-01 | M | Fournisseurs : création, modification, désactivation ; délai moyen de livraison. | Test CRUD et droits. |
| R-02 | M | Suggestion de commande déterministe : pour chaque produit actif, `quantité = max(0, seuil_max − stock − en_commande)` si `stock ≤ seuil_min` ; sinon, si aucun seuil n'est défini, `quantité = ventes des 30 derniers jours × (délai + 7) / 30 − stock − en_commande`, arrondi au supérieur. | Tests sur des cas chiffrés. |
| R-03 | M | Bon de commande : brouillon, envoyé, partiel, reçu ou annulé ; export PDF imprimable et texte prêt à envoyer par WhatsApp. | Test de transitions : une transition interdite renvoie 409. |
| R-04 | M | Réception avec ou sans bon de commande : pour chaque ligne, le produit, le lot, la péremption, la quantité et le coût unitaire. Le scan GS1 pré-remplit le lot et la péremption. | Mouvements `reception` ; mise à jour de `qty_received` ; bon passé en `partial` ou `received`. |
| R-05 | M | La réception d'un lot déjà périmé ou rappelé est refusée ; la réception d'un lot qui périme dans moins de 90 jours demande une confirmation. | Tests. |
| R-06 | S | Retour fournisseur, avec motif. | Mouvement `return_supplier`. |

### 5.6 Caisse et ventes (V)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| V-01 | M | Une vente exige une session de caisse ouverte sur le poste (`register`), avec un fond de caisse. Il y a au plus une session ouverte par poste. | Ouvrir une deuxième session sur le même poste renvoie 409. |
| V-02 | M | Ajouter un article par scan, par recherche ou par raccourci clavier ; modifier la quantité ; supprimer une ligne avant validation. | Bout en bout. |
| V-03 | M | Paiement en une ou plusieurs méthodes : `especes`, `mobile_money` (référence obligatoire), `carte` (référence obligatoire), `credit` (client nommé obligatoire), `tiers_payant` (organisme et numéro obligatoires). La somme des paiements est égale au total ; pour les espèces, le rendu de monnaie est calculé. | Test : la somme différente du total est refusée (422). |
| V-04 | M | La validation est atomique : vente, lignes, paiements, mouvements de stock et événement dans une seule transaction. | Une erreur au milieu de la transaction ne laisse aucune trace partielle (test d'injection d'erreur). |
| V-05 | M | **Vente sans stock enregistré** (démarrage) : si le paramètre `allow_regul_sales` est actif, un article sans stock suffisant est vendu sur le lot technique de régularisation du produit, la vente est marquée `has_regul=1` et apparaît dans le rapport de clôture. Le paramètre est actif par défaut pendant 30 jours après l'installation. | Tests avec le paramètre actif et inactif. |
| V-06 | M | Le ticket (80 mm ; impression ESC/POS directe par l'application de bureau, W-06, ou impression du système en secours) contient : l'officine, le numéro de vente, la date et l'heure, le caissier, les lignes (nom, lot, péremption, quantité, prix), le total, les paiements et le rendu, ainsi que l'empreinte courte de l'événement (8 caractères). | Manuel et test du contenu. |
| V-07 | M | Annulation d'une vente le jour même, par un pharmacien ou le titulaire, avec ré-authentification et motif : des mouvements `void` remettent les quantités sur les **mêmes lots**. Une vente n'est jamais supprimée. | Le stock revient à l'identique ; événement `sale.voided`. |
| V-08 | M | Clôture : l'utilisateur saisit les espèces comptées ; le système calcule le montant attendu (fond + espèces encaissées − rendu), l'écart, et produit le rapport de clôture (P-01). Un point de contrôle du journal est créé. | Test d'écart ; événement `cash.closed`, puis point de contrôle. |
| V-09 | M | Aucun prix négatif ; une remise est une ligne de remise explicite, autorisée seulement au pharmacien ou au titulaire, avec un plafond paramétrable en pourcentage. | Test des droits et du plafond. |
| V-10 | M | Le caissier ne voit ni les coûts d'achat ni les marges. | Test des réponses de l'API selon le rôle. |

### 5.7 Ordonnances (O)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| O-01 | M | Politique paramétrable : `all_medicines` (par défaut, conforme à la règle nationale de 2024 : tout produit de catégorie `medicament`) ou `flagged` (produits avec `rx_required=1`). | Test des deux politiques. |
| O-02 | M | Une vente qui contient au moins un produit soumis à ordonnance ne peut être validée qu'avec une ordonnance liée, **validée par un pharmacien ou le titulaire**. | Le caissier seul ne peut pas valider ; un pharmacien valide depuis son poste ou sur le même poste avec ses identifiants (ré-authentification). |
| O-03 | M | Une ordonnance contient : le nom du prescripteur, son numéro d'inscription à l'Ordre (facultatif au MVP), la date de prescription, une référence patient (initiales ou pseudonyme), une photo facultative et des notes. | Test de validation des champs. |
| O-04 | M | La photo (JPEG ou PNG, 8 Mo au plus, type vérifié par signature de fichier) est chiffrée en AES-256-GCM sur le disque ; elle n'est visible que par un pharmacien ou le titulaire. | Le fichier sur le disque n'est pas lisible en clair ; le caissier reçoit 403. |
| O-05 | M | Une ordonnance de plus de 90 jours (paramétrable) déclenche un avertissement bloquant, que seul un pharmacien peut lever avec un motif. | Test. |
| O-06 | M | Les produits `sensitive=1` exigent toujours une ordonnance (quelle que soit la politique), avec le numéro d'inscription du prescripteur, et sont inscrits dans un registre consultable. | Test et rapport P-06. |

### 5.8 Sécurité sanitaire (Q)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| Q-01 | M | Création d'un rappel (référence, produit, lot ou tous les lots, motif, source) par un pharmacien ou le titulaire, avec ré-authentification. | Événement `recall.published`. |
| Q-02 | M | Un lot rappelé est exclu du FEFO, ne peut pas être vendu, et son scan affiche une alerte bloquante qui indique le motif. | Test : la vente d'un lot rappelé renvoie 409 `recalled_lot`. |
| Q-03 | M | Un lot périmé (péremption antérieure à la date du jour, moins `VP_EXPIRY_BLOCK_DAYS`) ne peut pas être vendu. | Test avec horloge injectée. |
| Q-04 | M | À la vente, un lot qui périme dans moins de 30 jours affiche un avertissement non bloquant. | Test. |
| Q-05 | S | Import d'un fichier de rappels (CSV signé ou saisi), prêt pour la réception future depuis le cloud. | Test d'import. |

### 5.9 Demande non satisfaite (D)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| D-01 | M | Bouton « Client demandait… » en caisse : produit du catalogue (ou texte libre), quantité, note. Si le produit est à stock nul, la caisse le propose automatiquement. | Événement `demand.unmet` avec la criticité du produit. |
| D-02 | M | Liste des demandes non satisfaites, par produit et par période, avec « ajouter à la commande ». | Test. |
| D-03 | M | Une demande est résolue automatiquement à la réception du produit. | Test. |

### 5.10 Rapports (P)

Tous les rapports sont consultables à l'écran, imprimables, et exportables en CSV. Les chiffres viennent de requêtes ; aucun texte n'est généré par IA au MVP.

| ID | Prio | Rapport | Contenu minimal |
|---|---|---|---|
| P-01 | M | Clôture de caisse | Ventes par mode de paiement, nombre de tickets, annulations (avec motif et auteur), remises, ventes en régularisation, attendu, compté, écart |
| P-02 | M | Péremptions | Lots à 30, 60 et 90 jours et lots déjà périmés, quantités, valeur au coût |
| P-03 | M | Ventes sur une période | Chiffre d'affaires, panier moyen, meilleures ventes, ventes par famille et par utilisateur |
| P-04 | M | Stock valorisé | Par produit et par lot, au coût d'achat |
| P-05 | M | Stock immobilisé | Produits sans vente depuis 90 jours, valeur immobilisée |
| P-06 | M | Conformité | Ventes soumises à ordonnance et leur lien, registre des produits sensibles, rappels et lots bloqués, ajustements et destructions |
| P-07 | M | Demande non satisfaite | Produits les plus demandés et introuvables, par criticité |
| P-08 | S | Alertes de fraude interne | Annulations au-delà d'un seuil par utilisateur, ventes en dehors des horaires, écarts de caisse répétés |

### 5.11 Journal intègre (J)

La spécification technique complète est dans [06-architecture-securite.md](06-architecture-securite.md), section 3.

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| J-01 | M | Chaque événement est inscrit avec `seq` (sans trou), un UUID, `type`, `at`, `actor`, `payload`, `prev_hash` et `hash`, dans la même transaction que la modification métier. | Test d'atomicité. |
| J-02 | M | `hash = SHA-256(JCS({seq, id, type, at, actor, payload, prev_hash}))` ; le premier événement a `prev_hash` égal à 64 zéros. | Vecteur de test fourni à l'annexe C. |
| J-03 | M | Un point de contrôle (`seq`, `hash`, signature Ed25519 de `"VPCKPT1|" + node_id + "|" + seq + "|" + hash`, `kid`) est créé tous les 100 événements, à chaque clôture de caisse et chaque jour à minuit. | Test de création et de signature valide. |
| J-04 | M | La commande `verify-ledger` et l'écran Système vérifient : la continuité de `seq`, chaque empreinte, chaque signature, et la cohérence de chaque projection (stock par lot recalculé depuis les événements). | Une altération d'un octet dans `payload` (via un accès direct à la base qui contourne les déclencheurs) est détectée avec son `seq`. |
| J-05 | M | Les événements non envoyés forment la file d'envoi (`synced_at IS NULL`). Un export signé de la file (fichier JSON Lines plus point de contrôle) est disponible pour le futur branchement au cloud. | Test d'export et de re-vérification de l'export. |
| J-06 | M | Les événements de sécurité (connexion, échec, verrouillage, ré-authentification, changement de droits, restauration) sont dans la même chaîne. | Test. |

### 5.12 Sauvegarde et restauration (B)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| B-01 | M | Sauvegarde en ligne de la base (API de sauvegarde SQLite) plus les fichiers chiffrés, regroupés dans une archive chiffrée en AES-256-GCM. La clé est dérivée de la clé de données ; l'en-tête contient la version, `kid`, le nonce et le dernier `seq` et son `hash`. | Une archive modifiée d'un octet est refusée à la restauration (échec de l'étiquette GCM). |
| B-02 | M | Sauvegarde automatique chaque jour à l'heure configurée, conservation des 14 dernières, et copie miroir sur un second répertoire (disque USB) s'il est configuré. | Test avec horloge injectée ; le miroir absent produit une alerte, pas un arrêt. |
| B-03 | M | Sauvegarde manuelle depuis l'écran Système par le titulaire. | Test. |
| B-04 | M | Restauration : déchiffrement, vérification du journal de la sauvegarde (J-04), arrêt du service, remplacement atomique, redémarrage, événement `system.restored`. Possible avec la clé de récupération sur une nouvelle machine. | Test de bout en bout de restauration. |
| B-05 | M | Les sauvegardes, les clés et la base ne sont jamais servies par HTTP. | Test : les chemins renvoient 404. |

### 5.13 Garde (G)

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| G-01 | S | Le titulaire déclare les périodes de garde ; l'interface affiche « De garde » et la clôture de caisse de nuit est séparée. | Test. |

---

## 6. Matrice des droits

`O` = autorisé, `R` = autorisé avec ré-authentification, `—` = refusé.

| Action | Titulaire | Pharmacien | Préparateur | Caissier |
|---|---|---|---|---|
| Vendre, encaisser, ouvrir et fermer sa caisse | O | O | O | O |
| Valider une ordonnance | O | O | — | — |
| Voir une image d'ordonnance | O | O | — | — |
| Annuler une vente | R | R | — | — |
| Appliquer une remise | O | O | — | — |
| Voir les coûts et les marges | O | O | — | — |
| Réceptionner | O | O | O | — |
| Créer ou envoyer un bon de commande | O | O | O | — |
| Ajuster ou détruire du stock | R | R | — | — |
| Faire un inventaire (saisie) | O | O | O | — |
| Valider un inventaire | O | O | — | — |
| Créer un rappel | R | R | — | — |
| Modifier un prix de vente | O | O | — | — |
| Associer un code-barres, créer une fiche locale | O | O | O | — |
| Saisir une demande non satisfaite | O | O | O | O |
| Voir les rapports de ventes et de stock | O | O | lecture stock | — |
| Voir la clôture de sa propre caisse | O | O | O | O |
| Gérer les comptes | R | — | — | — |
| Paramètres de l'officine | R | — | — | — |
| Sauvegarder | O | — | — | — |
| Restaurer, exporter le journal | R | — | — | — |
| Vérifier le journal | O | O | — | — |

---

## 7. API HTTP

La liste complète des routes, avec leurs schémas et codes d'erreur, est dans [annexes/D-api-officine.md](../annexes/D-api-officine.md). Règles communes :

- Préfixe `/api/v1`. JSON UTF-8. Schéma TypeBox en entrée **et** en sortie : un champ non déclaré est refusé en entrée et retiré en sortie.
- Erreurs au format RFC 9457 (`application/problem+json`) : `type`, `title`, `status`, `code` stable (`recalled_lot`, `rx_required`, `insufficient_stock`, `reauth_required`, etc.), `detail` sans donnée sensible.
- Pagination par curseur ; 100 éléments au plus par page.
- Toute route est déclarée avec une permission de la matrice de la section 6 ; une route sans permission déclarée fait échouer le démarrage.

---

## 8. Interface utilisateur

| Écran | Rôles | Points clés |
|---|---|---|
| Configuration initiale | — | Création du titulaire, TOTP, clé de récupération, import du catalogue |
| Connexion | tous | Empreinte du certificat ; message d'erreur générique |
| **Caisse** | tous | Champ de scan toujours actif ; F2 recherche, F4 quantité, F8 « client demandait », F9 paiement, Échap annuler la ligne ; alertes de rappel, de péremption et d'ordonnance dans le panier ; total en très gros caractères |
| Paiement | tous | Méthodes multiples, rendu de monnaie, impression du ticket |
| Ordonnance | pharmacien, titulaire | Saisie, photo par la caméra du poste ou un fichier, validation |
| Produits et stock | selon les droits | Recherche dans tout le catalogue, fiche, lots, mouvements, seuils, prix |
| Réception | titulaire, pharmacien, préparateur | Scan GS1, lignes, rapprochement avec le bon de commande |
| Commandes | idem | Suggestions, bons, export |
| Inventaire | idem | Sessions, saisie par scan, validation |
| Rappels | pharmacien, titulaire | Liste, création, lots bloqués |
| Demandes non satisfaites | tous (saisie), pharmacien (liste) | Liste et ajout à la commande |
| Rapports | selon les droits | P-01 à P-08 |
| Comptes | titulaire | U-01 à U-03 |
| Système | titulaire, pharmacien | Vérification du journal, sauvegardes, paramètres, file d'envoi |

Contraintes : français, textes externalisés, contraste WCAG 2.2 AA, entièrement utilisable au clavier, aucune police ni ressource chargée depuis Internet.

### 8.1 Design system (style « Kiro / Qoder / macOS »)

| Élément | Règle |
|---|---|
| Composants | shadcn/ui générés dans `web/src/components/ui/` ; on modifie le composant dans le dépôt plutôt que de l'envelopper |
| Thème | **Sombre par défaut**, clair disponible ; jetons dans `styles/tokens.css` (variables CSS), utilisés par Tailwind ; aucune couleur codée en dur dans un écran |
| Couleurs | Fond neutre, **une seule couleur d'accent** ; couleurs d'état réservées au sens : rouge = bloquant (rappel, périmé), orange = avertissement (péremption proche), vert = succès |
| Typographie | Inter ou Geist en fichiers locaux ; échelle 12, 14, 16, 20, 28 ; total de caisse en 48 au moins ; chiffres tabulaires pour les montants |
| Mise en page | Barre latérale fine à icônes (Lucide), libellés au survol ; panneaux redimensionnables (`react-resizable-panels`) ; en caisse : panier à gauche, fiche produit et alertes à droite |
| Palette de commandes | `cmdk` sur Ctrl+K (⌘K sur macOS) depuis tout écran : produits, actions (« clôture », « nouvelle réception », « rappels »), navigation ; les actions proposées respectent les droits du rôle |
| Raccourcis | F2 recherche, F4 quantité, F8 « client demandait », F9 paiement, Échap annuler la ligne ; liste affichée par `?` |
| Retours d'action | Notifications discrètes en bas à droite (`sonner`) ; les alertes **bloquantes** (rappel, périmé, ordonnance) sont dans le panier et ne se ferment pas par une notification |
| Mouvement | Transitions de 150 à 200 ms (`motion`) ; désactivées si le système demande la réduction des animations |
| Densité | Lignes de tableau de 36 px, listes virtualisées (`@tanstack/react-virtual`) au-delà de 100 lignes |
| États | Chaque écran gère explicitement : chargement (squelette), vide, erreur avec action, hors ligne (bandeau « serveur injoignable », panier conservé) |

### 8 bis. Application de bureau des postes (W)

Les postes de travail utilisent une application Tauri 2. Elle affiche l'interface servie par le serveur local appairé (même origine : les sessions, les cookies, la CSP et les droits restent ceux du serveur). Elle ajoute la vérification du serveur, l'impression directe et les mises à jour signées.

| ID | Prio | Exigence | Critères d'acceptation |
|---|---|---|---|
| W-01 | M | Installateurs **signés** pour Windows 10/11 x64 (MSI ou NSIS, avec le chargeur WebView2) et Ubuntu 24.04 Desktop (.deb) ; macOS en option (C, notarisé). | L'installateur s'installe sur une machine neuve sans droits d'administrateur hors de l'installation du certificat ; la signature est valide. |
| W-02 | M | **Appairage** au premier lancement : l'utilisateur saisit l'adresse du serveur ; l'application affiche l'empreinte SHA-256 de l'autorité locale ; un pharmacien ou le titulaire saisit le **code d'appairage** à 8 chiffres affiché dans l'écran Système (valable 10 minutes, 5 essais). L'application enregistre l'autorité ; le serveur crée la fiche du poste et lui remet un **secret de poste** de 32 octets (seule son empreinte SHA-256 est stockée), conservé dans le trousseau du système et envoyé dans l'en-tête `X-VP-Device` à chaque requête. | Mauvais code : refus et compteur d'essais ; bon code : événement `device.paired` avec le nom et l'identifiant du poste. |
| W-03 | M | **Épinglage** : à chaque lancement et à chaque reconnexion, le cœur Rust vérifie que le certificat du serveur est signé par l'autorité appairée, avant d'ouvrir l'interface. | Un faux serveur sur le réseau (autre autorité) affiche un écran bloquant « Serveur non reconnu », sans possibilité de passer outre. |
| W-04 | M | La fenêtre ne charge **que** l'origine du serveur appairé ; toute navigation vers une autre origine est bloquée, y compris les liens ; le seul contenu embarqué est l'écran d'appairage. | Test : une redirection vers une autre origine est bloquée. |
| W-05 | M | **Pont natif minimal** : seules les commandes `print_receipt`, `open_cash_drawer` et `device_info` sont exposées, et uniquement à l'origine appairée (capacités Tauri `remote`). Aucun plugin `shell`, `fs` ou `http`. | Un test de configuration échoue si une capacité ou un plugin non listé apparaît. |
| W-06 | M | Impression **ESC/POS directe** du ticket et ouverture du tiroir-caisse (imprimante USB ou réseau, configurée sur le poste) ; à défaut, impression par la boîte de dialogue du système. | Manuel sur l'imprimante de référence ; test unitaire de la génération ESC/POS. |
| W-07 | M | **Mises à jour** depuis le serveur local, sans Internet : le serveur publie le manifeste et les paquets de l'application (`/api/v1/desktop/update`), signés en Ed25519 (mécanisme du plugin updater de Tauri) ; toute mise à jour non signée ou mal signée est refusée. | Test : un paquet modifié est refusé ; un paquet valide s'installe au redémarrage. |
| W-08 | M | Une seule instance par poste ; taille et position de la fenêtre mémorisées ; **mode caisse plein écran** (kiosque) activable par le titulaire pour un poste. | Test et manuel. |
| W-09 | S | Le titulaire voit les postes appairés (nom, date d'appairage, dernière connexion) et peut **révoquer** un poste : l'application révoquée affiche l'écran d'appairage au prochain contrôle. | Événement `device.revoked` ; test. |
| W-10 | S | Effets de fenêtre natifs (vibrancy sur macOS, Mica sur Windows) sans perte de contraste. | Manuel. |
| W-11 | S | Le paramètre `allow_browser_clients` (actif par défaut pendant le pilote) permet au titulaire d'interdire l'accès par simple navigateur. | Test : paramètre inactif, une requête sans secret de poste valide reçoit 403 sauf sur `/health`, `/devices/pair` et les routes de mise à jour. |


---

## 9. Exploitation

- **Installation** : `README` de l'application, image Docker ou paquet natif avec service systemd (`Restart=always`, utilisateur dédié sans droits, `ProtectSystem=strict`, `NoNewPrivileges=yes`).
- **Journaux techniques** : JSON sur la sortie standard, sans donnée de santé ni secret ; rotation par journald.
- **Santé** : `GET /api/v1/health` renvoie la version, l'état de la base, le dernier `seq`, l'âge de la dernière sauvegarde et du dernier point de contrôle.
- **Mises à jour** : arrêt, sauvegarde automatique, migrations, redémarrage ; retour à la version précédente si le contrôle de santé échoue.
- **Horloge** : synchronisation NTP du serveur quand Internet est disponible ; alerte si l'heure du poste diffère de plus de 5 minutes de celle du serveur. L'heure qui fait foi est toujours celle du serveur.

---

## 10. Définition de « terminé »

Une exigence est terminée quand :
1. le code est fusionné sur la branche principale par une demande de fusion revue ;
2. le test qui porte son identifiant passe en CI ;
3. le typage, le lint et l'analyse des dépendances sont verts ;
4. l'interface concernée est utilisable au clavier ;
5. la documentation (`README` de l'application ou annexe D) est à jour.

Le MVP est livrable quand toutes les exigences **M** sont terminées et que la recette du document [08](08-tests-et-recette.md) est passée.
