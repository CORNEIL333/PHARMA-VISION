/**
 * Archive tar (ustar) minimale pour les sauvegardes (doc 06 §4.3) : fichiers ordinaires seulement.
 * La lecture refuse tout chemin absolu, toute remontée (`..`) et tout type d'entrée autre qu'un fichier.
 */

export interface TarEntry {
  name: string;
  data: Buffer;
}

const BLOCK = 512;

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

function header(name: string, size: number, mtime: number): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`Nom trop long pour l'archive : ${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(mtime, 12), 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write('0', 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

export function writeTar(entries: TarEntry[], mtime = 0): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.name, e.data.length, mtime), e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

function safeName(name: string): boolean {
  return name.length > 0 && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && !name.includes('\\') &&
    name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] ?? 0);
    if (!safeName(name) || (type !== '0' && type !== '\0') || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Entrée d'archive refusée : ${name}`);
    }
    off += BLOCK;
    if (off + size > buf.length) throw new Error('Archive tronquée');
    out.push({ name, data: Buffer.from(buf.subarray(off, off + size)) });
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
