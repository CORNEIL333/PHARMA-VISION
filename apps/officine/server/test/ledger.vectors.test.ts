import { createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { jcs } from '../src/domain/jcs.js';
import {
  computeHash,
  GENESIS_PREV_HASH,
  signCheckpoint,
  verifyCheckpointSignature,
} from '../src/domain/ledger.js';

// Vecteurs officiels : annexes/C-evenements.md §4. Ils ne doivent JAMAIS changer (GUARDRAILS 8).
const NODE = '7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01';
const E1 = {
  seq: 1,
  id: '0b8f8a4e-3f5c-4c1e-9a43-6a0d1f6e2b11',
  type: 'system.initialized',
  at: '2026-10-26T08:00:00.000Z',
  actor: null,
  payload: { node_id: NODE, schema: 1 },
  prev_hash: GENESIS_PREV_HASH,
};
const H1 = '6d46c2ac7215c5609c4bc96c9e9453e041025608e72e32ef436b573a0b8d0e88';
const E2 = {
  seq: 2,
  id: '5a1e2f90-6b7d-4c3a-8e21-9f0b7c6d5e43',
  type: 'sale.completed',
  at: '2026-10-26T09:15:42.120Z',
  actor: 'u-3f9a',
  payload: {
    sale_id: 's-0001',
    total: 4500,
    lines: [
      { product_id: 'p-amox500', lot_id: 'l-A12', qty: 2, unit_price: 1500 },
      { product_id: 'p-para500', lot_id: 'l-B07', qty: 1, unit_price: 1500 },
    ],
  },
  prev_hash: H1,
};
const H2 = 'ae767017e9e28a32b73188bc229a424929093808846548769d567670d0c19c53';
const SIG = 'eJl5AhBwsWpq1c_03hZcI9CKllizLvSNPaNGHAX22GpJrE_h-m2CNxAE5PsGiBCzzVYJkbAUF-I1s2FjS37pAw';

// RFC 8032 §7.1, test 1 : graine encapsulée en PKCS#8 DER.
const SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const testKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'hex')]),
  format: 'der',
  type: 'pkcs8',
});

describe('J-02 vecteurs de test du journal (annexe C §4)', () => {
  it('J-02 forme canonique de l’événement 1 identique à l’annexe', () => {
    expect(jcs(E1)).toBe(
      '{"actor":null,"at":"2026-10-26T08:00:00.000Z","id":"0b8f8a4e-3f5c-4c1e-9a43-6a0d1f6e2b11","payload":{"node_id":"7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01","schema":1},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"type":"system.initialized"}',
    );
  });
  it('J-02 empreinte de l’événement 1', () => expect(computeHash(E1)).toBe(H1));
  it('J-02 empreinte de l’événement 2 chaînée sur le 1', () => expect(computeHash(E2)).toBe(H2));
  it('J-03 clé publique du vecteur RFC 8032', () => {
    const raw = createPublicKey(testKey)
      .export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('hex');
    expect(raw).toBe('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  });
  it('J-03 signature déterministe du point de contrôle sur l’événement 2', () => {
    const sig = signCheckpoint({ nodeId: NODE, kid: 'test', privateKey: testKey }, 2, H2);
    expect(sig).toBe(SIG);
    expect(verifyCheckpointSignature(createPublicKey(testKey), NODE, 2, H2, sig)).toBe(true);
    expect(verifyCheckpointSignature(createPublicKey(testKey), NODE, 2, H1, sig)).toBe(false);
  });
  it('J-02 refuse undefined et les nombres non entiers dans un contenu', () => {
    expect(() => jcs({ a: undefined })).toThrow();
    expect(() => jcs({ a: 1.5 })).toThrow();
  });
});
