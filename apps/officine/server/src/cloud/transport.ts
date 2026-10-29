import { timingSafeEqual, X509Certificate } from 'node:crypto';
// HTTP/1.1 au-dessus de la socket TLS déjà vérifiée : `https.request` ouvrirait sa propre connexion.
import { request } from 'node:http';
import { isIP } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';
import { gzipSync } from 'node:zlib';
import { signRequest } from '@visionpharma/protocol';
import { AppError } from '../errors.js';
import { sha256hex } from '../security/crypto.js';
import type { Services } from '../services.js';
import { getSettings } from '../domain/settings.js';

/**
 * NO-02 : SEUL appel réseau sortant du nœud (GUARDRAILS 18, ADR-012). Il n'existe que si le titulaire
 * a activé la synchronisation, et ne vise que l'adresse configurée. La clé publique du certificat du
 * cloud est épinglée et vérifiée APRÈS la poignée de main TLS et AVANT l'envoi du moindre octet HTTP.
 * Les requêtes sont signées par la clé Ed25519 du nœud (docs/10 §1.1).
 */

export const TIMEOUT_MS = 15_000;

export interface CloudTarget {
  url: URL;
  spki: string;
}

/** Destination configurée ; refuse si la synchronisation n'est pas activée (sauf enrôlement explicite). */
export function cloudTarget(s: Services, requireEnabled = true): CloudTarget {
  const st = getSettings(s);
  if (requireEnabled && !st.cloud_sync_enabled) throw new AppError('invalid_transition', 'Synchronisation désactivée');
  if (!st.cloud_url || !st.cloud_spki_sha256) {
    throw new AppError('validation_failed', 'Cloud non configuré', 'Adresse et empreinte du cloud obligatoires.');
  }
  return { url: new URL(st.cloud_url), spki: st.cloud_spki_sha256 };
}

/** Empreinte SHA-256 de la clé publique SPKI (DER) d'un certificat. */
export function spkiSha256(certDer: Buffer): string {
  return sha256hex(new X509Certificate(certDer).publicKey.export({ type: 'spki', format: 'der' }));
}

/** Connexion TLS dont la clé publique est vérifiée avant toute donnée applicative. */
function pinnedSocket(t: CloudTarget): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const host = t.url.hostname;
    const socket = connect({
      host, port: Number(t.url.port || 443), servername: isIP(host) ? undefined : host,
      // La confiance repose sur l'épinglage de la clé, vérifié ci-dessous ; aucune donnée n'est envoyée avant.
      rejectUnauthorized: false, minVersion: 'TLSv1.2', timeout: TIMEOUT_MS,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const actual = cert?.raw ? spkiSha256(cert.raw) : '';
      const ok = actual.length === t.spki.length && timingSafeEqual(Buffer.from(actual), Buffer.from(t.spki));
      if (!ok) {
        socket.destroy();
        reject(new AppError('forbidden', 'Certificat du cloud non reconnu', "L'empreinte de la clé ne correspond pas à celle configurée.", { reason: 'pin_mismatch' }));
        return;
      }
      resolve(socket);
    });
    socket.once('timeout', () => socket.destroy(new Error('délai dépassé')));
    socket.once('error', (e) => reject(new AppError('cloud_unreachable', 'Cloud injoignable', e.message, { reason: 'unreachable' })));
  });
}

export interface CloudResponse {
  status: number;
  body: unknown;
}

/** Requête JSON vers le cloud ; signée par la clé du nœud sauf pour l'enrôlement. */
export async function cloudRequest(
  s: Services,
  t: CloudTarget,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts: { signed?: boolean; gzip?: boolean } = {},
): Promise<CloudResponse> {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.signed !== false) {
    Object.assign(headers, signRequest(s.keys.privateKey, s.keys.identity.node_id, s.clock.now().toISOString(), method, path, raw));
  }
  const payload = opts.gzip && raw ? gzipSync(raw) : Buffer.from(raw);
  if (opts.gzip && raw) headers['content-encoding'] = 'gzip';
  const socket = await pinnedSocket(t);
  return new Promise((resolve, reject) => {
    const req = request(
      { method, host: t.url.hostname, port: Number(t.url.port || 443), path, headers: { ...headers, host: t.url.host, 'content-length': String(payload.length) }, createConnection: () => socket, timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > 32 * 1024 * 1024) req.destroy(new Error('réponse trop volumineuse'));
          else chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => reject(new AppError('cloud_unreachable', 'Cloud injoignable', e.message, { reason: 'unreachable' })));
    req.end(payload);
  });
}
