// A small in-memory limiter (one API process): `max` hits per `windowMs` per key.
const hits = new Map<string, number[]>();

/** True when this hit is allowed; false when the key has used up its window. */
export function allow(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
export const resetLimits = () => hits.clear();
