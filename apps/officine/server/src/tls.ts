import { existsSync, readFileSync } from 'node:fs';
import type { Config } from './config.js';
import { paths } from './security/keys.js';

/** I-05 : refuse HTTP simple, sauf VP_REQUIRE_TLS=false posé explicitement (journalisé). */
export function resolveTls(config: Config): { key: Buffer; cert: Buffer } | null {
  const p = paths(config.dataDir);
  if (!config.requireTls) return null;
  if (!existsSync(p.tlsKey) || !existsSync(p.tlsCert)) {
    throw new Error(
      `TLS obligatoire : ${p.tlsCert} introuvable. Lancer l'initialisation, ou poser VP_REQUIRE_TLS=false en développement.`,
    );
  }
  return { key: readFileSync(p.tlsKey), cert: readFileSync(p.tlsCert) };
}

// Suites AEAD uniquement pour TLS 1.2 ; TLS 1.3 n'a que des suites AEAD.
export const TLS12_CIPHERS = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
].join(':');
