/** Horloge injectable : le domaine ne lit jamais Date.now() directement. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Horloge de test, réglable. */
export class FixedClock implements Clock {
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(iso: string): void {
    this.t = Date.parse(iso);
  }
}

/** ISO 8601 UTC avec millisecondes : 2026-10-26T08:00:00.000Z */
export function iso(d: Date): string {
  return d.toISOString();
}
