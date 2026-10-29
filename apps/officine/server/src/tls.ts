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
  // Chaîne complète (certificat du serveur + autorité locale) : l'application de bureau extrait l'autorité
  // de la poignée de main pour l'afficher à l'appairage (W-02) puis l'épingle (W-03).
  const leaf = readFileSync(p.tlsCert);
  const chain = existsSync(p.caCert) ? Buffer.concat([leaf, Buffer.from('\n'), readFileSync(p.caCert)]) : leaf;
  return { key: readFileSync(p.tlsKey), cert: chain };
}

// Suites AEAD uniquement pour TLS 1.2 ; TLS 1.3 n'a que des suites AEAD.
export const TLS12_CIPHERS = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
].join(':');
