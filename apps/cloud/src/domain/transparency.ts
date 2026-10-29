import { sign, verify, type KeyObject } from 'node:crypto';
import {
  b64url, checkpointLeafData, consistencyProof, fromB64url, inclusionProof, leafHash, rootHash, sthMessage, verifyConsistency, verifyInclusion,
} from '@visionpharma/protocol';

/**
 * TL-01 à TL-04 : journal de transparence des points de contrôle des nœuds (RFC 9162). Fonctions pures :
 * la base fournit les empreintes des feuilles dans l'ordre d'ajout ; rien ici ne dépend de PostgreSQL.
 */

export interface Sth {
  tree_size: number;
  root_hash: string;
  timestamp: string;
  signature: string;
}

export interface CheckpointLeaf {
  node_id: string;
  seq: number;
  hash: string;
  signature: string;
  kid: string;
}

export const leafOf = (c: CheckpointLeaf): Buffer => leafHash(checkpointLeafData(c));

export function signSth(key: KeyObject, leaves: Buffer[], timestamp: string): Sth {
  const root = rootHash(leaves).toString('hex');
  return { tree_size: leaves.length, root_hash: root, timestamp, signature: b64url(sign(null, Buffer.from(sthMessage(leaves.length, root, timestamp)), key)) };
}

export function verifySth(key: KeyObject, sth: Sth): boolean {
  try {
    return verify(null, Buffer.from(sthMessage(sth.tree_size, sth.root_hash, sth.timestamp)), key, fromB64url(sth.signature));
  } catch {
    return false;
  }
}

export interface InclusionBundle {
  leaf_index: number;
  tree_size: number;
  audit_path: string[];
}

export function inclusionBundle(leaves: Buffer[], index: number, treeSize = leaves.length): InclusionBundle {
  return { leaf_index: index, tree_size: treeSize, audit_path: inclusionProof(index, leaves.slice(0, treeSize)).map((h) => h.toString('hex')) };
}

export function consistencyBundle(leaves: Buffer[], first: number, second: number): string[] {
  return consistencyProof(first, leaves.slice(0, second)).map((h) => h.toString('hex'));
}

export type ProofCheck = { ok: true } | { ok: false; reason: string };

/** Vérification autonome (TL-04) : signature de la tête, puis preuve d'inclusion du point de contrôle. */
export function checkInclusion(key: KeyObject, sth: Sth, leaf: CheckpointLeaf, p: InclusionBundle): ProofCheck {
  if (!verifySth(key, sth)) return { ok: false, reason: 'tête d’arbre mal signée' };
  if (p.tree_size !== sth.tree_size) return { ok: false, reason: 'taille de preuve différente de la tête' };
  const ok = verifyInclusion(leafOf(leaf), p.leaf_index, p.tree_size, p.audit_path.map((h) => Buffer.from(h, 'hex')), Buffer.from(sth.root_hash, 'hex'));
  return ok ? { ok: true } : { ok: false, reason: 'preuve d’inclusion invalide' };
}

/** Vérification autonome (TL-04) : deux têtes signées et la preuve qu'elles sont cohérentes. */
export function checkConsistency(key: KeyObject, first: Sth, second: Sth, proof: string[]): ProofCheck {
  if (!verifySth(key, first) || !verifySth(key, second)) return { ok: false, reason: 'tête d’arbre mal signée' };
  const ok = verifyConsistency(first.tree_size, second.tree_size, Buffer.from(first.root_hash, 'hex'), Buffer.from(second.root_hash, 'hex'), proof.map((h) => Buffer.from(h, 'hex')));
  return ok ? { ok: true } : { ok: false, reason: 'preuve de cohérence invalide' };
}
