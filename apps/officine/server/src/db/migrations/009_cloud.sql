-- Phase B, côté nœud (docs/10 §3) : état de la synchronisation avec le cloud et rappels reçus.
CREATE TABLE cloud_state (
  key        TEXT PRIMARY KEY,   -- enrolment, referential_version, recall_version, last_sync_at, last_error…
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Rappels diffusés par le cloud (RA-02) : correspondance avec le rappel local, accusé de blocage (RA-03).
CREATE TABLE cloud_recalls (
  cloud_id        TEXT PRIMARY KEY,
  version         INTEGER NOT NULL,
  ref_code        TEXT NOT NULL,
  lot_number      TEXT,
  local_recall_id TEXT REFERENCES recalls(id),
  active          INTEGER NOT NULL,
  received_at     TEXT NOT NULL,
  acked_at        TEXT
);
CREATE INDEX idx_cloud_recalls_pending ON cloud_recalls(ref_code) WHERE local_recall_id IS NULL;
