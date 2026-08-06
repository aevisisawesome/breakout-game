import { describe, expect, it } from 'vitest';

import { createPrng, toSeed } from './prng.ts';

describe('createPrng (mulberry32)', () => {
  it('produces the golden sequence for seed 42', () => {
    const prng = createPrng(42);
    expect([prng.next(), prng.next(), prng.next(), prng.next(), prng.next()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423,
    ]);
    expect(prng.getState()).toBe(567894515);
  });

  it('is deterministic: same seed, same sequence', () => {
    const a = createPrng(123456789);
    const b = createPrng(123456789);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('resumes exactly from a saved state', () => {
    const original = createPrng(7);
    original.next();
    original.next();
    const resumed = createPrng(original.getState());
    expect(resumed.next()).toBe(original.next());
  });

  it('stays in [0, 1)', () => {
    const prng = createPrng(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    const a = createPrng(1);
    const b = createPrng(2);
    const aVals = Array.from({ length: 10 }, () => a.next());
    const bVals = Array.from({ length: 10 }, () => b.next());
    expect(aVals).not.toEqual(bVals);
  });

  it('toSeed maps to unsigned 32-bit', () => {
    expect(toSeed(0)).toBeGreaterThanOrEqual(0);
    expect(toSeed(-1)).toBeGreaterThanOrEqual(0);
    expect(toSeed(Date.UTC(2026, 0, 1))).toBeLessThanOrEqual(0xffffffff);
  });
});
