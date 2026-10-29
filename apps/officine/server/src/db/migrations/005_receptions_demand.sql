-- J5/J8 — Réceptions (R-04), retours fournisseur (R-06), demandes non satisfaites (D-01 à D-03).
-- Les lignes d'une réception sont ses mouvements (stock_movements.ref_type = 'reception', ref_id = id).
CREATE TABLE receptions (
  id          TEXT PRIMARY KEY,
  po_id       TEXT REFERENCES purchase_orders(id),
  supplier_id TEXT REFERENCES suppliers(id),
  note        TEXT,
  received_by TEXT NOT NULL REFERENCES users(id),
  received_at TEXT NOT NULL,
  event_seq   INTEGER NOT NULL
);
CREATE INDEX idx_receptions_at ON receptions(received_at);
CREATE INDEX idx_receptions_po ON receptions(po_id);

-- D-03 : cause et référence de la résolution d'une demande.
ALTER TABLE unmet_demand ADD COLUMN resolved_cause TEXT;
ALTER TABLE unmet_demand ADD COLUMN resolved_ref TEXT;
CREATE INDEX idx_unmet_open ON unmet_demand(product_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_unmet_at ON unmet_demand(at);

CREATE INDEX idx_mov_ref ON stock_movements(ref_type, ref_id);
