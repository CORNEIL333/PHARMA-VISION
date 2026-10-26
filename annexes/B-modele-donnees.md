<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe B — Modèle de données de référence (nœud Officine)

Ce schéma SQLite est la **référence** pour la migration `001_init.sql`. Il a été vérifié : il s'exécute sans erreur et les déclencheurs d'ajout seul refusent toute modification des mouvements.

L'agent peut l'ajuster pendant la construction (index, colonnes manquantes) tant que ces principes restent vrais :

1. Le stock n'est jamais stocké : il est calculé à partir de `stock_movements` (vues `lot_stock` et `product_stock`).
2. `events`, `stock_movements` et `checkpoints` sont en ajout seul. Seule la colonne `events.synced_at` peut être renseignée plus tard, une seule fois.
3. Montants en entiers XAF, dates en ISO 8601 UTC, identifiants UUID v4.
4. Une fois publiée, la migration n'est plus modifiée : tout changement passe par `002_…sql`, `003_…sql`, etc.

Pragmas à appliquer à chaque ouverture :

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA trusted_schema = OFF;
```

## Entités

| Table | Rôle | Propriétaire futur |
|---|---|---|
| `settings` | Paramètres de l'officine (politique d'ordonnance, ventes en régularisation, plafond de remise…) | Officine |
| `users`, `sessions` | Comptes, rôles, sessions | Officine (L0), cœur (L1) |
| `products`, `barcodes` | Catalogue (dormant, actif, endormi), codes-barres | Cœur (référentiel) et officine (prix, seuils) |
| `lots`, `stock_movements` | Lots et mouvements ; stock = somme | Officine |
| `recalls` | Rappels de lots | Cœur (L1) et officine |
| `suppliers`, `purchase_orders`, `po_lines` | Fournisseurs et commandes | Officine |
| `cash_sessions`, `sales`, `sale_lines`, `payments` | Caisse et ventes | Officine |
| `prescriptions` | Ordonnances (image chiffrée hors base) | Officine |
| `inventory_sessions`, `inventory_counts` | Inventaires | Officine |
| `duty_periods` | Gardes | Officine, publié au cœur (L1) |
| `unmet_demand` | Demandes non satisfaites | Officine, puis cœur (L1) |
| `events`, `checkpoints` | Journal chaîné et points de contrôle signés | Officine, ancré au cœur (L1) |
| `devices`, `pairing_codes` | Postes appairés (application de bureau) et codes d'appairage | Officine |
| `counters` | Numérotation lisible (ventes, bons de commande) | Officine |

## Schéma

```sql
-- VisionPharma Officine — schéma initial
-- Conventions : montants en XAF entiers (ISO 4217, 0 décimale) ; dates ISO 8601 UTC ;
-- identifiants texte UUID v4 pour tout ce qui sera synchronisé.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------- Identité
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('titulaire','pharmacien','preparateur','caissier')),
  pw_hash         TEXT NOT NULL,
  totp_secret_enc TEXT,
  totp_enabled    INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  reauth_at    TEXT,             -- dernière ré-authentification (A-07)
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------- Catalogue
CREATE TABLE products (
  id              TEXT PRIMARY KEY,
  ref_code        TEXT UNIQUE,               -- identifiant du référentiel commun
  name            TEXT NOT NULL,
  dci             TEXT,
  strength        TEXT,
  form            TEXT,
  presentation    TEXT,
  category        TEXT NOT NULL DEFAULT 'medicament'
                  CHECK (category IN ('medicament','dispositif','parapharmacie','autre')),
  rx_required     INTEGER NOT NULL DEFAULT 0,
  sensitive       INTEGER NOT NULL DEFAULT 0,  -- risque de détournement (stupéfiants, psychotropes)
  criticity       INTEGER NOT NULL DEFAULT 3 CHECK (criticity IN (1,2,3)),
  storage         TEXT,                        -- 'ambiant','2-8C', etc.
  suggested_price INTEGER,
  sale_price      INTEGER,
  min_qty         INTEGER NOT NULL DEFAULT 0,
  max_qty         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'dormant' CHECK (status IN ('dormant','active','sleeping')),
  activated_at    TEXT,
  local_only      INTEGER NOT NULL DEFAULT 0,  -- fiche créée localement, à valider par le référentiel
  search_text     TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_search ON products(search_text);

CREATE TABLE barcodes (
  code       TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind       TEXT NOT NULL DEFAULT 'gtin' CHECK (kind IN ('gtin','interne','autre'))
);
CREATE INDEX idx_barcodes_product ON barcodes(product_id);

-- ---------------------------------------------------------------- Stock
CREATE TABLE lots (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  lot_number  TEXT NOT NULL,
  expiry      TEXT,                 -- AAAA-MM-JJ ; NULL pour le lot de régularisation
  unit_cost   INTEGER,
  is_regul    INTEGER NOT NULL DEFAULT 0,  -- lot technique « stock à régulariser »
  created_at  TEXT NOT NULL,
  UNIQUE (product_id, lot_number)
);
CREATE INDEX idx_lots_product ON lots(product_id);

-- Mouvements : append-only. Le stock est la somme des mouvements.
CREATE TABLE stock_movements (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  lot_id     TEXT NOT NULL REFERENCES lots(id),
  qty        INTEGER NOT NULL CHECK (qty <> 0),
  kind       TEXT NOT NULL CHECK (kind IN ('reception','sale','void','adjustment','inventory','destroy','return_supplier')),
  ref_type   TEXT,
  ref_id     TEXT,
  reason     TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  event_seq  INTEGER NOT NULL,
  at         TEXT NOT NULL
);
CREATE INDEX idx_mov_lot ON stock_movements(lot_id);
CREATE INDEX idx_mov_product ON stock_movements(product_id);
CREATE INDEX idx_mov_at ON stock_movements(at);

CREATE TRIGGER mov_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements est en ajout seul'); END;
CREATE TRIGGER mov_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements est en ajout seul'); END;

CREATE VIEW lot_stock AS
  SELECT l.id AS lot_id, l.product_id, l.lot_number, l.expiry, l.is_regul, l.unit_cost,
         COALESCE(SUM(m.qty), 0) AS qty
  FROM lots l LEFT JOIN stock_movements m ON m.lot_id = l.id
  GROUP BY l.id;

CREATE VIEW product_stock AS
  SELECT p.id AS product_id, COALESCE(SUM(m.qty), 0) AS qty
  FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
  GROUP BY p.id;

-- ---------------------------------------------------------------- Rappels
CREATE TABLE recalls (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL,
  product_id   TEXT NOT NULL REFERENCES products(id),
  lot_number   TEXT,                -- NULL = tous les lots du produit
  reason       TEXT NOT NULL,
  source       TEXT NOT NULL,       -- 'DPML','laboratoire','grossiste','interne'
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_recalls_product ON recalls(product_id);

-- ---------------------------------------------------------------- Fournisseurs et commandes
CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  phone      TEXT,
  email      TEXT,
  lead_days  INTEGER NOT NULL DEFAULT 2,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id          TEXT PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL CHECK (status IN ('draft','sent','partial','received','cancelled')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  closed_at   TEXT
);

CREATE TABLE po_lines (
  id           TEXT PRIMARY KEY,
  po_id        TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id   TEXT NOT NULL REFERENCES products(id),
  qty_ordered  INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost    INTEGER
);
CREATE INDEX idx_po_lines_po ON po_lines(po_id);

-- ---------------------------------------------------------------- Caisse et ventes
CREATE TABLE cash_sessions (
  id             TEXT PRIMARY KEY,
  register       TEXT NOT NULL,
  opened_by      TEXT NOT NULL REFERENCES users(id),
  opened_at      TEXT NOT NULL,
  opening_float  INTEGER NOT NULL DEFAULT 0,
  closed_by      TEXT REFERENCES users(id),
  closed_at      TEXT,
  counted_cash   INTEGER,
  expected_cash  INTEGER,
  variance       INTEGER,
  note           TEXT
);
CREATE UNIQUE INDEX idx_cash_open_register ON cash_sessions(register) WHERE closed_at IS NULL;

CREATE TABLE prescriptions (
  id              TEXT PRIMARY KEY,
  prescriber_name TEXT NOT NULL,
  prescriber_reg  TEXT,             -- numéro d'inscription à l'Ordre des médecins
  issued_on       TEXT NOT NULL,
  patient_ref     TEXT,             -- pseudonyme ou initiales ; pas d'identité complète au MVP
  image_blob      TEXT,             -- nom du fichier chiffré
  validated_by    TEXT NOT NULL REFERENCES users(id),
  validated_at    TEXT NOT NULL,
  notes           TEXT
);

CREATE TABLE sales (
  id              TEXT PRIMARY KEY,
  number          TEXT NOT NULL UNIQUE,
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  prescription_id TEXT REFERENCES prescriptions(id),
  total           INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('completed','voided')),
  has_regul       INTEGER NOT NULL DEFAULT 0,
  discount_total  INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  discount_by     TEXT REFERENCES users(id),
  discount_reason TEXT,
  created_at      TEXT NOT NULL,
  voided_by       TEXT REFERENCES users(id),
  voided_at       TEXT,
  void_reason     TEXT
);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sales_session ON sales(cash_session_id);

CREATE TABLE sale_lines (
  id         TEXT PRIMARY KEY,
  sale_id    TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  lot_id     TEXT NOT NULL REFERENCES lots(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);

CREATE TABLE payments (
  id        TEXT PRIMARY KEY,
  sale_id   TEXT NOT NULL REFERENCES sales(id),
  method    TEXT NOT NULL CHECK (method IN ('especes','mobile_money','carte','credit','tiers_payant')),
  amount    INTEGER NOT NULL,
  reference TEXT,                -- n° de transaction Mobile Money ou carte
  payer     TEXT                 -- client à crédit ou organisme de tiers payant
);
CREATE INDEX idx_payments_sale ON payments(sale_id);

-- ---------------------------------------------------------------- Inventaire
CREATE TABLE inventory_sessions (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,          -- 'complet' ou libellé du rayon
  status       TEXT NOT NULL CHECK (status IN ('open','validated','cancelled')),
  opened_by    TEXT NOT NULL REFERENCES users(id),
  opened_at    TEXT NOT NULL,
  validated_by TEXT REFERENCES users(id),
  validated_at TEXT
);

CREATE TABLE inventory_counts (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES inventory_sessions(id),
  lot_id       TEXT NOT NULL REFERENCES lots(id),
  counted_qty  INTEGER NOT NULL CHECK (counted_qty >= 0),
  system_qty   INTEGER NOT NULL,       -- figé au moment du comptage
  counted_by   TEXT NOT NULL REFERENCES users(id),
  counted_at   TEXT NOT NULL,
  UNIQUE (session_id, lot_id)
);

-- ---------------------------------------------------------------- Garde
CREATE TABLE duty_periods (
  id         TEXT PRIMARY KEY,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);

-- ---------------------------------------------------------------- Demande non satisfaite
CREATE TABLE unmet_demand (
  id         TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  free_text  TEXT,
  qty        INTEGER NOT NULL DEFAULT 1,
  source     TEXT NOT NULL DEFAULT 'comptoir',
  criticity  INTEGER NOT NULL DEFAULT 3,
  note       TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  at         TEXT NOT NULL,
  resolved_at TEXT
);

-- ---------------------------------------------------------------- Journal d'événements chaîné
-- Chaque événement porte le condensat du précédent (chaîne SHA-256).
-- Des points de contrôle signés (Ed25519) scellent la chaîne à intervalle régulier.
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  at         TEXT NOT NULL,
  actor      TEXT,
  payload    TEXT NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL,
  synced_at  TEXT                 -- seule colonne modifiable : marquage d'envoi au cloud
);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_unsynced ON events(seq) WHERE synced_at IS NULL;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events est en ajout seul'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE OF seq, id, type, at, actor, payload, prev_hash, hash ON events
BEGIN SELECT RAISE(ABORT, 'events est en ajout seul'); END;

CREATE TABLE checkpoints (
  seq        INTEGER PRIMARY KEY REFERENCES events(seq),
  hash       TEXT NOT NULL,
  signature  TEXT NOT NULL,
  key_id     TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE TRIGGER checkpoints_no_delete BEFORE DELETE ON checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints est en ajout seul'); END;
CREATE TRIGGER checkpoints_no_update BEFORE UPDATE ON checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints est en ajout seul'); END;

-- Compteurs de numérotation (tickets, bons de commande)
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  secret_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 du secret de poste
  platform     TEXT NOT NULL,          -- 'windows','linux','macos'
  app_version  TEXT,
  paired_by    TEXT NOT NULL REFERENCES users(id),
  paired_at    TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT,
  revoked_by   TEXT REFERENCES users(id)
);

CREATE TABLE pairing_codes (
  code_hash   TEXT PRIMARY KEY,         -- SHA-256 du code à 8 chiffres
  created_by  TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT
);

CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
```
