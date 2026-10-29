import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkChain, checkpointMessage, consistencyProof, eventHash, fromCloudEvent, GENESIS_PREV_HASH, inclusionProof, jcs, leafHash,
  rootHash, signCheckpoint, signRequest, toCloudEvent, verifyCheckpoint, verifyConsistency, verifyInclusion, verifyRequest,
  type LedgerEvent,
} from '../src/index.js';

// Annexe C §4 : vecteurs obligatoires, identiques à ceux d'apps/officine.
const E1 = {
  seq: 1, id: '0b8f8a4e-3f5c-4c1e-9a43-6a0d1f6e2b11', type: 'system.initialized', at: '2026-10-26T08:00:00.000Z', actor: null,
  payload: { node_id: '7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01', schema: 1 }, prev_hash: GENESIS_PREV_HASH,
};
const H1 = '6d46c2ac7215c5609c4bc96c9e9453e041025608e72e32ef436b573a0b8d0e88';
const E2 = {
  seq: 2, id: '5a1e2f90-6b7d-4c3a-8e21-9f0b7c6d5e43', type: 'sale.completed', at: '2026-10-26T09:15:42.120Z', actor: 'u-3f9a',
  payload: { lines: [{ lot_id: 'l-A12', product_id: 'p-amox500', qty: 2, unit_price: 1500 }, { lot_id: 'l-B07', product_id: 'p-para500', qty: 1, unit_price: 1500 }], sale_id: 's-0001', total: 4500 },
  prev_hash: H1,
};
const H2 = 'ae767017e9e28a32b73188bc229a424929093808846548769d567670d0c19c53';
const SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const PRIV = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]), format: 'der', type: 'pkcs8' });
const PUB = createPublicKey(PRIV);
const NODE = '7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01';

describe('annexe C : vecteurs du journal (SY-02)', () => {
  it('J-02 empreintes des événements 1 et 2, octet pour octet', () => {
    expect(eventHash(E1)).toBe(H1);
    expect(eventHash(E2)).toBe(H2);
  });

  it('J-03 signature déterministe du point de contrôle (RFC 8032, vecteur 1)', () => {
    expect(PUB.export({ type: 'spki', format: 'der' }).subarray(12).toString('hex')).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
    expect(checkpointMessage(NODE, 2, H2)).toBe(`VPCKPT1|${NODE}|2|${H2}`);
    const sig = signCheckpoint(PRIV, NODE, 2, H2);
    expect(sig).toBe('eJl5AhBwsWpq1c_03hZcI9CKllizLvSNPaNGHAX22GpJrE_h-m2CNxAE5PsGiBCzzVYJkbAUF-I1s2FjS37pAw');
    expect(verifyCheckpoint(PUB, NODE, 2, H2, sig)).toBe(true);
    expect(verifyCheckpoint(PUB, NODE, 3, H2, sig)).toBe(false);
  });

  it('JCS refuse undefined et les nombres non entiers', () => {
    expect(() => jcs({ a: undefined })).toThrow();
    expect(() => jcs({ a: 1.5 })).toThrow();
    expect(jcs({ b: 1, a: [true, null, 'é'] })).toBe('{"a":[true,null,"é"],"b":1}');
  });
});

describe('SY-02 vérification de chaîne et enveloppe CloudEvents', () => {
  const events: LedgerEvent[] = [{ ...E1, hash: H1 }, { ...E2, hash: H2 }];
  it('chaîne intacte, puis octet modifié, trou et rupture détectés avec le seq', () => {
    expect(checkChain(events, { seq: 0, hash: GENESIS_PREV_HASH })).toEqual({ ok: true });
    const tampered = [events[0]!, { ...events[1]!, payload: { ...E2.payload, total: 4501 } }];
    expect(checkChain(tampered, { seq: 0, hash: GENESIS_PREV_HASH })).toEqual({ ok: false, seq: 2, reason: 'hash_mismatch' });
    expect(checkChain([events[1]!], { seq: 0, hash: GENESIS_PREV_HASH })).toEqual({ ok: false, seq: 2, reason: 'gap' });
    expect(checkChain([events[1]!], { seq: 1, hash: 'f'.repeat(64) })).toEqual({ ok: false, seq: 2, reason: 'chain_break' });
  });

  it('aller-retour CloudEvents sans perte', () => {
    const c = toCloudEvent(NODE, events[1]!);
    expect(c).toMatchObject({ type: 'cm.visionpharma.sale.completed', subject: 's-0001', vpseq: 2, source: `urn:visionpharma:node:${NODE}` });
    expect(fromCloudEvent(c)).toEqual(events[1]);
  });
});

describe('§1.1 requêtes signées', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const now = new Date('2026-10-29T10:00:00.000Z');
  const h = signRequest(privateKey, NODE, now.toISOString(), 'POST', '/sync/v1/batches', '{"x":1}');
  const check = (m: string, p: string, b: string, at = now) =>
    verifyRequest(publicKey, { node: h['x-vp-node'], date: h['x-vp-date'], signature: h['x-vp-signature'] }, m, p, b, at);
  it('signature valide ; corps, chemin, méthode ou horloge modifiés : refus', () => {
    expect(check('POST', '/sync/v1/batches', '{"x":1}')).toEqual({ ok: true });
    expect(check('POST', '/sync/v1/batches', '{"x":2}')).toEqual({ ok: false, reason: 'bad_signature' });
    expect(check('POST', '/sync/v1/other', '{"x":1}')).toEqual({ ok: false, reason: 'bad_signature' });
    expect(check('GET', '/sync/v1/batches', '{"x":1}')).toEqual({ ok: false, reason: 'bad_signature' });
    expect(check('POST', '/sync/v1/batches', '{"x":1}', new Date(now.getTime() + 6 * 60_000))).toEqual({ ok: false, reason: 'clock_skew' });
    expect(verifyRequest(publicKey, {}, 'POST', '/', '', now)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('TL-01 à TL-03 arbre de Merkle (RFC 9162)', () => {
  // Vecteurs de test de la RFC 6962 (Certificate Transparency) : 8 feuilles et racines successives.
  const DATA = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map((x) => Buffer.from(x, 'hex'));
  const ROOTS = [
    '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
    'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
    'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
    'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
    '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
    '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
    'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
    '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
  ];
  const leaves = DATA.map(leafHash);

  it('TL-01 racines des vecteurs de référence', () => {
    ROOTS.forEach((r, i) => expect(rootHash(leaves.slice(0, i + 1)).toString('hex'), `taille ${i + 1}`).toBe(r));
  });

  const many = Array.from({ length: 40 }, (_, i) => leafHash(Buffer.from(`feuille ${i}`)));
  it('TL-03 inclusion : toute feuille de tout arbre (1 à 40) ; preuve altérée refusée', () => {
    for (let n = 1; n <= 40; n++) {
      const root = rootHash(many.slice(0, n));
      for (let m = 0; m < n; m++) {
        const proof = inclusionProof(m, many.slice(0, n));
        expect(verifyInclusion(many[m]!, m, n, proof, root), `${m}/${n}`).toBe(true);
        if (proof.length) expect(verifyInclusion(many[m]!, m, n, [leafHash(Buffer.from('x')), ...proof.slice(1)], root)).toBe(false);
        if (n > 1) expect(verifyInclusion(many[(m + 1) % n]!, m, n, proof, root)).toBe(false);
      }
    }
  });

  it('TL-03 cohérence : toutes les paires m ≤ n ≤ 40 ; racine falsifiée refusée', () => {
    for (let n = 1; n <= 40; n++) {
      const second = rootHash(many.slice(0, n));
      for (let m = 1; m <= n; m++) {
        const first = rootHash(many.slice(0, m));
        const proof = consistencyProof(m, many.slice(0, n));
        expect(verifyConsistency(m, n, first, second, proof), `${m}→${n}`).toBe(true);
        if (m < n) expect(verifyConsistency(m, n, leafHash(Buffer.from('faux')), second, proof)).toBe(false);
      }
    }
  });
});

describe('RF-02 RA-01 publications signées', () => {
  it('signature vérifiée ; contenu, type ou clé modifiés : refus', async () => {
    const { signPublication, verifyPublication } = await import('../src/index.js');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519').publicKey;
    const body = { id: 'r1', version: 1, reference: 'DPML-1', ref_code: 'VP-1', lot_number: null, reason: 'x', source: 'DPML', regions: [], active: true, issued_at: '2026-10-29T10:00:00.000Z' };
    const p = signPublication(privateKey, 'recall', body);
    expect(verifyPublication(publicKey, 'recall', p)).toBe(true);
    expect(verifyPublication(publicKey, 'referential', p)).toBe(false);
    expect(verifyPublication(other, 'recall', p)).toBe(false);
    expect(verifyPublication(publicKey, 'recall', { ...p, body: { ...body, lot_number: 'L2' } })).toBe(false);
  });
});
