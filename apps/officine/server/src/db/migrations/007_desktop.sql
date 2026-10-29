-- W-08 : mode caisse plein écran (kiosque) activé par le titulaire pour un poste.
ALTER TABLE devices ADD COLUMN kiosk INTEGER NOT NULL DEFAULT 0;
