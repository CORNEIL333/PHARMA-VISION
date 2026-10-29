-- J6/J7 — Caisse, ventes, ordonnances, rappels (V, O, Q, G-01).

-- G-01 : une session de caisse ouverte pendant une garde est une caisse de garde, clôturée à part.
ALTER TABLE cash_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'jour' CHECK (kind IN ('jour', 'garde'));
CREATE INDEX idx_cash_opened ON cash_sessions(opened_at);

-- V-03 : espèces remises par le client et rendu de monnaie (les paiements portent le montant affecté).
ALTER TABLE sales ADD COLUMN cash_tendered INTEGER;
ALTER TABLE sales ADD COLUMN change_given INTEGER NOT NULL DEFAULT 0 CHECK (change_given >= 0);
-- V-06 : événement de la vente (empreinte courte imprimée sur le ticket).
ALTER TABLE sales ADD COLUMN event_seq INTEGER;
CREATE INDEX idx_sales_user ON sales(user_id, created_at);
CREATE INDEX idx_sales_prescription ON sales(prescription_id);
CREATE INDEX idx_sale_lines_product ON sale_lines(product_id);
CREATE INDEX idx_payments_method ON payments(method);

-- O-05 : levée motivée de l'avertissement d'ordonnance ancienne ; O-04 : empreinte du fichier chiffré.
ALTER TABLE prescriptions ADD COLUMN age_override_reason TEXT;
ALTER TABLE prescriptions ADD COLUMN image_sha256 TEXT;
ALTER TABLE prescriptions ADD COLUMN image_mime TEXT;
ALTER TABLE prescriptions ADD COLUMN created_by TEXT REFERENCES users(id);

-- Q-01 : clôture d'un rappel.
ALTER TABLE recalls ADD COLUMN closed_by TEXT REFERENCES users(id);
ALTER TABLE recalls ADD COLUMN closed_at TEXT;
CREATE INDEX idx_recalls_active ON recalls(active, product_id);
