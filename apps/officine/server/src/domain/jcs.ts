/**
 * Forme canonique JSON (RFC 8785, JCS), restreinte aux données du projet :
 * objets, tableaux, chaînes, entiers sûrs, booléens, null.
 * Les nombres non entiers et les valeurs undefined sont refusés (annexe C §4.4).
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function jcs(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isSafeInteger(v)) throw new Error(`JCS : nombre non entier ou hors limites (${v})`);
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      return (
        '{' +
        keys
          .map((k) => {
            if (o[k] === undefined) throw new Error(`JCS : clé undefined interdite (${k})`);
            return JSON.stringify(k) + ':' + jcs(o[k]);
          })
          .join(',') +
        '}'
      );
    }
    default:
      throw new Error(`JCS : type non pris en charge (${typeof v})`);
  }
}
