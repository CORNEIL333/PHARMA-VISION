import type { CycleResult } from './cloud/cycle.js';
import type { Clock } from './clock.js';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { Ledger } from './domain/ledger.js';
import type { StockPolicy } from './domain/stock.js';
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
  /** Q-03 : marge de péremption (VP_EXPIRY_BLOCK_DAYS) ; 0 jour par défaut. */
  stockPolicy?: StockPolicy;
  /** B-04 : arrêt propre demandé (le superviseur systemd ou Docker redémarre le service). */
  requestRestart?: (reason: string) => void;
  /** NO-02 : cycle de synchronisation immédiat (tâche de fond partagée, un seul cycle à la fois). */
  cloudSync?: () => Promise<CycleResult>;
}
