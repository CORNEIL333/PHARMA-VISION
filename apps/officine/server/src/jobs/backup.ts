import { createBackup } from '../domain/backup.js';
import { getSetting } from '../domain/settings.js';
import type { Services } from '../services.js';
import { DOUALA_OFFSET_MS } from './checkpoints.js';

/** B-02 : délai jusqu'à la prochaine occurrence de `hour`:00, heure de Douala. */
export function msUntilNextLocalHour(now: Date, hour: number): number {
  const local = now.getTime() + DOUALA_OFFSET_MS;
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000;
  let next = dayStart + hour * 3_600_000;
  if (next <= local) next += 86_400_000;
  return next - local;
}

/** B-02 : sauvegarde automatique quotidienne à l'heure configurée (relue à chaque armement). */
export function scheduleDailyBackup(s: Services, onDone: (r: unknown) => void, onError: (e: unknown) => void): () => void {
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(() => {
      createBackup(s, null, 'scheduled').then(onDone, onError).finally(arm);
    }, msUntilNextLocalHour(s.clock.now(), getSetting(s, 'backup_hour')) + 1000);
    timer.unref();
  };
  arm();
  return () => clearTimeout(timer);
}
