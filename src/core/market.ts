/**
 * Market simulation (M6, TDD §6). Pure functions over the content-defined price
 * model plus the small amount of market state the run carries: the active
 * regime, a bounded noise walk per good, and a price-history ring buffer.
 *
 * The engine owns the state and calls `stepMarket` once per tick; everything
 * here is deterministic given (tick, regime, noise) and draws randomness only
 * from the PRNG the caller supplies.
 */

import { BALANCE } from '../content/balance.ts';
import {
  MARKET_GOODS,
  MARKET_REGIMES,
  type MarketGoodDef,
  type MarketGoodId,
  type MarketRegimeDef,
  type MarketRegimeId,
} from '../content/market.ts';
import type { Prng } from './prng.ts';
import type { MarketState } from './types.ts';

export const MARKET_GOOD_IDS: readonly MarketGoodId[] = MARKET_GOODS.map((good) => good.id);

export function goodDef(id: MarketGoodId): MarketGoodDef {
  // MARKET_GOOD_IDS is derived from MARKET_GOODS, so every id resolves.
  return MARKET_GOODS.find((good) => good.id === id)!;
}

export function regimeDef(id: MarketRegimeId): MarketRegimeDef {
  // RunState only ever holds ids from this table (migrations included).
  return MARKET_REGIMES.find((regime) => regime.id === id)!;
}

/**
 * Phase-distorted sine. `skew` of 0 is an ordinary sine; negative values
 * lengthen the rise and shorten the fall. Stays periodic and continuous for
 * any |skew| < 1, which is what keeps the pattern learnable.
 */
function wave(x: number, skew: number): number {
  return Math.sin(x + skew * Math.sin(x));
}

/** Sum of the regime's cycles for one good at time `tSec`, before noise. */
export function seasonalFactor(regime: MarketRegimeDef, good: MarketGoodDef, tSec: number): number {
  let value = 1;
  for (const cycle of regime.cycles) {
    const x = (2 * Math.PI * tSec) / cycle.periodSec + cycle.phase + good.phase;
    value += cycle.amplitude * good.amplitudeScale * wave(x, cycle.skew);
  }
  return value;
}

/** Price of one unit, in CR (TDD §6: base × seasonal × regime × noise, floored). */
export function priceOf(
  regime: MarketRegimeDef,
  good: MarketGoodDef,
  tSec: number,
  noise: number,
): number {
  const factor = seasonalFactor(regime, good, tSec) * regime.multiplier * (1 + noise);
  return good.base * Math.max(BALANCE.market.minPriceFactor, factor);
}

// ---------------------------------------------------------------------------
// State

/**
 * The market carries its own clock rather than reading `run.tick`, because
 * offline catch-up advances resources without advancing the sim clock (TDD §4.5)
 * and a frozen price series there would let a trading process fill hundreds of
 * orders at one stale price.
 */

/**
 * Market state at the moment the terminal is mounted. History is pre-filled
 * from the noiseless price curve so `market.average` and the chart are usable
 * immediately rather than after five minutes of watching an empty panel.
 */
export function newMarketState(tick: number, ticksPerSec: number): MarketState {
  const market: MarketState = {
    regime: 'stable',
    clockTicks: tick,
    openedAtTick: tick,
    regimeSinceTick: tick,
    netAtRegimeStart: 0,
    noise: { compute: 0, energy: 0 },
    price: { compute: 0, energy: 0 },
    history: { compute: [], energy: [] },
    spent: 0,
    earned: 0,
    trades: 0,
  };
  const m = BALANCE.market;
  const regime = regimeDef('stable');
  for (const id of MARKET_GOOD_IDS) {
    const good = goodDef(id);
    const samples: number[] = [];
    for (let i = m.historySamples - 1; i >= 0; i--) {
      samples.push(priceOf(regime, good, (tick - i * m.sampleTicks) / ticksPerSec, 0));
    }
    market.history[id] = samples;
    market.price[id] = priceOf(regime, good, tick / ticksPerSec, 0);
  }
  return market;
}

/** Recompute prices at the current clock and, on a sample tick, record them. */
function repriceAndRecord(market: MarketState, ticksPerSec: number, record: boolean): void {
  const m = BALANCE.market;
  const regime = regimeDef(market.regime);
  const tSec = market.clockTicks / ticksPerSec;
  for (const id of MARKET_GOOD_IDS) {
    const price = priceOf(regime, goodDef(id), tSec, market.noise[id] ?? 0);
    market.price[id] = price;
    if (!record) continue;
    const series = market.history[id];
    series.push(price);
    if (series.length > m.historySamples) series.splice(0, series.length - m.historySamples);
  }
}

/**
 * Advance the market by one tick: step the noise walk (on sample ticks only),
 * recompute prices, and append to the history ring buffer. The PRNG is the
 * run's, so the whole series is reproducible from the world seed.
 */
export function stepMarket(market: MarketState, ticksPerSec: number, rng: Prng): void {
  const m = BALANCE.market;
  const regime = regimeDef(market.regime);
  market.clockTicks += 1;
  const sampling = market.clockTicks % m.sampleTicks === 0;
  if (sampling) {
    for (const id of MARKET_GOOD_IDS) {
      const drift =
        (market.noise[id] ?? 0) * regime.noiseDecay + (rng.next() * 2 - 1) * regime.noiseStep;
      market.noise[id] = Math.min(regime.noiseMax, Math.max(-regime.noiseMax, drift));
    }
  }
  repriceAndRecord(market, ticksPerSec, sampling);
}

/**
 * Advance the market across an offline catch-up chunk (TDD §4.5). The seasonal
 * clock moves so a trading process still sees prices change between chunks, but
 * the noise walk is held: offline steps are coarse summaries and take no PRNG
 * draws, per the offline decision recorded in the TDD.
 */
export function advanceMarketOffline(
  market: MarketState,
  ticks: number,
  ticksPerSec: number,
): void {
  const m = BALANCE.market;
  const target = market.clockTicks + Math.max(0, Math.round(ticks));
  // Walk in sample steps so the history ends up as a real series, not one jump.
  while (market.clockTicks + m.sampleTicks <= target) {
    market.clockTicks += m.sampleTicks;
    repriceAndRecord(market, ticksPerSec, true);
  }
  market.clockTicks = target;
  repriceAndRecord(market, ticksPerSec, false);
}

/**
 * Mean of the last `n` recorded samples. Falls back to whatever history exists
 * (never fewer than the current price), so a freshly opened market answers
 * sensibly instead of failing.
 */
export function averagePrice(market: MarketState, id: MarketGoodId, n: number): number {
  const series = market.history[id];
  const count = Math.min(Math.max(1, Math.floor(n)), series.length);
  if (count === 0) return market.price[id] ?? 0;
  let total = 0;
  for (let i = series.length - count; i < series.length; i++) total += series[i]!;
  return total / count;
}

/**
 * Price a trade settles at. Before the exchange is mounted there is no live
 * market, so `buy_compute` (available since M3) settles at the good's list
 * price — the pre-exchange rental contract — rather than failing.
 */
export function settlementPrice(market: MarketState | null, id: MarketGoodId): number {
  return market?.price[id] ?? goodDef(id).base;
}

// ---------------------------------------------------------------------------
// Trading

export interface TradeQuote {
  /** Effective price per unit after slippage. */
  unitPrice: number;
  /** Capital paid (buy) or received (sell), after the transaction fee. */
  total: number;
}

/** Slippage fraction for an order of `units`, capped so a big order cannot invert the price. */
function slippage(units: number): number {
  const m = BALANCE.market;
  return Math.min(m.maxSlippage, m.slippagePerUnit * units);
}

/** Cost of buying `units`: price moves against the order, then the flat fee is added. */
export function quoteBuy(price: number, units: number): TradeQuote {
  const unitPrice = price * (1 + slippage(units));
  return { unitPrice, total: unitPrice * units * (1 + BALANCE.market.fee) };
}

/** Proceeds from selling `units`: price moves against the order, then the fee is deducted. */
export function quoteSell(price: number, units: number): TradeQuote {
  const unitPrice = price * (1 - slippage(units));
  return { unitPrice, total: unitPrice * units * (1 - BALANCE.market.fee) };
}
