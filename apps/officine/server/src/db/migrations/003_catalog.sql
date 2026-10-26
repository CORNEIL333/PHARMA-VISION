-- 003_catalog.sql — J3 : recherche, cycle de vie et rapports d'import (C-01, C-02, C-05, I-04).
-- NE JAMAIS MODIFIER 001/002 : ce fichier ne fait qu'ajouter.

-- C-05 : dernière activité connue (vente, réception, inventaire, commande).
-- NULL = jamais d'activité depuis l'activation : le balayage retombe alors sur activated_at/created_at.
ALTER TABLE products ADD COLUMN last_activity_at TEXT;

-- C-05 : balayage quotidien des fiches actives sans activité depuis douze mois.
CREATE INDEX idx_products_activity ON products(status, last_activity_at);

-- I-04 : rapport d'import conservé (l'événement catalog.imported porte le même identifiant).
CREATE TABLE catalog_imports (
  id              TEXT PRIMARY KEY,
  filename        TEXT,                       -- nom d'origine, jamais utilisé comme chemin
  sha256          TEXT NOT NULL,              -- empreinte du corps brut reçu
  lines_total     INTEGER NOT NULL,
  inserted        INTEGER NOT NULL,
  updated         INTEGER NOT NULL,
  rejected        INTEGER NOT NULL,
  unknown_columns TEXT NOT NULL DEFAULT '[]', -- JSON : colonnes ignorées
  errors          TEXT NOT NULL DEFAULT '[]', -- JSON : [{line, ref_code, reason}]
  conflicts       TEXT NOT NULL DEFAULT '[]', -- JSON : [{line, code, product_id}]
  actor           TEXT REFERENCES users(id),
  at              TEXT NOT NULL
);
CREATE INDEX idx_catalog_imports_at ON catalog_imports(at);
