/** C-07 : encodage EAN-13 en modules (1 = barre, 0 = espace), sans dépendance. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const G = R.map((p) => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 attendu');
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? L : G)[d[i]!]!;
  out += '01010';
  for (let i = 7; i <= 12; i++) out += R[d[i]!]!;
  return out + '101';
}
