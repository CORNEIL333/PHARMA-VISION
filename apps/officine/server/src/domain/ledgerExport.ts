import { createPublicKey, type KeyObject } from 'node:crypto';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { sha256hex } from '../security/crypto.js';
import type { Services } from '../services.js';
import { jcs, type Json } from './jcs.js';
import { computeHash, verifyCheckpointSignature, type Checkpoint } from './ledger.js';

/**
 * J-05 : file d'envoi (`synced_at IS NULL`) exportée en JSON Lines au format CloudEvents 1.0.2
 * (annexe C §1), terminée par le point de contrôle signé de la dernière ligne. Rien n'est envoyé
 * ni marqué comme envoyé : l'export prépare le futur branchement au cloud.
 */

interface EventRow {
  seq: number;
  id: string;
  type: string;
  at: string;
  actor: string | null;
  payload: string;
  prev_hash: string;
  hash: string;
}

export interface CloudEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: 'application/json';
  dataschema: string;
  subject: string | null;
  data: { [k: string]: Json };
  vpseq: number;
  vpprevhash: string;
  vphash: string;
  vpactor: string | null;
}

const SUBJECT_KEYS = ['sale_id', 'lot_id', 'product_id', 'po_id', 'reception_id', 'session_id', 'recall_id', 'user_id', 'device_id'];

export function toCloudEvent(nodeId: string, r: EventRow): CloudEvent {
  const data = JSON.parse(r.payload) as { [k: string]: Json };
  const subjectKey = SUBJECT_KEYS.find((k) => typeof data[k] === 'string');
  return {
    specversion: '1.0', id: r.id, source: `urn:visionpharma:node:${nodeId}`, type: `cm.visionpharma.${r.type}`,
    time: r.at, datacontenttype: 'application/json', dataschema: `urn:visionpharma:schema:${r.type}:v1`,
    subject: subjectKey ? (data[subjectKey] as string) : null, data,
    vpseq: r.seq, vpprevhash: r.prev_hash, vphash: r.hash, vpactor: r.actor,
  };
}

export interface LedgerExport {
  filename: string;
  body: string;
  from_seq: number;
  to_seq: number;
  sha256: string;
}

/** Export signé de la file d'envoi ; l'événement `ledger.exported` est écrit après la tête exportée. */
export function exportQueue(s: Services, actor: string): LedgerExport {
  return writeTx(s.db, () => {
    const cp = s.ledger.checkpoint();
    if (!cp) throw new AppError('invalid_transition', 'Journal vide');
    const rows = s.db.prepare('SELECT * FROM events WHERE synced_at IS NULL AND seq <= ? ORDER BY seq').all(cp.seq) as EventRow[];
    const nodeId = s.keys.identity.node_id;
    const lines = rows.map((r) => jcs(toCloudEvent(nodeId, r)));
    lines.push(jcs({
      type: 'checkpoint', node_id: nodeId, seq: cp.seq, hash: cp.hash, signature: cp.signature, key_id: cp.key_id, at: cp.at,
      public_key_pem: s.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }));
    const body = lines.join('\n') + '\n';
    const sha256 = sha256hex(body);
    const from = rows[0]?.seq ?? cp.seq;
    s.ledger.append('ledger.exported', actor, { from_seq: from, to_seq: cp.seq, count: rows.length, sha256 });
    return { filename: `vp-journal-${nodeId.slice(0, 8)}-${from}-${cp.seq}.jsonl`, body, from_seq: from, to_seq: cp.seq, sha256 };
  });
}

export type ExportCheck = { ok: true; events: number; to_seq: number } | { ok: false; line: number; detail: string };

/** Re-vérification autonome d'un export : empreintes, chaînage, point de contrôle signé. */
export function verifyExport(body: string, trustedKey?: KeyObject): ExportCheck {
  const lines = body.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, line: 0, detail: 'Export vide' };
  let cp: Checkpoint & { node_id: string; public_key_pem: string };
  try {
    cp = JSON.parse(lines.at(-1)!) as typeof cp;
  } catch {
    return { ok: false, line: lines.length, detail: 'Point de contrôle illisible' };
  }
  let prev: string | null = null;
  let last: CloudEvent | null = null;
  for (let i = 0; i < lines.length - 1; i++) {
    const e = JSON.parse(lines[i]!) as CloudEvent;
    const type = e.type.replace(/^cm\.visionpharma\./, '');
    const hash = computeHash({ seq: e.vpseq, id: e.id, type, at: e.time, actor: e.vpactor, payload: e.data, prev_hash: e.vpprevhash });
    if (hash !== e.vphash) return { ok: false, line: i + 1, detail: `Empreinte invalide (seq ${e.vpseq})` };
    if (prev !== null && e.vpprevhash !== prev) return { ok: false, line: i + 1, detail: `Chaînage rompu (seq ${e.vpseq})` };
    if (last && e.vpseq !== last.vpseq + 1) return { ok: false, line: i + 1, detail: `Trou avant seq ${e.vpseq}` };
    prev = e.vphash;
    last = e;
  }
  if (last && (last.vpseq !== cp.seq || last.vphash !== cp.hash)) return { ok: false, line: lines.length, detail: 'Point de contrôle ≠ dernier événement' };
  const key = trustedKey ?? createPublicKey(cp.public_key_pem);
  if (!verifyCheckpointSignature(key, cp.node_id, cp.seq, cp.hash, cp.signature)) {
    return { ok: false, line: lines.length, detail: 'Signature du point de contrôle invalide' };
  }
  return { ok: true, events: lines.length - 1, to_seq: cp.seq };
}
