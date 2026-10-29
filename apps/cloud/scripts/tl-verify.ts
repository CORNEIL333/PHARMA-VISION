/**
 * TL-04 : vérificateur indépendant du journal de transparence, sans accès à la base.
 *   npm run tl-verify -- --key log.pub.pem --inclusion preuve.json
 *   npm run tl-verify -- --key log.pub.pem --consistency coherence.json
 * preuve.json      : { "sth": {…}, "leaf": { node_id, seq, hash, signature, kid }, "proof": { leaf_index, tree_size, audit_path } }
 * coherence.json   : { "first": {…}, "second": {…}, "proof": ["hex", …] }
 * Code de sortie : 0 = vérifié, 2 = preuve refusée, 1 = erreur d'usage.
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkConsistency, checkInclusion, type CheckpointLeaf, type InclusionBundle, type Sth } from '../src/domain/transparency.js';

const { values } = parseArgs({ options: { key: { type: 'string' }, inclusion: { type: 'string' }, consistency: { type: 'string' } } });
if (!values.key || (!values.inclusion && !values.consistency)) {
  console.error('Usage : --key <clé publique PEM du journal> (--inclusion <fichier> | --consistency <fichier>)');
  process.exit(1);
}
const key = createPublicKey(readFileSync(values.key));
const read = <T>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T;
const result = values.inclusion
  ? (() => {
      const f = read<{ sth: Sth; leaf: CheckpointLeaf; proof: InclusionBundle }>(values.inclusion!);
      return checkInclusion(key, f.sth, f.leaf, f.proof);
    })()
  : (() => {
      const f = read<{ first: Sth; second: Sth; proof: string[] }>(values.consistency!);
      return checkConsistency(key, f.first, f.second, f.proof);
    })();
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 2);
