# PROGRESS — VisionPharma Officine

Fichier d'état du chantier : il sert de mémoire aux agents (voir `PROMPT-AUTONOME-QODER.md`). Mettre à jour après **chaque** exigence.

Statuts : `todo`, `doing`, `done`, `waiting-human`, `blocked`. La colonne « commit » est vide pour le travail de démarrage : le dépôt Git n'existait pas encore (voir « Démarrage » ci-dessous).

## Démarrage (26 octobre 2026)

Le socle et les jours J1 et J2 du plan ont été construits avant l'arrivée de Qoder. Tout passe :

```
cd apps/officine
npm ci
npm run typecheck   # ok
npm run lint        # ok
npm test            # 209 tests (207 verts, 2 ignorés), 11 fichiers, ok
```

**Première action de Qoder** : `git init` à la racine `visionpharma/`, commit initial `chore: socle J1-J2 (I, A, U, J)`, puis reprendre à **J3 (catalogue : I-04, C-01 à C-06)**.

Conventions déjà en place, à respecter :
- `server/src/db/index.ts` → `writeTx(db, fn)` : seule façon d'écrire (BEGIN IMMEDIATE).
- `server/src/domain/ledger.ts` → `ledger.append(type, actor, payload)` dans la même transaction. Tout événement qui touche au stock porte `payload.movements = [{lot_id, qty, kind}]` : la vérification J-04 recalcule le stock par lot à partir de là.
- `server/src/http/types.ts` → chaque route déclare `config.permission` (`'public'`, `'session'` ou une action de `security/rbac.ts`) ; sinon le serveur refuse de démarrer. Le contrôle d'accès et le CSRF s'exécutent en `preValidation`, avant la validation du corps.
- `server/test/helpers.ts` → `makeApp()`, `setupTitulaire()`, `createAndLogin()`, `reauth()` : nœud complet avec de vraies clés dans un répertoire temporaire.
- Les erreurs sont des `AppError(code, titre, détail)` (`server/src/errors.ts`) ; les nouveaux codes vont aussi dans l'annexe D.

## J3 — catalogue (26 octobre 2026)

I-04 et C-01 à C-06 sont faits. 43 tests ajoutés (209 au total, 11 fichiers) : `test/gs1.test.ts` (C-04), `test/catalog.import.test.ts` (I-04), `test/catalog.domain.test.ts` (C-02, C-05), `test/catalog.http.test.ts` (C-01, C-03, C-06, I-04 HTTP, fiche détaillée).

- Migration `003_catalog.sql` : `products.last_activity_at`, index `idx_products_activity`, table `catalog_imports` (audit des imports, annexe B).
- Domaines : `search.ts` (lecture, p95 < 150 ms sur 50 000 fiches), `gs1.ts` (C-04), `csv.ts` (parseur `;` tolérant au BOM), `catalog.ts` (activation, association, fiche locale, prix, balayage C-05), `catalogImport.ts` (I-04).
- HTTP : `http/routes/catalog.ts` (7 routes, `config.permission` sur chacune), corps CSV 50 Mo (`app.ts`), codes `barcode_taken`, `invalid_barcode`, `payload_too_large`.
- Tâche quotidienne `jobs/catalog.ts` (mise en sommeil à minuit heure de Douala), CLI `npm run import-catalog -- --file <csv>`.

## État

| ID | Prio | Statut | Test | Commit | Notes |
|---|---|---|---|---|---|
| I-01 | M | done | init.test.ts « I-01 … » | | Autorité locale ECDSA P-256 + certificat serveur générés avec node:crypto seul (security/x509.ts), validés par openssl et une poignée de main TLS. |
| I-02 | M | done | auth.http.test.ts « I-02 … » | | API faite (POST /setup, GET /setup/status, GET /setup/totp-secret). Écran : UI-01. |
| I-03 | M | done | init.test.ts, auth.http.test.ts, backup.test.ts « B-04 … » | | Critère B-04 couvert (restauration sur machine neuve). |
| I-04 | M | done | catalog.import.test.ts « I-04 … », catalog.http.test.ts « I-04 … » | | `domain/catalogImport.ts` : CSV `;` UTF-8 (BOM toléré), validation ligne par ligne, réimport par `ref_code` qui ne touche ni stock, ni prix local, ni seuils ; une seule transaction, rapport capé à 1 000 erreurs + `catalog.imports` + `catalog.imported` (SHA-256). CLI `npm run import-catalog`. 50 000 lignes : test « 50 000 lignes importées en moins de 60 secondes ». |
| I-05 | M | done | startup.test.ts « I-05 … » | | server/src/tls.ts ; suites AEAD seulement en TLS 1.2 ; TLS 1.1 refusé (vérifié à la main). |
| I-06 | M | done | init.test.ts « I-06 … », auth.http.test.ts « I-06 … » | | Empreinte publique dans GET /setup/status et GET /system/info. Affichage : UI-02 et UI-14. |
| A-01 | M | done | auth.http.test.ts « A-01 … », passwords.test.ts (vecteurs RFC 6238) | | Défi TOTP en mémoire (5 min, usage unique). Rejeu d’un code refusé (users.totp_last_counter). |
| A-02 | M | done | passwords.test.ts « A-02 … » | | Liste SecLists 10k (MIT) embarquée. Voir QUESTIONS Q-02. |
| A-03 | M | done | passwords.test.ts « A-03 … » | |  |
| A-04 | M | done | auth.http.test.ts « A-04 … » | | Limiteur en mémoire (security/ratelimit.ts) ; pas de dépendance ajoutée. |
| A-05 | M | done | auth.http.test.ts « A-05 … » | |  |
| A-06 | M | done | auth.http.test.ts « A-06 toutes les routes … » | | Test exhaustif sur app.routeTable : chaque nouvelle route modifiante est couverte automatiquement. |
| A-07 | M | done | auth.http.test.ts « A-07 … » | | Les actions R de la matrice exigent reauth_at < 5 min (hooks.ts). |
| A-08 | M | done | auth.http.test.ts « A-08 … » | |  |
| U-01 | M | done | auth.http.test.ts « U-01 … » | | API faite. Écran : UI-13. Création = mot de passe temporaire, changement imposé (QUESTIONS Q-04). |
| U-02 | M | done | auth.http.test.ts « U-02 … » | |  |
| U-03 | M | done | rbac.test.ts (comparaison cellule par cellule avec docs/05 §6) | |  |
| C-01 | M | done | catalog.http.test.ts « C-01 … » | | `domain/search.ts` : `search_text` normalisé (casse/accents), multi-termes, codes-barres, actifs d'abord, curseur opaque. p95 < 150 ms sur 50 000 fiches mesuré par le test. |
| C-02 | M | done | catalog.domain.test.ts « C-02 … » | | `activateProduct` exige la transaction de l'événement réel (échoue sinon), cause obligatoire parmi `reception`, `inventory`, `order`, `regul_sale`. Une recherche n'active rien. |
| C-03 | M | done | catalog.http.test.ts « C-03 … » | | `GET /products/by-barcode/:code` → 404, puis association (`catalog.barcode_linked`) ou fiche locale (`local_only=1`, `catalog.local_item_created`). `409 barcode_taken` si le code est pris. Réservé à `catalog.link` (titulaire, pharmacien, préparateur). |
| C-04 | M | done | gs1.test.ts « C-04 … » | | `domain/gs1.ts` : AI 01/10/17/21, avec ou sans FNC1/GS, préfixe de symbologie `]xx` toléré, clé de contrôle mod-10 (GTIN 8/12/13/14), `00` = dernier jour du mois. |
| C-05 | M | done | catalog.domain.test.ts « C-05 … » | | `last_activity_at` (migration 003) ; `sweepSleepingProducts` endort après 12 mois sans s'appuyer sur les fiches dormantes, horloge injectée. Tâche quotidienne `jobs/catalog.ts` à minuit heure de Douala. |
| C-06 | M | done | catalog.http.test.ts « C-06 … » | | `PATCH /products/:id/price` sous `price.edit` (titulaire, pharmacien), `suggested_price` toujours visible, `catalog.price_changed` par changement, aucun événement si le prix est identique. |
| C-07 | S | done | labels.test.ts « C-07 … », e2e « UI-06 … » | | Code interne EAN-13 (préfixe 20) + étiquettes 50 × 30 mm imprimables (QUESTIONS Q-19). Vérification manuelle à l’imprimante d’étiquettes. |
| S-01 | M | done | stock.test.ts, invariants.property.test.ts « S-01 … » | | `domain/stock.ts` : mouvements préparés puis écrits par `appendStockEvent` avec l'événement (payload.movements), contrôle de non-négativité par lot dans la transaction. |
| S-02 | M | done | stock.test.ts « S-02 … » | | FEFO : péremption, date d'entrée, identifiant ; lots rappelés, périmés (marge VP_EXPIRY_BLOCK_DAYS, minuit de Douala) et vides exclus. |
| S-03 | M | done | stock.test.ts « S-03 … » | |  |
| S-04 | M | done | stock.test.ts « S-04 … » (deux processus, deux connexions SQLite) | |  |
| S-05 | M | done | stock.test.ts, stock.http.test.ts « S-05 … » | | Motifs casse, vol, erreur_saisie, don, autre (texte obligatoire) ; R. |
| S-06 | M | done | inventory.test.ts « S-06 … » | | Migration 004 : `inventory_scope`, `movement_mark` (recomptage exigé si le lot a bougé). Lot découvert à l'inventaire = activation C-02. |
| S-07 | M | done | stock.test.ts « S-07 … » | | Seulement lots périmés ou rappelés, motif + PV. |
| S-08 | M | done | stock.test.ts « S-08 … » | | Coût inconnu explicite (`total_value_xaf: null`), jamais zéro. |
| S-09 | S | done | stock.test.ts, stock.http.test.ts « S-09 … » | | `PATCH /products/:id/thresholds` sous `price.edit`. |
| R-01 | M | done | orders.test.ts « R-01 … » | | Routes montées dans app.ts. |
| R-02 | M | done | orders.test.ts « R-02 … » | |  |
| R-03 | M | done | orders.test.ts « R-03 … » | | Export PDF (A4, 80 mm) et texte WhatsApp. |
| R-04 | M | done | receptions.test.ts « R-04 … » | | `domain/receptions.ts`, migration 005 (`receptions`). Bon partiel puis reçu. |
| R-05 | M | done | receptions.test.ts « R-05 … » | | Moins de 90 jours : `validation_failed` + `reason: near_expiry_confirmation_required`, puis `confirm_near_expiry`. |
| R-06 | S | done | receptions.test.ts « R-06 … » | |  |
| V-01 | M | done | sales.test.ts « V-01 … » | | `domain/cash.ts`. |
| V-02 | M | done | sales.test.ts (devis), e2e caisse | | `POST /sales/quote` : contrôle du panier sans écriture. |
| V-03 | M | done | sales.test.ts « V-03 … » | | Rendu : `cash_tendered` / `change_given` (migration 006). |
| V-04 | M | done | sales.test.ts « V-04 … » | | Injection d'erreur (déclencheur SQL et journal). |
| V-05 | M | done | sales.test.ts « V-05 … » | | Paramètre `allow_regul_sales` (absent = 30 jours après le premier événement). |
| V-06 | M | done | sales.test.ts « V-06 … » | | `domain/receipt.ts` : 48 colonnes, empreinte courte de l'événement. |
| V-07 | M | done | sales.test.ts « V-07 … » | | Jour civil de Douala. |
| V-08 | M | done | sales.test.ts « V-08 … » | | Point de contrôle dans la transaction de clôture. |
| V-09 | M | done | sales.test.ts « V-09 … » | | Plafond `discount_max_pct` (10 % par défaut). |
| V-10 | M | done | sales.test.ts « V-10 … », stock.http.test.ts | |  |
| O-01 | M | done | safety.test.ts « O-01 … » | |  |
| O-02 | M | done | safety.test.ts « O-02 … » | | Contre-signature sur le poste du caissier : `POST /prescriptions/countersigned` (identifiants du pharmacien, TOTP si actif). |
| O-03 | M | done | safety.test.ts « O-03 … » | |  |
| O-04 | M | done | safety.test.ts « O-04 … » | | Fichier `blobs/rx-<id>.vpb`, clé HKDF « vp-blob-v1 », AAD = identifiant. |
| O-05 | M | done | safety.test.ts « O-05 … » | | Code `stale_prescription` (409). |
| O-06 | M | done | safety.test.ts « O-06 … », reports.test.ts « P-06 … » | |  |
| Q-01 | M | done | safety.test.ts « Q-01 … » | |  |
| Q-02 | M | done | safety.test.ts « Q-02 … » | | Lot scanné (`lot_id`) : 409 `recalled_lot` avec le motif. |
| Q-03 | M | done | safety.test.ts « Q-03 … » | |  |
| Q-04 | M | done | safety.test.ts « Q-04 … » | |  |
| Q-05 | S | done | safety.test.ts « Q-05 … » | | Import CSV tout ou rien. |
| D-01 | M | done | receptions.test.ts « D-01 … » | |  |
| D-02 | M | done | receptions.test.ts « D-02 … » | |  |
| D-03 | M | done | receptions.test.ts « D-03 … » | |  |
| P-01 | M | done | reports.test.ts « P-01 … » | |  |
| P-02 | M | done | reports.test.ts « P-02 … » | |  |
| P-03 | M | done | reports.test.ts « P-03 … » | |  |
| P-04 | M | done | reports.test.ts « P-04 … » | |  |
| P-05 | M | done | reports.test.ts « P-05 … » | |  |
| P-06 | M | done | reports.test.ts « P-06 … » | |  |
| P-07 | M | done | reports.test.ts « P-07 … » | |  |
| P-08 | S | done | reports.test.ts « P-08 … » | | Lecture : titulaire ré-authentifié (`settings.edit`). |
| J-01 | M | done | ledger.test.ts « J-01 … » | |  |
| J-02 | M | done | ledger.vectors.test.ts | | Vecteurs de l’annexe C reproduits octet pour octet. |
| J-03 | M | done | ledger.test.ts « J-03 … », startup.test.ts « J-03 … » | | Tous les 100 événements, à la demande, à minuit (jobs/checkpoints.ts), à l’arrêt. Clôture de caisse : appeler ledger.checkpoint() dans V-07. |
| J-04 | M | done | ledger.test.ts, e2e « UI-14 J-04 … » | | Écran Système : vérification du journal. |
| J-05 | M | done | backup.test.ts « J-05 … » | | `domain/ledgerExport.ts` : JSON Lines CloudEvents + point de contrôle ; `verifyExport`. |
| J-06 | M | done | auth.http.test.ts, backup.test.ts « B-04 J-06 … » | | `system.restored` dans la chaîne. |
| B-01 | M | done | backup.test.ts « B-01 … » | | `domain/backup.ts`, format VPBAK1 (doc 06 §4.3), `domain/tar.ts`. |
| B-02 | M | done | backup.test.ts « B-02 … » | | `jobs/backup.ts` ; miroir absent = `mirror: absent` dans l'événement, pas d'arrêt. |
| B-03 | M | done | backup.test.ts « B-03 … » | |  |
| B-04 | M | done | backup.test.ts « B-04 … » | | Mise en attente vérifiée, remplacement au redémarrage (`applyPendingRestore` dans main.ts), clé de récupération sur machine neuve. |
| B-05 | M | done | backup.test.ts « B-05 … » | |  |
| G-01 | S | done | duty.test.ts, sales.test.ts « V-08 G-01 … » | | Caisse « garde » séparée (migration 006 `cash_sessions.kind`). |
| W-01 | M | waiting-human |  | | Installateurs signés : certificat de signature de code et clé de mise à jour (CI). Installer l’autorité locale dans le magasin de confiance des postes. |
| W-02 | M | done | devices.test.ts « W-02 … » | | Serveur : code d’appairage, secret de poste (empreinte seule en base). Application : voir DW-01. |
| W-03 | M | done | desktop/src-tauri, server/test/desktop.test.ts | | Épinglage rustls ; npm run desktop:pinning-test (vrai serveur, autre autorité refusée). |
| W-04 | M | done | desktop/src-tauri, server/test/desktop.test.ts | | on_navigation + on_new_window Deny ; test w04. |
| W-05 | M | done | desktop/src-tauri, server/test/desktop.test.ts | | 3 commandes, capacité distante à l’exécution ; tests w05. |
| W-06 | M | done | desktop/src-tauri, server/test/desktop.test.ts | | escpos.rs (tests w06) ; imprimante réseau TCP. Manuel sur l’imprimante de référence. |
| W-07 | M | done | server/test/desktop.test.ts « W-07 … » | | Serveur : manifeste et paquets ; npm run publish-desktop. Clé de signature à générer en CI. |
| W-08 | M | done | desktop/src-tauri, server/test/desktop.test.ts | | single-instance, window-state, kiosque par poste (desktop.test.ts). |
| W-09 | S | done | devices.test.ts « W-09 … » | | Écran : UI-14. |
| W-10 | S | waiting-human |  | | Effets de fenêtre natifs : vérification manuelle. |
| W-11 | S | done | devices.test.ts « W-11 … » | | Politique en `onRequest` (hooks.ts). |
| UI-01 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-02 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-03 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-04 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-05 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-06 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-07 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-08 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-09 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-10 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-11 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-12 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-13 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-14 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-15 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| UI-16 | M | done | web/e2e/app.spec.ts (axe + captures docs/screenshots/) | | Écran construit, testé de bout en bout contre le vrai serveur. |
| DW-01 | M | done | desktop/src-tauri (cargo test) | | pairing/index.html |
| DW-02 | M | done | desktop/src-tauri (cargo test) | | pairing/unrecognized.html, test Rust w03 contre un vrai serveur |
| DW-03 | M | done | desktop/src-tauri (cargo test) | | index.html?revoked=1, contrôle périodique |
| DW-04 | M | done | desktop/src-tauri (cargo test) | | lib.rs, test w04 |
| DW-05 | M | done | desktop/src-tauri (cargo test) | | pairing/update.html |
| DW-06 | M | done | desktop/src-tauri (cargo test) | | pairing/printer.html |
| RC-01 | M | waiting-human | docs/manual-tests.md §2 | | Installation chronométrée sur le mini-PC réel |
| RC-02 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-03 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-04 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-05 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-06 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-07 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-08 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-09 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-10 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-11 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-12 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-13 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-14 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-15 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-16 | M | done | docs/manual-tests.md §1 et §2 | | Automatisé ; procédure manuelle complémentaire. |
| RC-17 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-18 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-19 | M | done | docs/manual-tests.md §1 | | Automatisé. |
| RC-20 | M | waiting-human | docs/manual-tests.md §2 | | deploy/update.sh ; à jouer sur Ubuntu |
| RC-21 | M | waiting-human | docs/manual-tests.md §2 | | Installateur signé et autorité installée sur le poste |
| RC-22 | M | done | docs/manual-tests.md §1 et §2 | | Automatisé ; procédure manuelle complémentaire. |
| RC-23 | M | waiting-human | docs/manual-tests.md §2 | | Clé de mise à jour en CI |
| RC-24 | M | waiting-human | docs/manual-tests.md §2 | | Imprimante de référence |
| RC-25 | M | done | docs/manual-tests.md §1 | | Automatisé. |

## Dossier d'installation de l'officine (28 octobre 2026, demande du porteur du projet)

| ID | Prio | Statut | Test | Commit | Notes |
|---|---|---|---|---|---|
| DOS-01 | S | done | profile.test.ts, e2e « Dossier de l'officine » | | Recherche et conception : docs/11-dossier-installation.md. Écran `/dossier`, bandeau d'avancement, tiers payant, grossistes, NIU et RCCM sur le ticket. |
| DOS-02 | S | waiting-human | | | Validation du contenu par l'ONPC, la DPML et un conseil fiscal (points « à confirmer » de docs/11). |
| DOS-03 | C | todo | | | TVA de la parapharmacie sur le ticket et dans les rapports (docs/11 §5) : décision fiscale préalable. |

## Phase B — serveur central et back-office (docs/10-cloud-spec.md)

| ID | Prio | Statut | Test | Commit | Notes |
|---|---|---|---|---|---|
| CL-01 | M | todo | | |  |
| CL-02 | M | todo | | |  |
| CL-03 | M | todo | | |  |
| CL-04 | M | todo | | |  |
| CL-05 | M | todo | | |  |
| CL-06 | S | todo | | | Non construit en phase B (spec §2.1). |
| SY-01 | M | todo | | |  |
| SY-02 | M | doing | apps/cloud/test/domain.test.ts | | Protocole et décision de lot faits (apps/cloud/src/domain/batch.ts). Reste : passerelle et persistance PostgreSQL. |
| SY-03 | M | doing | apps/cloud/test/domain.test.ts | | Décision idempotente faite. Reste : persistance. |
| SY-04 | M | doing | apps/cloud/test/domain.test.ts | | Décision de quarantaine faite. Reste : persistance, alerte. |
| SY-05 | M | todo | | |  |
| SY-06 | M | todo | | |  |
| SY-07 | M | todo | | |  |
| RF-01 | M | todo | | |  |
| RF-02 | M | todo | | |  |
| RF-03 | M | todo | | |  |
| RF-04 | M | todo | | |  |
| RA-01 | M | todo | | |  |
| RA-02 | M | todo | | |  |
| RA-03 | M | todo | | |  |
| RA-04 | S | todo | | |  |
| DI-01 | M | doing | apps/cloud/test/domain.test.ts | | Calcul des mouvements par lot fait. Reste : vue PostgreSQL. |
| DI-02 | M | doing | apps/cloud/test/domain.test.ts | | Bornes de fraîcheur faites et testées. Reste : API. |
| DI-03 | M | todo | | |  |
| TL-01 | M | doing | packages/protocol/test/protocol.test.ts | | Arbre RFC 9162 fait dans packages/protocol (vecteurs CT). Reste : stockage cloud. |
| TL-02 | M | doing | apps/cloud/test/domain.test.ts | | Têtes signées faites. Reste : émission périodique et stockage. |
| TL-03 | M | doing | packages/protocol/test/protocol.test.ts | | Preuves d’inclusion et de cohérence faites et vérifiées exhaustivement (packages/protocol). Reste : routes cloud. |
| TL-04 | M | done | apps/cloud/test/domain.test.ts « TL-04 … » | | Vérificateur indépendant : npm run tl-verify (code 0 ou 2). |
| TL-05 | S | todo | | |  |
| CR-01 | S | doing | apps/cloud/test/domain.test.ts | | Score fait (QUESTIONS Q-23). Reste : compteurs PostgreSQL. |
| CR-02 | S | doing | apps/cloud/test/domain.test.ts | | Délais par niveau faits. Reste : diffusion. |
| BO-01 | M | doing | apps/cloud/test/domain.test.ts | | Vérification des jetons (jose, MFA) faite. Reste : Keycloak réel (Docker). |
| BO-02 | M | doing | apps/cloud/test/domain.test.ts | | Matrice faite. Reste : routes. |
| BO-03 | M | todo | | |  |
| BO-04 | M | todo | | |  |
| OP-01 | M | todo | | |  |
| OP-02 | M | todo | | |  |
| OP-03 | M | todo | | |  |
| OP-04 | M | todo | | |  |
| OP-05 | M | todo | | |  |
| OP-06 | M | todo | | |  |
| NO-01 | M | done | officine server/test/cloud-sync.test.ts (faux cloud de test), e2e UI-14 | | Paramètres cloud_* (désactivé par défaut), enrôlement par jeton. |
| NO-02 | M | done | officine server/test/cloud-sync.test.ts (faux cloud de test), e2e UI-14 | | Transport épinglé (clé SPKI vérifiée avant tout octet HTTP), requêtes signées, lots gzip, reprise avec attente plafonnée. |
| NO-03 | M | done | officine server/test/cloud-sync.test.ts (faux cloud de test), e2e UI-14 | | Rappels signés appliqués par un compte système inactif, accusés. |
| NO-04 | M | done | officine server/test/cloud-sync.test.ts (faux cloud de test), e2e UI-14 | | Versions signées appliquées dans l’ordre, prix local, seuils et statut conservés. |
| NO-05 | M | done | officine server/test/cloud-sync.test.ts (faux cloud de test), e2e UI-14 | | Onglet Système → Synchronisation. |
| BUI-01 | M | todo | | | |
| BUI-02 | M | todo | | | |
| BUI-03 | M | todo | | | |
| BUI-04 | M | todo | | | |
| BUI-05 | M | todo | | | |
| BUI-06 | M | todo | | | |
| BUI-07 | M | todo | | | |
| BUI-08 | M | todo | | | |
| BUI-09 | M | todo | | | |
| BUI-10 | M | todo | | | |
| RB-01 | M | todo | | | |
| RB-02 | M | todo | | | |
| RB-03 | M | todo | | | |
| RB-04 | M | todo | | | |
| RB-05 | M | todo | | | |
| RB-06 | M | todo | | | |
| RB-07 | M | todo | | | |
| RB-08 | M | todo | | | |
| RB-09 | M | todo | | | |
| RB-10 | M | todo | | | |
