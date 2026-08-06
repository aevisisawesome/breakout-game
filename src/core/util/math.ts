/** Numeric helpers for the simulation core. Pure functions only. */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`clamp: min (${min}) must be <= max (${max})`);
  }
  return Math.min(max, Math.max(min, value));
}
