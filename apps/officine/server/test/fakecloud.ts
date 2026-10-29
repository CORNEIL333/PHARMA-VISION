import { createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import {
  checkChain, fromCloudEvent, GENESIS_PREV_HASH, signPublication, verifyCheckpoint, verifyRequest,
  type LedgerEvent, type RecallNotice, type ReferentialVersion, type Signed, type SyncBatch,
} from '@visionpharma/protocol';
import { spkiSha256 } from '../src/cloud/transport.js';
import { createLocalCa, createServerCert } from '../src/security/x509.js';

/**
 * DOUBLE DE TEST (jamais utilisé hors de test/) : cloud minimal qui applique les vérifications du
 * protocole (docs/10 §1.1, §1.3, SY-02, SY-03) pour tester le nœud sans PostgreSQL. Le vrai cloud est
 * `apps/cloud` ; les scénarios RB-xx de bout en bout l'utiliseront.
 */
export interface FakeCloud {
  url: string;
  spki: string;
  token: string;
  publication: { privateKey: KeyObject; publicKey: KeyObject };
  events: LedgerEvent[];
  batches: SyncBatch[];
  httpRequests: number;
  tlsConnections: number;
  recalls: Signed<RecallNotice>[];
  versions: Signed<ReferentialVersion>[];
  acks: { id: string; version: number }[];
  /** Pannes simulées : coupure avant traitement, ou après stockage (accusé perdu). */
  failNext: { mode: 'cut' | 'lost_ack'; count: number; after?: number } | null;
  publishRecall(n: Omit<RecallNotice, 'version' | 'issued_at'>): void;
  publishVersion(products: ReferentialVersion['products']): void;
  close(): Promise<void>;
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function startFakeCloud(): Promise<FakeCloud> {
  const now = new Date();
  const ca = createLocalCa('Faux cloud de test', now);
  const cert = createServerCert(ca, ['localhost', '127.0.0.1'], now);
  const publication = generateKeyPairSync('ed25519');
  const nodes = new Map<string, KeyObject>();
  const fc = {
    url: '', spki: spkiSha256(Buffer.from(cert.certPem.replace(/-----[^-]+-----|\s/g, ''), 'base64')), token: 'jeton-enrolement-' + randomUUID().replace(/-/g, ''),
    publication, events: [], batches: [], httpRequests: 0, tlsConnections: 0, recalls: [], versions: [], acks: [], failNext: null,
    publishRecall(n) {
      fc.recalls.push(signPublication(publication.privateKey, 'recall', { ...n, version: fc.recalls.length + 1, issued_at: new Date().toISOString() } as RecallNotice));
    },
    publishVersion(products) {
      fc.versions.push(signPublication(publication.privateKey, 'referential', { version: fc.versions.length + 1, published_at: new Date().toISOString(), products } as ReferentialVersion));
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as FakeCloud;
  const json = (res: ServerResponse, status: number, v: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
  };
  const server: Server = createServer({ key: cert.keyPem, cert: cert.certPem }, async (req, res) => {
    fc.httpRequests++;
    const raw = await body(req);
    const text = (req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8');
    const path = req.url ?? '/';
    if (path === '/enrol/v1' && req.method === 'POST') {
      const b = JSON.parse(text) as { token: string; node_id: string; public_key_pem: string; checkpoint: { seq: number; hash: string; signature: string } };
      if (b.token !== fc.token) return json(res, 401, { code: 'invalid_token' });
      const key = createPublicKey(b.public_key_pem);
      if (!verifyCheckpoint(key, b.node_id, b.checkpoint.seq, b.checkpoint.hash, b.checkpoint.signature)) return json(res, 422, { code: 'bad_signature' });
      nodes.set(b.node_id, key);
      return json(res, 200, { pharmacy_id: 'pharmacie-test', node_id: b.node_id, publication_public_key_pem: publication.publicKey.export({ type: 'spki', format: 'pem' }), log_public_key_pem: publication.publicKey.export({ type: 'spki', format: 'pem' }) });
    }
    const nodeId = String(req.headers['x-vp-node'] ?? '');
    const key = nodes.get(nodeId);
    const check = key ? verifyRequest(key, { node: nodeId, date: String(req.headers['x-vp-date']), signature: String(req.headers['x-vp-signature']) }, req.method ?? '', path, text, new Date()) : { ok: false };
    if (!check.ok) return json(res, 401, { code: 'unauthenticated' });
    if (path === '/sync/v1/batches' && req.method === 'POST') {
      const due = () => !!fc.failNext && (fc.failNext.after ?? 0) <= 0 && fc.failNext.count > 0;
      if (fc.failNext && (fc.failNext.after ?? 0) > 0) fc.failNext.after = (fc.failNext.after ?? 0) - 1;
      else if (fc.failNext?.mode === 'cut' && due()) {
        fc.failNext.count--;
        return req.socket.destroy();
      }
      const batch = JSON.parse(text) as SyncBatch;
      fc.batches.push(batch);
      const known = new Set(fc.events.map((e) => e.id));
      const incoming = batch.events.map(fromCloudEvent).filter((e) => !known.has(e.id));
      const head = fc.events.at(-1) ?? { seq: 0, hash: GENESIS_PREV_HASH };
      const chain = checkChain(incoming, head);
      if (!chain.ok) return json(res, 409, { code: 'chain_quarantined', seq: chain.seq });
      const last = batch.events.at(-1)!;
      if (!verifyCheckpoint(key!, nodeId, batch.checkpoint.seq, batch.checkpoint.hash, batch.checkpoint.signature) || batch.checkpoint.hash !== last.vphash) {
        return json(res, 422, { code: 'bad_checkpoint' });
      }
      fc.events.push(...incoming);
      if (fc.failNext?.mode === 'lost_ack' && due()) {
        fc.failNext.count--;
        return req.socket.destroy();
      }
      const top = fc.events.at(-1)!;
      return json(res, 200, { acked: batch.events.map((e) => e.id), head: { seq: top.seq, hash: top.hash } });
    }
    const since = Number(new URL(path, 'https://x').searchParams.get('since') ?? '0');
    if (path.startsWith('/sync/v1/recalls?')) return json(res, 200, { items: fc.recalls.filter((r) => r.body.version > since) });
    if (path.startsWith('/sync/v1/referential?')) return json(res, 200, { versions: fc.versions.filter((v) => v.body.version > since) });
    const ack = /^\/sync\/v1\/recalls\/([^/]+)\/ack$/.exec(path);
    if (ack && req.method === 'POST') {
      fc.acks.push({ id: decodeURIComponent(ack[1]!), version: (JSON.parse(text) as { version: number }).version });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { code: 'not_found' });
  });
  // Connexions TCP reçues (la poignée de main peut se terminer après la coupure par le client).
  server.on('connection', () => fc.tlsConnections++);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fc.url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fc;
}
