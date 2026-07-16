/**
 * Deterministic sampling helpers for the practice quiz.
 *
 * A seeded shuffle keeps a session reproducible (same seed => same order), which is
 * handy for "retry the same set" and for testing. `pickN` draws a sample without
 * replacement using the seeded shuffle.
 *
 * Import from "@lib/sample".
 */

/** mulberry32 PRNG — small, fast, good enough for shuffling quiz pools. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary string into a 32-bit seed (for stable per-topic seeds). */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Fisher-Yates shuffle. Returns a NEW array (does not mutate input).
 * If `seed` is omitted, uses Math.random (non-deterministic).
 */
export function seededShuffle<T>(items: readonly T[], seed?: number): T[] {
  const rand = seed === undefined ? Math.random : mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Default number of questions in a practice session. */
export const DEFAULT_SAMPLE_SIZE = 25;

/**
 * Pick N items without replacement. Shuffles (optionally seeded) then takes the
 * first `n`. If the pool has fewer than `n`, returns the whole pool shuffled.
 */
export function pickN<T>(
  pool: readonly T[],
  n: number = DEFAULT_SAMPLE_SIZE,
  seed?: number,
): T[] {
  return seededShuffle(pool, seed).slice(0, Math.max(0, n));
}
