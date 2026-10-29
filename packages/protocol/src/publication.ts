import { sign, verify, type KeyObject } from 'node:crypto';
import { b64url, fromB64url, jcs, type Json } from './canonical.js';

/**
 * Données descendantes signées par la clé de publication du cloud (RF-02, RA-01) : le nœud vérifie la
 * signature avec la clé publique reçue à l'enrôlement, en plus de l'épinglage TLS.
 * Message signé : « VPPUB1|<kind>|<JCS du contenu> ».
 */
export type PublicationKind = 'recall' | 'referential';

export interface Signed<T> {
  kind: PublicationKind;
  body: T;
  signature: string;
}

const message = (kind: PublicationKind, body: unknown) => Buffer.from(`VPPUB1|${kind}|${jcs(body)}`, 'utf8');

export function signPublication<T extends { [k: string]: Json }>(key: KeyObject, kind: PublicationKind, body: T): Signed<T> {
  return { kind, body, signature: b64url(sign(null, message(kind, body), key)) };
}

export function verifyPublication<T>(key: KeyObject, kind: PublicationKind, p: Signed<T>): boolean {
  if (p.kind !== kind) return false;
  try {
    return verify(null, message(kind, p.body), key, fromB64url(p.signature));
  } catch {
    return false;
  }
}

/** Rappel diffusé par le cloud (RA-01). `version` croît sans trou ; `active=false` = clôture (RA-04). */
export interface RecallNotice {
  [k: string]: Json;
  id: string;
  version: number;
  reference: string;
  ref_code: string;
  lot_number: string | null;
  reason: string;
  source: string;
  regions: string[];
  active: boolean;
  issued_at: string;
}

/** Fiche du référentiel (format de l'annexe I, plus le statut d'autorisation). */
export interface ReferentialProduct {
  [k: string]: Json;
  ref_code: string;
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  presentation: string | null;
  category: string;
  rx_required: boolean;
  sensitive: boolean;
  criticity: number;
  storage: string | null;
  suggested_price: number | null;
  gtins: string[];
}

/** Version publiée du référentiel (RF-02) : les fiches modifiées depuis la version précédente. */
export interface ReferentialVersion {
  [k: string]: Json;
  version: number;
  published_at: string;
  products: ReferentialProduct[];
}

/** Réponse d'enrôlement (CL-02). */
export interface EnrolmentResponse {
  pharmacy_id: string;
  node_id: string;
  publication_public_key_pem: string;
  log_public_key_pem: string;
}
