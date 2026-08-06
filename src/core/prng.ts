/**
 * Seeded PRNG for the simulation core (TDD §4.2).
 * mulberry32: fast, 32-bit state, good-enough statistical quality for game randomness.
 * The single instance is owned by the sim and advanced ONLY inside tick(); its state is
 * part of RunState so save/load preserves determinism exactly.
 */

export interface Prng {
  /** Next float in [0, 1). Advances internal state. */
  next(): number;
  /** Current 32-bit state, for persistence. */
  getState(): number;
}

/** Create a mulberry32 generator from a 32-bit state (a fresh seed or a saved state). */
export function createPrng(state: number): Prng {
  let s = state >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState(): number {
      return s;
    },
  };
}

/** Derive a 32-bit world seed from an arbitrary integer (e.g. a timestamp). */
export function toSeed(n: number): number {
  return (n ^ 0x9e3779b9) >>> 0;
}
