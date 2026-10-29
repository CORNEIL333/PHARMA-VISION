-- J4 — Stock et inventaire (S-06).
-- Périmètre explicite d'un inventaire par rayon : liste des produits concernés.
CREATE TABLE inventory_scope (
  session_id TEXT NOT NULL REFERENCES inventory_sessions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  PRIMARY KEY (session_id, product_id)
);

-- Repère des mouvements du lot au moment du comptage (plus grand rowid de stock_movements) :
-- tout mouvement postérieur au comptage impose un recomptage avant validation.
ALTER TABLE inventory_counts ADD COLUMN movement_mark INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_inventory_counts_session ON inventory_counts(session_id);
CREATE INDEX idx_lots_expiry ON lots(expiry);
