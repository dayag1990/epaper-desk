/** Small fixed-window limiter, per key, in memory. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** true = allowed. Counts the attempt. */
  take(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= t) { this.hits.set(key, { n: 1, reset: t + this.windowMs }); return this.gc(t), true; }
    h.n += 1;
    return h.n <= this.max;
  }
  retryAfterS(key: string): number {
    const h = this.hits.get(key);
    return h ? Math.max(1, Math.ceil((h.reset - this.now()) / 1000)) : 0;
  }
  private gc(t: number) { if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset <= t) this.hits.delete(k); }
}
