import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Génération de certificats X.509 v3 (ECDSA P-256 / SHA-256) avec node:crypto seul (I-01) :
 * une autorité de certification locale et le certificat TLS du serveur signé par elle.
 * Encodeur DER minimal, limité aux structures nécessaires (RFC 5280).
 */

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), len(value.length), value]);
}
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const ctx = (n: number, v: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, v);
const octet = (v: Buffer) => tlv(0x04, v);
const bitString = (v: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), v]));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));

function integer(v: Buffer | number): Buffer {
  let b = typeof v === 'number' ? Buffer.from([v]) : v;
  while (b.length > 1 && b[0] === 0 && (b[1] ?? 0) < 0x80) b = b.subarray(1);
  if ((b[0] ?? 0) & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
  for (const p of parts.slice(2)) {
    const stack: number[] = [p & 0x7f];
    let n = p >>> 7;
    while (n > 0) {
      stack.unshift((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
  const y = d.getUTCFullYear();
  const p = (n: number) => String(n).padStart(2, '0');
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  // RFC 5280 : UTCTime jusqu'en 2049, GeneralizedTime ensuite.
  return y < 2050
    ? tlv(0x17, Buffer.from(String(y).slice(2) + body))
    : tlv(0x18, Buffer.from(String(y) + body));
}

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  cn: '2.5.4.3',
  o: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
  san: '2.5.29.17',
  ski: '2.5.29.14',
  aki: '2.5.29.35',
};

function name(cn: string): Buffer {
  return seq(set(seq(oid(OID.o), utf8('VisionPharma'))), set(seq(oid(OID.cn), utf8(cn))));
}

function ext(id: string, critical: boolean, value: Buffer): Buffer {
  return critical ? seq(oid(id), bool(true), octet(value)) : seq(oid(id), octet(value));
}

function keyId(spki: Buffer): Buffer {
  return createHash('sha1').update(spki).digest(); // identifiant de clé (RFC 5280 §4.2.1.2), pas un usage de sécurité
}

/** keyUsage BIT STRING : bits nommés, encodage DER minimal. */
function keyUsage(bits: number[]): Buffer {
  let v = 0;
  for (const b of bits) v |= 1 << (15 - b);
  const bytes = Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  const used = bytes[1] === 0 ? bytes.subarray(0, 1) : bytes;
  const last = used[used.length - 1] ?? 0;
  let unused = 0;
  while (unused < 7 && ((last >> unused) & 1) === 0) unused++;
  return tlv(0x03, Buffer.concat([Buffer.from([unused]), used]));
}

interface CertInput {
  subject: string;
  issuer: string;
  subjectKey: KeyObject;
  issuerKey: KeyObject;
  issuerSpki: Buffer;
  notBefore: Date;
  notAfter: Date;
  extensions: Buffer[];
}

function buildCert(c: CertInput): string {
  const spki = c.subjectKey.export({ type: 'spki', format: 'der' });
  const algId = seq(oid(OID.ecdsaSha256));
  const serial = randomBytes(16);
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const tbs = seq(
    ctx(0, integer(2)),
    integer(serial),
    algId,
    name(c.issuer),
    seq(time(c.notBefore), time(c.notAfter)),
    name(c.subject),
    spki,
    ctx(3, seq(...c.extensions)),
  );
  const sig = sign('sha256', tbs, { key: c.issuerKey, dsaEncoding: 'der' });
  const der = seq(tbs, algId, bitString(sig));
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
}

export interface Pem {
  keyPem: string;
  certPem: string;
}

const DAY = 86_400_000;

export function createLocalCa(commonName: string, now: Date, years = 10): Pem & { key: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const certPem = buildCert({
    subject: commonName,
    issuer: commonName,
    subjectKey: publicKey,
    issuerKey: privateKey,
    issuerSpki: spki,
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + years * 365 * DAY),
    extensions: [
      ext(OID.basicConstraints, true, seq(bool(true), integer(0))),
      ext(OID.keyUsage, true, keyUsage([5, 6])), // keyCertSign, cRLSign
      ext(OID.ski, false, octet(keyId(spki))),
    ],
  });
  return { key: privateKey, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), certPem };
}

export function createServerCert(
  ca: { key: KeyObject; certPem: string },
  names: string[],
  now: Date,
  years = 2,
): Pem {
  const caCert = new X509Certificate(ca.certPem);
  const caSpki = caCert.publicKey.export({ type: 'spki', format: 'der' });
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const generalNames = names.map((n) => {
    const ipv = isIP(n);
    if (ipv === 4) return ctx(7, Buffer.from(n.split('.').map(Number)), false);
    if (ipv === 6) return ctx(7, ipv6Bytes(n), false);
    return ctx(2, Buffer.from(n, 'ascii'), false);
  });
  const caCn = /CN=([^\n]+)/.exec(caCert.subject)?.[1] ?? 'VisionPharma CA';
  const certPem = buildCert({
    subject: names[0] ?? 'localhost',
    issuer: caCn,
    subjectKey: publicKey,
    issuerKey: ca.key,
    issuerSpki: caSpki,
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + years * 365 * DAY),
    extensions: [
      ext(OID.basicConstraints, true, seq()),
      ext(OID.keyUsage, true, keyUsage([0])), // digitalSignature
      ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      ext(OID.san, false, seq(...generalNames)),
      ext(OID.ski, false, octet(keyId(spki))),
      ext(OID.aki, false, seq(ctx(0, keyId(caSpki), false))),
    ],
  });
  return { keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), certPem };
}

function ipv6Bytes(ip: string): Buffer {
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  return out;
}

/** Empreinte SHA-256 d'un certificat, format AA:BB:… (I-06). */
export function fingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}
