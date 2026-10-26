<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe D — API HTTP du nœud Officine

Préfixe `/api/v1`. JSON UTF-8. Toutes les routes, sauf celles marquées **public**, exigent une session. Toutes les routes qui modifient quelque chose exigent l'en-tête `X-CSRF-Token`. La colonne **Permission** renvoie à la matrice du document 05, section 6 ; **R** signifie qu'une ré-authentification de moins de 5 minutes est exigée.

Le contrat détaillé (schémas TypeBox, exemples) est généré en OpenAPI 3.1 depuis le code et servi en `GET /api/v1/openapi.json` (accès titulaire et pharmacien).

## Erreurs

Format RFC 9457 (`application/problem+json`) :

```json
{ "type": "about:blank", "title": "Lot rappelé", "status": 409, "code": "recalled_lot", "detail": "Le lot A12 de Amoxicilline 500 mg est rappelé (réf. DPML-2026-014)." }
```

| Code | Statut | Sens |
|---|---|---|
| `validation_failed` | 400 | Schéma non respecté |
| `unauthenticated` | 401 | Pas de session ou session expirée |
| `invalid_credentials` | 401 | Connexion refusée (message générique : identifiant, mot de passe, code ou verrouillage) |
| `reauth_required` | 401 | Ré-authentification requise pour cette action |
| `forbidden` | 403 | Rôle insuffisant |
| `csrf_failed` | 403 | Jeton CSRF absent ou faux |
| `password_change_required` | 403 | Session limitée : changer le mot de passe d'abord |
| `totp_enrollment_required` | 403 | Session limitée : activer la double authentification d'abord (titulaire) |
| `not_found` | 404 | Ressource absente |
| `insufficient_stock` | 409 | Stock vendable insuffisant |
| `recalled_lot` | 409 | Lot rappelé |
| `expired_lot` | 409 | Lot périmé |
| `rx_required` | 409 | Ordonnance validée requise |
| `register_busy` | 409 | Une session de caisse est déjà ouverte sur ce poste |
| `invalid_transition` | 409 | Changement d'état interdit |
| `setup_required` | 409 | Configuration initiale pas encore faite |
| `setup_done` | 409 | Configuration initiale déjà faite |
| `last_titulaire` | 409 | Le dernier titulaire actif ne peut être ni désactivé ni rétrogradé |
| `username_taken` | 409 | Identifiant déjà utilisé |
| `barcode_taken` | 409 | Code-barres déjà rattaché à une autre fiche (champ `product_id` : fiche propriétaire) |
| `payload_too_large` | 413 | Corps de requête au-delà de la limite (1 Mo en JSON, 50 Mo pour l'import CSV) |
| `weak_password` | 422 | Mot de passe refusé (champ `reason` : `too_short`, `common`, `contains_username`, `too_simple`, `too_long`) |
| `invalid_totp` | 422 | Code TOTP incorrect lors d'un enrôlement |
| `invalid_barcode` | 422 | Code-barres illisible : vide, GTIN de longueur ou de clé fausse, chaîne GS1 dont un AI, une date ou un champ est invalide |
| `payment_mismatch` | 422 | La somme des paiements est différente du total |
| `rate_limited` | 429 | Trop de tentatives |
| `db_busy` | 503 | Base occupée ; réessayer |
| `internal_error` | 500 | Erreur interne (détail dans le journal technique, jamais dans la réponse) |

## Routes

### Système et installation

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `GET /health` | public | Version, état, dernier `seq`, âge de la sauvegarde et du dernier point de contrôle |
| `GET /setup/status` | public | Indique si la configuration initiale est faite ; nom de l'officine ; empreinte de l'autorité locale (I-06) |
| `GET /setup/totp-secret` | public, avant configuration seulement | Secret TOTP proposé pour l'enrôlement du titulaire |
| `POST /setup` | public, une seule fois | Nom de l'officine, création du titulaire, code TOTP, clé de récupération recopiée en entier ; ouvre la session |
| `GET /system/info` | Vérifier le journal | Identifiant du nœud, clé publique, `kid`, empreinte du certificat |
| `POST /system/verify-ledger` | Vérifier le journal | Lance la vérification et renvoie le résultat |
| `GET /system/backups` | Sauvegarder | Liste des sauvegardes |
| `POST /system/backups` | Sauvegarder | Sauvegarde immédiate |
| `POST /system/restore` | Restaurer (R) | Restauration (fichier déjà présent sur le serveur) |
| `POST /system/ledger-export` | Exporter le journal (R) | Export de la file d'envoi signée |
| `GET /settings` · `PATCH /settings` | Paramètres (R pour la modification) | Paramètres de l'officine |

### Postes et application de bureau

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `POST /devices/pairing-code` | Pharmacien ou titulaire | Génère un code d'appairage à 8 chiffres valable 10 minutes |
| `POST /devices/pair` | public, débit limité, 5 essais par code | Appairage : nom du poste, code ; renvoie l'identifiant et le secret du poste (affiché une seule fois) |
| `GET /devices/:id/status` | public (identifiant du poste) | Indique si le poste est actif ou révoqué |
| `GET /devices` · `POST /devices/:id/revoke` | Titulaire (R pour la révocation) | Liste et révocation des postes |
| `GET /desktop/update` | public | Manifeste de mise à jour signé de l'application de bureau |
| `GET /desktop/packages/:file` | public | Paquets signés de l'application de bureau |

### Authentification et comptes

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `POST /auth/login` | public, débit limité | Identifiant et mot de passe ; renvoie `totp_required` si besoin |
| `POST /auth/totp` | public, débit limité | Second facteur |
| `POST /auth/reauth` | toute session | Ré-authentification |
| `POST /auth/logout` | toute session | Déconnexion |
| `GET /auth/me` | toute session | Utilisateur courant, rôle, jeton CSRF, droits |
| `POST /auth/password` | toute session | Changement de son mot de passe |
| `POST /auth/totp/enroll` · `POST /auth/totp/confirm` | toute session | Enrôlement TOTP |
| `GET /users` · `POST /users` · `PATCH /users/:id` | Gérer les comptes (R pour l'écriture) | Gestion des comptes |
| `POST /users/:id/reset-password` · `POST /users/:id/revoke-sessions` | Gérer les comptes (R) | Réinitialisation, coupure des sessions |

### Catalogue

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `GET /products?q=&status=&cursor=&limit=` | toute session | Recherche (dormant compris) : nom, DCI, dosage, forme, présentation et codes-barres, insensible à la casse et aux accents ; les fiches actives passent avant les dormantes puis les endormies. `limit` 1 à 50 (20 par défaut), pagination par curseur opaque (`next_cursor`), p95 visé < 150 ms sur 50 000 fiches |
| `GET /products/by-barcode/:code` | toute session | Recherche par code ou chaîne GS1 décodée (AI 01, 10, 17, 21, avec ou sans FNC1/GS, préfixe de symbologie toléré). Renvoie `{ found, code, gs1, product }` : `found=false` et le décodage `gs1` (lot, péremption, série) quand le code est inconnu — c'est la proposition de C-03 ; `422 invalid_barcode` si le code est illisible |
| `GET /products/:id` | toute session | Fiche, stock par lot (coûts masqués selon le rôle) |
| `POST /products/local` | Associer un code, créer une fiche locale | Fiche locale (`local_only=1`), active d'emblée ; `409 barcode_taken` si le code est déjà pris |
| `POST /products/:id/barcodes` | idem | Association d'un code-barres ; renvoie `{ created, product }`, `created=false` si l'association existait déjà |
| `PATCH /products/:id/price` | Modifier un prix | Prix de vente (entier ≥ 0, XAF) ; un événement `catalog.price_changed` par changement, aucun événement si le prix est identique |
| `PATCH /products/:id/thresholds` | Modifier un prix | Seuils min et max |
| `POST /catalog/import` | Paramètres (R) | Import d'un CSV (`text/csv` ou `application/csv`, corps en flux, 50 Mo au plus). Nom de fichier facultatif dans l'en-tête `X-Filename` (jamais utilisé comme chemin). Réponse : rapport d'import (voir annexe I) |

### Stock

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `GET /stock/lots?product_id=` | Voir les rapports de stock | Lots et quantités |
| `GET /stock/movements?product_id=&from=&to=` | idem | Mouvements |
| `POST /stock/adjustments` | Ajuster (R) | Ajustement avec motif |
| `POST /stock/destructions` | Ajuster (R) | Destruction avec procès-verbal |
| `POST /inventories` · `POST /inventories/:id/counts` · `POST /inventories/:id/validate` | Inventaire (saisie) ; validation par pharmacien | Inventaire |

### Fournisseurs, commandes, réceptions

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `GET /suppliers` · `POST /suppliers` · `PATCH /suppliers/:id` | Créer un bon de commande | Fournisseurs |
| `GET /orders/suggestions?supplier_id=` | idem | Suggestion de commande |
| `GET /orders` · `POST /orders` · `PATCH /orders/:id` | idem | Bons de commande |
| `POST /orders/:id/send` · `POST /orders/:id/cancel` | idem | Transitions |
| `GET /orders/:id/export?format=pdf|text` | idem | Export imprimable ou texte WhatsApp |
| `POST /receptions` | Réceptionner | Réception avec ou sans bon |
| `POST /supplier-returns` | Réceptionner | Retour fournisseur |

### Caisse et ventes

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `GET /cash/sessions/current?register=` | Vendre | Session ouverte du poste |
| `POST /cash/sessions` | Vendre | Ouverture avec fond de caisse |
| `POST /cash/sessions/:id/close` | Vendre | Clôture avec espèces comptées |
| `POST /sales/quote` | Vendre | Vérifie un panier (stock, lots, alertes, ordonnance requise) sans rien écrire |
| `POST /sales` | Vendre (ordonnance validée si requise) | Vente atomique |
| `GET /sales?from=&to=&cursor=` · `GET /sales/:id` | Vendre (ses ventes) ; pharmacien (toutes) | Consultation |
| `GET /sales/:id/receipt` | Vendre | Ticket (HTML 80 mm ou ESC/POS) |
| `POST /sales/:id/void` | Annuler (R) | Annulation avec motif |

### Ordonnances et sécurité sanitaire

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `POST /prescriptions` | Valider une ordonnance | Saisie et validation ; image en base64 (8 Mo au plus) |
| `GET /prescriptions/:id` · `GET /prescriptions/:id/image` | Voir une image d'ordonnance | Consultation ; image déchiffrée à la volée, `Cache-Control: no-store` |
| `GET /recalls` · `POST /recalls` · `POST /recalls/:id/close` | Créer un rappel (R) | Rappels |
| `POST /recalls/import` | Créer un rappel (R) | Import d'un fichier de rappels |

### Demande, garde, rapports

| Méthode et chemin | Permission | Rôle |
|---|---|---|
| `POST /demand` · `GET /demand` · `POST /demand/:id/to-order` | Saisir (tous) ; liste et commande (pharmacien) | Demandes non satisfaites |
| `GET /duty` · `POST /duty` | Paramètres | Gardes |
| `GET /reports/cash-close/:session_id` | Voir sa clôture ou rapports | P-01 |
| `GET /reports/expiry?days=` | Voir les rapports | P-02 |
| `GET /reports/sales?from=&to=` | idem | P-03 |
| `GET /reports/stock-value` | idem | P-04 |
| `GET /reports/dead-stock?days=` | idem | P-05 |
| `GET /reports/compliance?from=&to=` | idem | P-06 |
| `GET /reports/unmet-demand?from=&to=` | idem | P-07 |
| `GET /reports/fraud?from=&to=` | Titulaire | P-08 |

Tous les rapports acceptent `?format=csv` pour un export.
