/** Limitation de débit en mémoire, fenêtre glissante (A-04 : 10 tentatives par minute et par adresse IP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Renvoie true si la tentative est permise (et la compte). */
  take(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.sweep(t);
    return true;
  }

  private sweep(t: number): void {
    for (const [k, arr] of this.hits) if (arr.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}
