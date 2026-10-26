import { writeTx } from '../db/index.js';
import type { Services } from '../services.js';

/** J-03 : point de contrôle chaque jour à 00:00, heure de Douala (UTC+1, pas d'heure d'été). */
export const DOUALA_OFFSET_MS = 60 * 60_000;

export function msUntilNextLocalMidnight(now: Date): number {
  const local = now.getTime() + DOUALA_OFFSET_MS;
  const nextLocalMidnight = Math.floor(local / 86_400_000) * 86_400_000 + 86_400_000;
  return nextLocalMidnight - local;
}

export function scheduleDailyCheckpoint(s: Services, onError: (e: unknown) => void): () => void {
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(
      () => {
        try {
          writeTx(s.db, () => s.ledger.checkpoint());
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
