-- Dossier d'installation de l'officine (docs/11-dossier-installation.md) : données réglementaires,
-- administratives et fiscales collectées au démarrage, par rubrique (document JSON validé par le domaine).
CREATE TABLE pharmacy_profile (
  section    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,           -- JSON de la rubrique
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Organismes de tiers payant conventionnés (assureurs, mutuelles, employeurs) : V-03 `tiers_payant`.
CREATE TABLE payers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind                 TEXT NOT NULL CHECK (kind IN ('assurance', 'mutuelle', 'employeur', 'etat', 'autre')),
  code                 TEXT,
  convention_ref       TEXT,
  default_coverage_pct INTEGER CHECK (default_coverage_pct BETWEEN 0 AND 100),
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL
);
