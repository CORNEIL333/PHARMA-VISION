import { sweepSleepingProducts } from '../domain/catalog.js';
import type { Services } from '../services.js';
import { msUntilNextLocalMidnight } from './checkpoints.js';

/** C-05 : douze mois sans vente ni stock → `sleeping`. Tâche quotidienne, à minuit heure de Douala. */
export const SLEEPING_MONTHS = 12;

export function scheduleDailyCatalogSweep(s: Services, onError: (e: unknown) => void): () => void {
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(
      () => {
        try {
          sweepSleepingProducts(s, SLEEPING_MONTHS);
        } catch (e) {
          onError(e);
        }
        arm();
      },
      msUntilNextLocalMidnight(s.clock.now()) + 1000,
    );
    timer.unref();
  };
  arm();
  return () => clearTimeout(timer);
}
