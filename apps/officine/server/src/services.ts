import type { Clock } from './clock.js';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { Ledger } from './domain/ledger.js';
import type { NodeKeys } from './security/keys.js';

/** Dépendances partagées, injectées partout (testable : horloge et répertoire remplaçables). */
export interface Services {
  db: DB;
  ledger: Ledger;
  clock: Clock;
  keys: NodeKeys;
  config: Config;
  /** Hachage des mots de passe : paramètres réduits possibles uniquement dans test/ (GUARDRAILS 12). */
  scryptParams?: { N: number; r: number; p: number };
}
