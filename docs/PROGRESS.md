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
| I-03 | M | doing | init.test.ts « I-03 … », auth.http.test.ts « I-03 … » | | Clé générée, affichée une fois, enveloppe recovery.wrap, confirmation exigée à la configuration. Reste : critère B-04 (restauration sur machine neuve). |
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
| C-07 | S | todo |  | |  |
| S-01 | M | todo |  | |  |
| S-02 | M | todo |  | |  |
| S-03 | M | todo |  | |  |
| S-04 | M | todo |  | |  |
| S-05 | M | todo |  | |  |
| S-06 | M | todo |  | |  |
| S-07 | M | todo |  | |  |
| S-08 | M | todo |  | |  |
| S-09 | S | todo |  | |  |
| R-01 | M | todo |  | |  |
| R-02 | M | todo |  | |  |
| R-03 | M | todo |  | |  |
| R-04 | M | todo |  | |  |
| R-05 | M | todo |  | |  |
| R-06 | S | todo |  | |  |
| V-01 | M | todo |  | |  |
| V-02 | M | todo |  | |  |
| V-03 | M | todo |  | |  |
| V-04 | M | todo |  | |  |
| V-05 | M | todo |  | |  |
| V-06 | M | todo |  | |  |
| V-07 | M | todo |  | |  |
| V-08 | M | todo |  | |  |
| V-09 | M | todo |  | |  |
| V-10 | M | todo |  | |  |
| O-01 | M | todo |  | |  |
| O-02 | M | todo |  | |  |
| O-03 | M | todo |  | |  |
| O-04 | M | todo |  | |  |
| O-05 | M | todo |  | |  |
| O-06 | M | todo |  | |  |
| Q-01 | M | todo |  | |  |
| Q-02 | M | todo |  | |  |
| Q-03 | M | todo |  | |  |
| Q-04 | M | todo |  | |  |
| Q-05 | S | todo |  | |  |
| D-01 | M | todo |  | |  |
| D-02 | M | todo |  | |  |
| D-03 | M | todo |  | |  |
| P-01 | M | todo |  | |  |
| P-02 | M | todo |  | |  |
| P-03 | M | todo |  | |  |
| P-04 | M | todo |  | |  |
| P-05 | M | todo |  | |  |
| P-06 | M | todo |  | |  |
| P-07 | M | todo |  | |  |
| P-08 | S | todo |  | |  |
| J-01 | M | done | ledger.test.ts « J-01 … » | |  |
| J-02 | M | done | ledger.vectors.test.ts | | Vecteurs de l’annexe C reproduits octet pour octet. |
| J-03 | M | done | ledger.test.ts « J-03 … », startup.test.ts « J-03 … » | | Tous les 100 événements, à la demande, à minuit (jobs/checkpoints.ts), à l’arrêt. Clôture de caisse : appeler ledger.checkpoint() dans V-07. |
| J-04 | M | doing | ledger.test.ts « J-04 … » | | Faits : continuité, empreintes, chaîne, signatures, projection de stock par lot (convention payload.movements). Reste : étape 5 (totaux de caisse) avec le module V, et l’écran Système UI-14. |
| J-05 | M | todo |  | |  |
| J-06 | M | done | auth.http.test.ts « J-06 … » | | Connexion, échec, verrouillage, ré-authentification, comptes. Restauration : à faire avec B-04. |
| B-01 | M | todo |  | |  |
| B-02 | M | todo |  | |  |
| B-03 | M | todo |  | |  |
| B-04 | M | todo |  | |  |
| B-05 | M | todo |  | |  |
| G-01 | S | todo |  | |  |
| W-01 | M | todo |  | |  |
| W-02 | M | todo |  | |  |
| W-03 | M | todo |  | |  |
| W-04 | M | todo |  | |  |
| W-05 | M | todo |  | |  |
| W-06 | M | todo |  | |  |
| W-07 | M | todo |  | |  |
| W-08 | M | todo |  | |  |
| W-09 | S | todo |  | |  |
| W-10 | S | todo |  | |  |
| W-11 | S | todo |  | |  |
| UI-01 | M | todo | | | Configuration initiale |
| UI-02 | M | todo | | | Connexion |
| UI-03 | M | todo | | | Caisse |
| UI-04 | M | todo | | | Paiement |
| UI-05 | M | todo | | | Ordonnance |
| UI-06 | M | todo | | | Produits et stock |
| UI-07 | M | todo | | | Réception |
| UI-08 | M | todo | | | Commandes |
| UI-09 | M | todo | | | Inventaire |
| UI-10 | M | todo | | | Rappels |
| UI-11 | M | todo | | | Demandes non satisfaites |
| UI-12 | M | todo | | | Rapports |
| UI-13 | M | todo | | | Comptes |
| UI-14 | M | todo | | | Système |
| UI-15 | M | todo | | | Clôture de caisse |
| UI-16 | M | todo | | | Pages d'erreur et états globaux |
| DW-01 | M | todo | | | Écran d'appairage |
| DW-02 | M | todo | | | Serveur non reconnu |
| DW-03 | M | todo | | | Poste révoqué |
| DW-04 | M | todo | | | Fenêtre principale |
| DW-05 | M | todo | | | Fenêtre de mise à jour |
| DW-06 | M | todo | | | Réglage de l'imprimante |
| RC-01 | M | todo | | | Scénario de recette (docs/08) |
| RC-02 | M | todo | | | Scénario de recette (docs/08) |
| RC-03 | M | todo | | | Scénario de recette (docs/08) |
| RC-04 | M | todo | | | Scénario de recette (docs/08) |
| RC-05 | M | todo | | | Scénario de recette (docs/08) |
| RC-06 | M | todo | | | Scénario de recette (docs/08) |
| RC-07 | M | todo | | | Scénario de recette (docs/08) |
| RC-08 | M | todo | | | Scénario de recette (docs/08) |
| RC-09 | M | todo | | | Scénario de recette (docs/08) |
| RC-10 | M | todo | | | Scénario de recette (docs/08) |
| RC-11 | M | todo | | | Scénario de recette (docs/08) |
| RC-12 | M | todo | | | Scénario de recette (docs/08) |
| RC-13 | M | todo | | | Scénario de recette (docs/08) |
| RC-14 | M | todo | | | Scénario de recette (docs/08) |
| RC-15 | M | todo | | | Scénario de recette (docs/08) |
| RC-16 | M | todo | | | Scénario de recette (docs/08) |
| RC-17 | M | todo | | | Scénario de recette (docs/08) |
| RC-18 | M | todo | | | Scénario de recette (docs/08) |
| RC-19 | M | todo | | | Scénario de recette (docs/08) |
| RC-20 | M | todo | | | Scénario de recette (docs/08) |
| RC-21 | M | todo | | | Scénario de recette (docs/08) |
| RC-22 | M | todo | | | Scénario de recette (docs/08) |
| RC-23 | M | todo | | | Scénario de recette (docs/08) |
| RC-24 | M | todo | | | Scénario de recette (docs/08) |
| RC-25 | M | todo | | | Scénario de recette (docs/08) |
