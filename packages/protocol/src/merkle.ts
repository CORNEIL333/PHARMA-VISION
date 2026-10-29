import { createHash } from 'node:crypto';

/**
 * Arbre de Merkle du journal de transparence (RFC 9162 §2.1, identique à RFC 6962) : SHA-256,
 * feuille = H(0x00 ‖ d), nœud = H(0x01 ‖ g ‖ d), découpage au plus grand k = 2^n < taille.
 * Les fonctions travaillent sur les empreintes des feuilles (Buffer de 32 octets).
 */

const H = (...parts: Uint8Array[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};
const ZERO = Buffer.from([0]);
const ONE = Buffer.from([1]);

export const leafHash = (data: Uint8Array): Buffer => H(ZERO, data);
export const nodeHash = (left: Uint8Array, right: Uint8Array): Buffer => H(ONE, left, right);

/** Plus grande puissance de 2 strictement inférieure à n (n ≥ 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** MTH(D[n]) à partir des empreintes des feuilles. */
export function rootHash(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return H();
  if (leaves.length === 1) return leaves[0]!;
  const k = split(leaves.length);
  return nodeHash(rootHash(leaves.slice(0, k)), rootHash(leaves.slice(k)));
}

/** PATH(m, D[n]) : preuve d'inclusion de la feuille m. */
export function inclusionProof(m: number, leaves: Buffer[]): Buffer[] {
  const n = leaves.length;
  if (m < 0 || m >= n) throw new Error('indice de feuille hors de l\'arbre');
  if (n === 1) return [];
  const k = split(n);
  return m < k
    ? [...inclusionProof(m, leaves.slice(0, k)), rootHash(leaves.slice(k))]
    : [...inclusionProof(m - k, leaves.slice(k)), rootHash(leaves.slice(0, k))];
}

/** Vérification d'une preuve d'inclusion (RFC 9162 §2.1.3.2). */
export function verifyInclusion(leaf: Buffer, index: number, size: number, proof: Buffer[], root: Buffer): boolean {
  if (index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r.equals(root);
}

/** PROOF(m, D[n]) : preuve de cohérence entre l'arbre de taille m et celui de taille n. */
export function consistencyProof(m: number, leaves: Buffer[]): Buffer[] {
  const n = leaves.length;
  if (m < 1 || m > n) throw new Error('tailles incohérentes');
  const sub = (m2: number, d: Buffer[], b: boolean): Buffer[] => {
    const n2 = d.length;
    if (m2 === n2) return b ? [] : [rootHash(d)];
    const k = split(n2);
    return m2 <= k
      ? [...sub(m2, d.slice(0, k), b), rootHash(d.slice(k))]
      : [...sub(m2 - k, d.slice(k), false), rootHash(d.slice(0, k))];
  };
  return m === n ? [] : sub(m, leaves, true);
}

/** Vérification d'une preuve de cohérence (RFC 9162 §2.1.4.2). */
export function verifyConsistency(m: number, n: number, firstRoot: Buffer, secondRoot: Buffer, proof: Buffer[]): boolean {
  if (m < 1 || m > n) return false;
  if (m === n) return proof.length === 0 && firstRoot.equals(secondRoot);
  let path = proof;
  if ((m & (m - 1)) === 0) path = [firstRoot, ...proof];
  if (path.length === 0) return false;
  let fn = m - 1;
  let sn = n - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let fr = path[0]!;
  let sr = path[0]!;
  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && fr.equals(firstRoot) && sr.equals(secondRoot);
}

/** Données d'une feuille : un point de contrôle de nœud (docs/10 TL-01). */
export function checkpointLeafData(c: { node_id: string; seq: number; hash: string; signature: string; kid: string }): Buffer {
  return Buffer.from(`VPCKPT1|${c.node_id}|${c.seq}|${c.hash}|${c.signature}|${c.kid}`, 'utf8');
}

/** Message signé d'une tête d'arbre (STH). */
export function sthMessage(size: number, rootHex: string, timestamp: string): string {
  return `VPSTH1|${size}|${rootHex}|${timestamp}`;
}
