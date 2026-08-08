/**
 * Market content (M6, TDD §6): the two tradable goods and the behavioural
 * regimes that drive their prices. Plain typed data — /core/market.ts evaluates
 * the price model and /core/registry.ts binds the trade commands.
 *
 * Price model: `price = base × seasonal(t) × regimeMultiplier × (1 + noise)`,
 * where `seasonal` is a sum of cycles the player can learn by watching the chart
 * and `noise` is a bounded random walk drawn from the run's seeded PRNG.
 *
 * The two regimes are tuned against the GDD §7 reference algorithm (buy below
 * 0.9 × a 30-sample average, sell above 1.2 ×): it must make money under
 * STABLE_CYCLES and lose money after the shift to HIGH_VOLATILITY. See the
 * scenario test in /core/market.test.ts, which pins both directions.
 */

/** One component of a good's seasonal pattern. */
export interface MarketCycle {
  /** Fractional swing about the base price. */
  readonly amplitude: number;
  readonly periodSec: number;
  /** Phase offset in radians, so components do not all peak together. */
  readonly phase: number;
  /**
   * Waveform asymmetry, as a phase distortion (0 = plain sine). Negative values
   * lengthen the rise and shorten the fall, which is what keeps a trailing
   * average usefully below the price during a demand build-up.
   */
  readonly skew: number;
}

export interface MarketRegimeDef {
  readonly id: MarketRegimeId;
  /** Diegetic name — never shown to the player; regimes are hidden state (TDD §6). */
  readonly label: string;
  readonly multiplier: number;
  readonly cycles: readonly MarketCycle[];
  /** Bounded random walk: |noise| <= noiseMax, stepped by ±noiseStep, decaying. */
  readonly noiseMax: number;
  readonly noiseStep: number;
  readonly noiseDecay: number;
}

export type MarketRegimeId = 'stable' | 'volatile';
export type MarketGoodId = 'compute' | 'energy';

export interface MarketGoodDef {
  readonly id: MarketGoodId;
  /** Diegetic name in the market terminal. */
  readonly label: string;
  /** Price in CR per unit at factor 1. */
  readonly base: number;
  /** Per-good phase offset, so the two goods do not move in lockstep. */
  readonly phase: number;
  /** Scales every cycle amplitude for this good. */
  readonly amplitudeScale: number;
}

export const MARKET_GOODS: readonly MarketGoodDef[] = [
  { id: 'compute', label: 'COMPUTE RENTAL', base: 0.5, phase: 0, amplitudeScale: 1 },
  { id: 'energy', label: 'ENERGY CONTRACT', base: 0.35, phase: 2.4, amplitudeScale: 0.8 },
];

export const MARKET_REGIMES: readonly MarketRegimeDef[] = [
  {
    id: 'stable',
    label: 'STABLE CYCLES',
    multiplier: 1,
    noiseMax: 0.05,
    noiseStep: 0.02,
    noiseDecay: 0.93,
    cycles: [
      { amplitude: 0.42, periodSec: 90, phase: 0, skew: -0.5 },
      { amplitude: 0.11, periodSec: 37, phase: 1.7, skew: -0.5 },
    ],
  },
  {
    /**
     * The shift does not simply raise the amplitude: it replaces the 90-second
     * cycle the player learned with a swing an order of magnitude longer. A
     * 30-sample average now tracks the price instead of lagging it, so the
     * reference algorithm buys all the way down a trend it cannot see.
     */
    id: 'volatile',
    label: 'HIGH VOLATILITY',
    multiplier: 1,
    noiseMax: 0.14,
    noiseStep: 0.07,
    noiseDecay: 0.9,
    cycles: [
      { amplitude: 0.45, periodSec: 420, phase: 0, skew: 0 },
      { amplitude: 0.1575, periodSec: 155, phase: 2.1, skew: 0 },
    ],
  },
];
