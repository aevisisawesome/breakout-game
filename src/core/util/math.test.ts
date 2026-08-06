import { describe, expect, it } from 'vitest';

import { clamp } from './math.ts';

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below and above', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('accepts an infinite upper bound (uncapped resource pools)', () => {
    expect(clamp(1e12, 0, Infinity)).toBe(1e12);
  });

  it('rejects an inverted range', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});
