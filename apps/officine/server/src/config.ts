import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Configuration lue depuis l'environnement, avec des valeurs par défaut sûres.
 * Aucune valeur secrète ici : les secrets vivent dans le répertoire de données (keys/).
 */
export interface Config {
  dataDir: string;
  host: string;
  port: number;
  requireTls: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug';
  webDist: string | null;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  reauthMinutes: number;
  checkpointEvery: number;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(`Valeur booléenne invalide : ${v}`);
}

function int(v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Valeur entière invalide : ${v}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const level = (env.VP_LOG_LEVEL ?? 'info') as Config['logLevel'];
  if (!['fatal', 'error', 'warn', 'info', 'debug'].includes(level)) throw new Error('VP_LOG_LEVEL invalide');
  return {
    dataDir: path.resolve(env.VP_DATA_DIR ?? './data-local'),
    host: env.VP_HOST ?? '0.0.0.0',
    port: int(env.VP_PORT, 8443, 1, 65535),
    requireTls: bool(env.VP_REQUIRE_TLS, true),
    logLevel: level,
    // Interface web : VP_WEB_DIST, sinon le build du dépôt (web/dist) s'il existe.
    webDist: env.VP_WEB_DIST
      ? path.resolve(env.VP_WEB_DIST)
      : existsSync(path.resolve('web/dist/index.html'))
        ? path.resolve('web/dist')
        : null,
    // Valeurs de la spécification (A-05, A-07, J-03) : non configurables à la baisse en production.
    sessionIdleMinutes: 30,
    sessionMaxHours: 12,
    reauthMinutes: 5,
    checkpointEvery: 100,
  };
}
