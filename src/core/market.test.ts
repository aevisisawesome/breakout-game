/**
 * M6 market tests (TDD §6, §10 "statistical sanity tests; the regime shift
 * actually breaks the reference naive script").
 *
 * The headline test is the last one: the GDD §7 algorithm, deployed as the
 * SPREAD TRADER template, must make money under STABLE_CYCLES and lose money
 * after the scripted shift — and the trend-filtered variant must recover it.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { MARKET_GOODS, MARKET_REGIMES } from '../content/market.ts';
import { STRINGS } from '../content/strings.ts';
import { TEMPLATES } from '../content/templates.ts';
import { computeDerived } from './derived.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import {
  advanceMarketOffline,
  averagePrice,
  goodDef,
  newMarketState,
  priceOf,
  quoteBuy,
  quoteSell,
  regimeDef,
  seasonalFactor,
  settlementPrice,
  stepMarket,
} from './market.ts';
import { createPrng } from './prng.ts';
import { renderTemplate, templateDefaults, type TemplateLimits } from './templates.ts';
import type { GameEngine, RunState } from './types.ts';

/**
 * Engine one tick short of the market unlock, with daemons keeping compute and
 * energy flowing so a trading process can actually pay its fuel bill.
 */
function marketEngine(setup?: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.unlocks.instrumentation = true;
  run.unlocks.loops = true;
  run.jobs.lifetimeProcessed = BALANCE.ccl.marketUnlockAtJobs;
  run.upgrades = { 'worker-daemon': 4, 'power-feed': 3, 'request-router': 2 };
  run.resources.compute.current = 300;
  run.resources.capital.current = 5000;
  run.jobs.waiting = 40;
  setup?.(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

function advanceSec(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SEC; i++) engine.tick(100);
}

/**
 * Run until the exchange is mounted. The unlock check fires when a job lands,
 * which takes a few ticks of daemon accumulator — not a single tick.
 */
function openMarket(engine: GameEngine): GameEngine {
  advanceSec(engine, 2);
  expect(engine.getSnapshot().market.unlocked).toBe(true);
  return engine;
}

/** Trading cash flow so far: what the exchange has paid out minus what it took. */
function tradingNet(engine: GameEngine): number {
  const market = engine.getSnapshot().market;
  return market.earned - market.spent;
}

function terminalText(engine: GameEngine): string {
  return engine
    .getSnapshot()
    .terminal.map((l) => l.text)
    .join('\n');
}

// ---------------------------------------------------------------------------

describe('price model', () => {
  it('stays strictly positive across a full cycle of every regime and good', () => {
    for (const regime of MARKET_REGIMES) {
      for (const good of MARKET_GOODS) {
        for (let t = 0; t < 1200; t += 0.5) {
          const price = priceOf(regime, good, t, -regime.noiseMax);
          expect(price, `${regime.id}/${good.id}@${t}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('mean price over a whole cycle stays near the base price in both regimes', () => {
    for (const regime of MARKET_REGIMES) {
      const good = goodDef('compute');
      let total = 0;
      let samples = 0;
      // One full turn of the slowest cycle in either regime.
      for (let t = 0; t < 2520; t += 0.5) {
        total += priceOf(regime, good, t, 0);
        samples += 1;
      }
      const mean = total / samples;
      expect(mean / good.base, regime.id).toBeGreaterThan(0.9);
      expect(mean / good.base, regime.id).toBeLessThan(1.1);
    }
  });

  it('the shift genuinely changes the periodicity a 30-sample average assumes', () => {
    const stable = regimeDef('stable');
    const volatile = regimeDef('volatile');
    const slowest = (r: typeof stable): number =>
      Math.max(...r.cycles.map((cycle) => cycle.periodSec));
    // The learnable cycle must get much longer, not merely taller: that is what
    // turns a lagging average into a tracking one and breaks the naive script.
    expect(slowest(volatile)).toBeGreaterThan(slowest(stable) * 3);
    const good = goodDef('compute');
    const swing = (r: typeof stable): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let t = 0; t < 2520; t += 1) {
        const f = seasonalFactor(r, good, t);
        min = Math.min(min, f);
        max = Math.max(max, f);
      }
      return max - min;
    };
    expect(swing(volatile)).toBeGreaterThan(swing(stable));
  });

  it('is reproducible from the seed and is the only consumer of its PRNG draws', () => {
    const series = (seed: number): number[] => {
      const market = newMarketState(0, TICKS_PER_SEC);
      const rng = createPrng(seed);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepMarket(market, TICKS_PER_SEC, rng);
        out.push(market.price.compute);
      }
      return out;
    };
    expect(series(7)).toEqual(series(7));
    expect(series(7)).not.toEqual(series(8));
  });

  it('pre-fills a full history so averages are usable the moment it opens', () => {
    const market = newMarketState(0, TICKS_PER_SEC);
    expect(market.history.compute.length).toBe(BALANCE.market.historySamples);
    expect(market.history.energy.length).toBe(BALANCE.market.historySamples);
    expect(averagePrice(market, 'compute', 30)).toBeGreaterThan(0);
  });

  it('averages exactly the last n samples, clamped to what exists', () => {
    const market = newMarketState(0, TICKS_PER_SEC);
    market.history.compute = [1, 2, 3, 4];
    expect(averagePrice(market, 'compute', 2)).toBeCloseTo(3.5, 10);
    expect(averagePrice(market, 'compute', 4)).toBeCloseTo(2.5, 10);
    expect(averagePrice(market, 'compute', 999)).toBeCloseTo(2.5, 10);
  });

  it('keeps the history bounded as the ring buffer fills', () => {
    const market = newMarketState(0, TICKS_PER_SEC);
    const rng = createPrng(1);
    for (let i = 0; i < BALANCE.market.historySamples * 3; i++) {
      stepMarket(market, TICKS_PER_SEC, rng);
    }
    expect(market.history.compute.length).toBe(BALANCE.market.historySamples);
  });

  it('advances the seasonal clock offline without drawing from the PRNG', () => {
    const market = newMarketState(0, TICKS_PER_SEC);
    const before = market.price.compute;
    advanceMarketOffline(market, 45 * TICKS_PER_SEC, TICKS_PER_SEC);
    expect(market.clockTicks).toBe(45 * TICKS_PER_SEC);
    expect(market.price.compute).not.toBeCloseTo(before, 6);
    expect(market.history.compute.length).toBe(BALANCE.market.historySamples);
  });
});

describe('trade friction (TDD §6)', () => {
  it('charges a fee and moves the price against the order', () => {
    const buy = quoteBuy(1, 100);
    const sell = quoteSell(1, 100);
    expect(buy.unitPrice).toBeGreaterThan(1);
    expect(sell.unitPrice).toBeLessThan(1);
    expect(buy.total).toBeGreaterThan(100);
    expect(sell.total).toBeLessThan(100);
    // Round-tripping an order at an unchanged price must lose money.
    expect(sell.total).toBeLessThan(buy.total);
  });

  it('caps slippage so a huge order cannot invert the price', () => {
    const sell = quoteSell(1, BALANCE.market.maxOrderUnits * 10);
    expect(sell.unitPrice).toBeGreaterThan(0);
  });

  it('settles at the list price before the exchange is mounted', () => {
    expect(settlementPrice(null, 'compute')).toBe(goodDef('compute').base);
  });
});

describe('market unlock and the scripted regime shift', () => {
  it('mounts the exchange at the unlock threshold with a full price history', () => {
    const engine = marketEngine((run) => {
      run.jobs.lifetimeProcessed = BALANCE.ccl.marketUnlockAtJobs - 1;
      run.upgrades = {};
    });
    expect(engine.getSnapshot().market.unlocked).toBe(false);
    engine.dispatch({ type: 'EXECUTE_CLICK' }); // pushes lifetime jobs over the line
    engine.tick(100);
    const market = engine.getSnapshot().market;
    expect(market.unlocked).toBe(true);
    expect(market.goods.map((g) => g.id)).toEqual(['compute', 'energy']);
    expect(market.goods[0]!.history.length).toBe(BALANCE.market.historySamples);
    expect(terminalText(engine)).toContain(STRINGS.marketGranted);
  });

  it('fires the shift on schedule, with an advisory and an audit entry, but never names the regime', () => {
    const engine = marketEngine();
    advanceSec(engine, BALANCE.market.regimeShiftAtSec - 5);
    expect(terminalText(engine)).not.toContain(STRINGS.marketRegimeShift);
    advanceSec(engine, 10);
    expect(terminalText(engine)).toContain(STRINGS.marketRegimeShift);
    const research = engine.getSnapshot().research;
    expect(research.some((r) => r.entryId === 'market-regime')).toBe(true);
    // The "your algorithm is losing" beat must not fire just because the shift
    // did — nothing has traded, so there is no drawdown to report.
    expect(research.some((r) => r.entryId === 'market-loss')).toBe(false);
    // Regimes are hidden state: nothing in the snapshot may name one.
    const snapshot = JSON.stringify(engine.getSnapshot());
    for (const regime of MARKET_REGIMES) {
      expect(snapshot).not.toContain(regime.label);
      expect(snapshot).not.toContain(`"${regime.id}"`);
    }
  });
});

describe('manual orders', () => {
  it('fills a buy and a sell, moving capital and the pool in opposite directions', () => {
    const engine = openMarket(marketEngine());
    const before = engine.getSnapshot();
    const price = before.market.goods[0]!.price;
    expect(engine.dispatch({ type: 'TRADE', good: 'compute', side: 'buy', units: 50 }).ok).toBe(
      true,
    );
    const bought = engine.getSnapshot();
    expect(bought.resources.compute.current).toBeCloseTo(
      Math.min(before.resources.compute.capacity, before.resources.compute.current + 50),
      6,
    );
    expect(bought.resources.capital.current).toBeCloseTo(
      before.resources.capital.current - quoteBuy(price, 50).total,
      6,
    );
    expect(engine.dispatch({ type: 'TRADE', good: 'compute', side: 'sell', units: 50 }).ok).toBe(
      true,
    );
    expect(engine.getSnapshot().market.trades).toBe(2);
    // Fee + slippage make the round trip a loss at an unchanged price.
    expect(tradingNet(engine)).toBeLessThan(0);
  });

  it('refuses orders it cannot fund, cannot fill, or cannot size', () => {
    const engine = marketEngine((run) => {
      run.resources.capital.current = 0;
      run.resources.energy.current = 0;
    });
    openMarket(engine);
    expect(engine.dispatch({ type: 'TRADE', good: 'compute', side: 'buy', units: 100 }).ok).toBe(
      false,
    );
    expect(engine.dispatch({ type: 'TRADE', good: 'energy', side: 'sell', units: 10 }).ok).toBe(
      false,
    );
    expect(engine.dispatch({ type: 'TRADE', good: 'compute', side: 'buy', units: 0 }).ok).toBe(
      false,
    );
    const out = terminalText(engine);
    expect(out).toContain(STRINGS.tradeNoCapital);
    expect(out).toContain(STRINGS.tradeNoStock);
    expect(out).toContain(STRINGS.tradeBadSize);
  });

  it('is refused entirely before the exchange is mounted', () => {
    const engine = marketEngine((run) => {
      run.jobs.lifetimeProcessed = 0;
    });
    expect(engine.dispatch({ type: 'TRADE', good: 'compute', side: 'buy', units: 10 }).ok).toBe(
      false,
    );
    expect(terminalText(engine)).toContain(STRINGS.tradeNoAccess);
  });
});

describe('market bindings in CCL', () => {
  /** Dispatch RUN_SCRIPT and advance one tick so the queued activation executes. */
  const run = (engine: GameEngine, source: string): void => {
    engine.dispatch({ type: 'RUN_SCRIPT', source });
    engine.tick(100);
  };

  it('reads prices and averages through namespaced calls', () => {
    const engine = openMarket(marketEngine());
    run(engine, 'print(market.price("compute"))\nprint(market.average("compute", 30))');
    expect(engine.getSnapshot().ccl.lastRun?.status).toBe('ok');
    const printed = terminalText(engine)
      .split('\n')
      .filter((l) => l.startsWith(':: '));
    expect(printed.length).toBeGreaterThanOrEqual(2);
    for (const line of printed.slice(-2)) {
      expect(Number(line.slice(3))).toBeGreaterThan(0);
    }
  });

  it('explains a locked binding instead of calling it a typo', () => {
    const engine = marketEngine((run) => {
      run.jobs.lifetimeProcessed = 0;
    });
    run(engine, 'print(market.price("compute"))');
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('error');
    expect(report.error?.message).toContain('market.price');
    expect(report.error?.message).toContain('not available');
  });

  it('rejects an unknown good and a bad sample count as misuse, not silent failure', () => {
    const engine = openMarket(marketEngine());
    run(engine, 'print(market.price("cooling"))');
    expect(engine.getSnapshot().ccl.lastRun?.error?.message).toContain('not traded here');
    run(engine, 'print(market.average("compute", 0))');
    expect(engine.getSnapshot().ccl.lastRun?.error?.message).toContain('at least 1');
  });

  it('sells compute for capital and buys energy into the reserve', () => {
    const engine = marketEngine((state) => {
      state.resources.energy.current = 0;
    });
    openMarket(engine);
    const before = engine.getSnapshot();
    run(engine, 'sell_compute(50)\nbuy_energy(40)');
    const after = engine.getSnapshot();
    expect(after.resources.capital.current).toBeGreaterThan(before.resources.capital.current);
    expect(after.resources.energy.current).toBeGreaterThan(35);
    expect(after.market.trades).toBe(2);
  });
});

describe('energy is genuinely required (TDD §4.3)', () => {
  it('script execution draws energy in proportion to the ops it burns', () => {
    // Two identical sandboxes, one of which runs a script: regen and drain are
    // otherwise the same, so the gap between them is what execution cost.
    const setup = (run: RunState): void => {
      run.upgrades = {}; // no daemons, so only the script touches energy
      run.resources.energy.current = 50;
    };
    const idle = marketEngine(setup);
    const busy = marketEngine(setup);
    idle.tick(100);
    busy.dispatch({ type: 'RUN_SCRIPT', source: 'for i in range(10) {\n  print(i)\n}' });
    busy.tick(100);

    const opsUsed = busy.getSnapshot().ccl.lastRun!.opsUsed;
    expect(opsUsed).toBeGreaterThan(20);
    const drawn =
      idle.getSnapshot().resources.energy.current - busy.getSnapshot().resources.energy.current;
    expect(drawn).toBeCloseTo(opsUsed * BALANCE.ccl.energyPerOp, 6);
  });

  it('a fully built-out daemon bank outruns the sandbox feed, so energy must be bought', () => {
    // Every power feed installed, and the throughput upgrades the player will
    // have bought by this tier. The feed alone must no longer cover the draw.
    const engine = marketEngine((run) => {
      run.upgrades = {
        'worker-daemon': 6,
        'daemon-scheduler': 2,
        'power-feed': 3,
        'request-router': 3,
        'ram-bank': 3,
      };
      run.resources.energy.current = 100;
      run.jobs.waiting = 60;
    });
    const upgrades = {
      'worker-daemon': 6,
      'daemon-scheduler': 2,
      'power-feed': 3,
      'request-router': 3,
      'ram-bank': 3,
    };
    // The structural claim: at full build-out the draw exceeds every feed the
    // sandbox can install, so the deficit cannot be upgraded away.
    const derived = computeDerived(upgrades, BALANCE.ccl.marketUnlockAtJobs);
    expect(derived.energyDrainPerSec).toBeGreaterThan(derived.energyRegenPerSec);

    openMarket(engine);
    advanceSec(engine, 120);
    const starved = engine.getSnapshot();
    // The pool is pinned at empty and the daemons are riding the throttle: the
    // positive instantaneous rate is the throttled equilibrium, not a surplus.
    expect(starved.resources.energy.current).toBeLessThan(1);
    expect(starved.workers.jobsPerSec).toBeGreaterThan(derived.energyRegenPerSec);

    // Buying energy is the fix the exchange provides.
    expect(engine.dispatch({ type: 'TRADE', good: 'energy', side: 'buy', units: 90 }).ok).toBe(
      true,
    );
    expect(engine.getSnapshot().resources.energy.current).toBeGreaterThan(80);
  });

  it('bought energy raises the reserve, and the buffer cell raises what it can hold', () => {
    const plain = marketEngine((run) => {
      run.upgrades = {};
    });
    plain.tick(100);
    const baseCapacity = plain.getSnapshot().resources.energy.capacity;
    const upgraded = marketEngine((run) => {
      run.upgrades = { 'energy-cell': 2 };
    });
    upgraded.tick(100);
    expect(upgraded.getSnapshot().resources.energy.capacity).toBeGreaterThan(baseCapacity);
  });
});

describe('OP-3: the request buffer can be raised', () => {
  it('lets the queue fill past the base depth once the expansion is installed', () => {
    const base = BALANCE.jobs.queueCapacity;
    const engine = marketEngine((run) => {
      run.upgrades = { 'request-router': 3, 'queue-buffer': 2 };
      run.jobs.waiting = base;
    });
    advanceSec(engine, 90);
    const jobs = engine.getSnapshot().jobs;
    expect(jobs.queueCapacity).toBeGreaterThan(base);
    expect(jobs.waiting).toBeGreaterThan(base);
    expect(jobs.waiting).toBeLessThanOrEqual(jobs.queueCapacity);
  });
});

// ---------------------------------------------------------------------------
// The acceptance criterion (GDD §7, Implementation Plan M6).

describe('the reference algorithm works, then stops working', () => {
  const limits: TemplateLimits = { iterationLimit: BALANCE.ccl.iterationLimitBase };
  const spreadTrader = (): string => {
    const def = TEMPLATES.find((t) => t.id === 'market-trader')!;
    return renderTemplate(def, templateDefaults(def), limits);
  };
  const trendTrader = (): string => {
    const def = TEMPLATES.find((t) => t.id === 'market-trend')!;
    return renderTemplate(def, templateDefaults(def), limits);
  };

  /** Deploy `source`, let the market settle, then measure trading cash flow. */
  function measure(source: string, warmupSec: number, windowSec: number, seed: number): number {
    const engine = openMarket(marketEngine(undefined, seed));
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
    advanceSec(engine, warmupSec);
    const before = tradingNet(engine);
    advanceSec(engine, windowSec);
    return tradingNet(engine) - before;
  }

  const shiftSec = BALANCE.market.regimeShiftAtSec;

  it('the GDD §7 spread trader profits under the opening regime', () => {
    for (const seed of [42, 1337, 90210]) {
      // Entirely inside the stable regime: deploy, then trade until the shift.
      expect(measure(spreadTrader(), 10, shiftSec - 20, seed), `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('the same trader loses money once the market repriced', () => {
    for (const seed of [42, 1337, 90210]) {
      // Skip past the shift, then measure a window wholly inside the new regime.
      expect(measure(spreadTrader(), shiftSec + 20, 900, seed), `seed ${seed}`).toBeLessThan(0);
    }
  });

  it('reports the loss diegetically once the drawdown is real, not when the shift fires', () => {
    const engine = openMarket(marketEngine());
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: spreadTrader() });
    advanceSec(engine, shiftSec + 10);
    expect(engine.getSnapshot().research.some((r) => r.entryId === 'market-loss')).toBe(false);
    const atShift = tradingNet(engine);
    advanceSec(engine, 600);
    expect(engine.getSnapshot().research.some((r) => r.entryId === 'market-loss')).toBe(true);
    expect(atShift - tradingNet(engine)).toBeGreaterThanOrEqual(BALANCE.market.lossBeatDrawdownCr);
  });

  it('a trend filter — tier 3 and two averages — recovers it', () => {
    for (const seed of [42, 1337, 90210]) {
      const naive = measure(spreadTrader(), shiftSec + 20, 900, seed);
      const adapted = measure(trendTrader(), shiftSec + 20, 900, seed);
      expect(adapted, `seed ${seed}`).toBeGreaterThan(naive);
      expect(adapted, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});
