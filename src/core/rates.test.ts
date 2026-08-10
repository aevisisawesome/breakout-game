/**
 * M7.5 WP3 and WP7 tests: the signed rate readouts (OP-21, OP-35) and the
 * trailing window behind them.
 *
 * The claim being pinned is narrow and worth stating: a rate shown beside a
 * meter must agree with the meter. WP3 got two thirds of the way there — script
 * fuel was subtracted from a compute rate that had ignored it, and
 * `temperature.ratePerSec` stopped being measured from *after* the step's heat
 * had landed, which was the only reason it could report cooling and nothing
 * else. WP7 finishes it: compute and energy quote the pool's own d/dt, so the
 * flows no model was watching — market fills, manual batches, an income term
 * that collapses when the queue empties — are in the number by construction.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import { RateWindow } from './rates.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine loaded from a crafted run state (current save shape). */
function engineWith(setup: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  setup(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

const WINDOW_SEC = BALANCE.readouts.rateWindowSec;
const WINDOW_MS = WINDOW_SEC * 1000;

/**
 * Once the ring is full it holds exactly the last `WINDOW_SEC` of steps, so the
 * quoted rate is `(current − current one window ago) / WINDOW_SEC` — which is
 * the whole of WP7's claim, expressed as arithmetic.
 */
function ticksToFillWindow(engine: GameEngine): void {
  engine.tick(WINDOW_MS + 1000);
}

/** A funded, fully granted sandbox with daemons running. */
function builtOut(run: RunState): void {
  run.jobs.lifetimeProcessed = BALANCE.ccl.thermalUnlockAtJobs;
  run.jobs.waiting = BALANCE.jobs.queueCapacity;
  run.upgrades['worker-daemon'] = 4;
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.unlocks.instrumentation = true;
  run.unlocks.loops = true;
  run.unlocks.thermal = true;
  run.resources.compute.current = 300;
  run.resources.capital.current = 5000;
  run.resources.energy.current = 100;
}

describe('RateWindow', () => {
  it('reports the mean per second across the window', () => {
    const window = new RateWindow(4);
    window.push(1, 0.1);
    window.push(3, 0.1);
    expect(window.perSec()).toBeCloseTo(20, 10); // 4 units over 0.2 s
  });

  it('is zero before it holds any time', () => {
    expect(new RateWindow(4).perSec()).toBe(0);
  });

  it('drops the oldest sample once full, so a spike ages out', () => {
    const window = new RateWindow(3);
    window.push(9, 0.1); // the spike
    for (let i = 0; i < 2; i++) window.push(0, 0.1);
    expect(window.perSec()).toBeCloseTo(30, 10); // 9 over 0.3 s, spike still inside
    for (let i = 0; i < 3; i++) window.push(0, 0.1);
    expect(window.perSec()).toBe(0); // aged out entirely
  });

  it('forgets everything on reset', () => {
    const window = new RateWindow(3);
    window.push(5, 0.1);
    window.reset();
    expect(window.perSec()).toBe(0);
    window.push(1, 0.1);
    expect(window.perSec()).toBeCloseTo(10, 10);
  });
});

describe('resource rates (OP-21)', () => {
  it('quotes the compute pool itself, script fuel and all', () => {
    const engine = engineWith(builtOut);
    ticksToFillWindow(engine);
    const before = engine.getSnapshot().resources.compute.current;

    // A process that burns fuel every activation and produces no compute.
    expect(
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  x = 1 + 2 + 3 + 4 + 5\n}\n',
      }).ok,
    ).toBe(true);
    engine.tick(WINDOW_MS);

    const snap = engine.getSnapshot();
    const drawn = snap.scheduler.deployments
      .flatMap((d) => d.processes)
      .reduce((total, p) => total + p.computeTotal, 0);
    expect(drawn).toBeGreaterThan(0);
    // Exactly, not loosely: WP3 could only claim the readout tracked the pool to
    // within a fraction of a job, because its daemon half was a modelled steady
    // rate and daemons land work in lumps. WP7's number *is* the pool.
    expect(snap.resources.compute.ratePerSec).toBeCloseTo(
      (snap.resources.compute.current - before) / WINDOW_SEC,
      8,
    );
  });

  it('quotes the energy reserve itself, script draw and all', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.jobs.waiting = 0; // no daemon work, so only the script moves the reserve
      run.upgrades['worker-daemon'] = 0;
      run.resources.energy.current = 50; // off the ceiling, so the recharge shows
    });
    ticksToFillWindow(engine);
    const idle = engine.getSnapshot().resources.energy.ratePerSec;
    expect(idle).toBeCloseTo(BALANCE.resources.energyRegenPerSec, 6);

    expect(
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  x = 1 + 2 + 3 + 4 + 5\n}\n',
      }).ok,
    ).toBe(true);
    const before = engine.getSnapshot().resources.energy.current;
    engine.tick(WINDOW_MS);
    const snap = engine.getSnapshot();
    expect(snap.resources.energy.ratePerSec).toBeLessThan(idle);
    expect(snap.resources.energy.ratePerSec).toBeCloseTo(
      (snap.resources.energy.current - before) / WINDOW_SEC,
      8,
    );
  });

  it('reports a rising core as rising', () => {
    // Pre-WP3 this was impossible: the rate was measured after the step's heat
    // had already landed, so it could only ever describe dissipation.
    const engine = engineWith(builtOut);
    engine.tick(1000);
    const snap = engine.getSnapshot();
    expect(snap.resources.temperature.current).toBeGreaterThan(BALANCE.thermal.ambientC);
    expect(snap.resources.temperature.ratePerSec).toBeGreaterThan(0);
  });

  it('reports a cooling core as falling', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.jobs.waiting = 0;
      run.upgrades['worker-daemon'] = 0;
      run.resources.temperature.current = BALANCE.thermal.softThresholdC;
    });
    engine.tick(1000);
    expect(engine.getSnapshot().resources.temperature.ratePerSec).toBeLessThan(0);
  });

  it('smooths the core rate over the window instead of quoting one tick', () => {
    // Daemons land jobs in lumps: heat arrives on the ticks that process work
    // and nowhere else. Averaged over the window, the reading stays inside a
    // band a player can read; the raw per-tick derivative does not.
    const engine = engineWith(builtOut);
    engine.tick(3000);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      engine.tick(100);
      samples.push(engine.getSnapshot().resources.temperature.ratePerSec);
    }
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread).toBeLessThan(0.2);
  });

  it('averages over exactly the configured window', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.jobs.waiting = 0;
      run.upgrades['worker-daemon'] = 0;
    });
    // One manual RUN's fuel, then silence: the draw must have aged out of the
    // compute rate one window later, and not before.
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'x = 1 + 2 + 3 + 4 + 5\n' });
    engine.tick(100);
    expect(engine.getSnapshot().resources.compute.ratePerSec).toBeLessThan(0);
    engine.tick(BALANCE.readouts.rateWindowSec * 1000 - 200);
    expect(engine.getSnapshot().resources.compute.ratePerSec).toBeLessThan(0);
    engine.tick(200);
    expect(engine.getSnapshot().resources.compute.ratePerSec).toBe(0);
  });

  it('does not carry a measured rate across a load', () => {
    const engine = engineWith(builtOut);
    engine.tick(2000);
    expect(engine.getSnapshot().resources.temperature.ratePerSec).toBeGreaterThan(0);

    const save = engine.save(0);
    const fresh = createGameEngine(1);
    fresh.load(save);
    fresh.tick(100);
    // One step of history, not the twenty the saving session had accumulated.
    const rate = fresh.getSnapshot().resources.temperature.ratePerSec;
    const oneStep =
      (fresh.getSnapshot().resources.temperature.current - save.run.resources.temperature.current) *
      TICKS_PER_SEC;
    expect(rate).toBeCloseTo(oneStep, 6);
  });
});

/**
 * WP7: the pool rate is the pool's derivative, so it cannot contradict the bar
 * above it. Each test here is one of the three flows OP-35 names as invisible to
 * the modelled version, plus the two cases where "agrees with the meter" means
 * reading flat rather than reading a number.
 */
describe('pool rates are the pool (OP-35)', () => {
  it('reports a rising pool as rising while a process buys into it', () => {
    // The reported failure, reproduced. The queue is empty and there are no
    // daemons, so the modelled income term is zero and the old rate was script
    // fuel and nothing else — strictly negative — while the pool climbed 20/s.
    const engine = engineWith((run) => {
      builtOut(run);
      run.jobs.waiting = 0;
      run.upgrades['worker-daemon'] = 0;
      run.resources.compute.current = 50;
    });
    expect(
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  buy_compute(20)\n}\n',
      }).ok,
    ).toBe(true);
    ticksToFillWindow(engine);

    const before = engine.getSnapshot().resources.compute.current;
    engine.tick(WINDOW_MS);
    const snap = engine.getSnapshot();
    const measured = snap.resources.compute.current - before;
    expect(measured).toBeGreaterThan(0); // the bar rose...
    expect(snap.resources.compute.ratePerSec).toBeGreaterThan(0); // ...and so did the number
    expect(snap.resources.compute.ratePerSec).toBeCloseTo(measured / WINDOW_SEC, 8);
  });

  it('counts a manual batch dispatched between two ticks', () => {
    // The anchor is the pool as it stood at the last reading, not at the top of
    // this step, so a click landing between ticks is inside the interval rather
    // than between two of them.
    const engine = engineWith((run) => {
      builtOut(run);
      run.upgrades['worker-daemon'] = 0; // only the trigger moves the pool
      run.resources.compute.current = 50;
    });
    ticksToFillWindow(engine);
    expect(engine.getSnapshot().resources.compute.ratePerSec).toBe(0);

    const before = engine.getSnapshot().resources.compute.current;
    expect(engine.dispatch({ type: 'EXECUTE_CLICK' }).ok).toBe(true);
    engine.tick(100);
    const snap = engine.getSnapshot();
    const gained = snap.resources.compute.current - before;
    expect(gained).toBeGreaterThan(0);
    expect(snap.resources.compute.ratePerSec).toBeCloseTo(gained / WINDOW_SEC, 8);
  });

  it('reads flat at capacity, because the meter is flat', () => {
    // Production continues; the pool does not. Quoting the production would be
    // the OP-35 failure with the sign reversed — a positive rate on a still bar.
    const engine = engineWith((run) => {
      builtOut(run);
      run.resources.compute.current = BALANCE.resources.computeCapacity;
    });
    ticksToFillWindow(engine);
    const snap = engine.getSnapshot();
    expect(snap.jobs.lifetimeProcessed).toBeGreaterThan(BALANCE.ccl.thermalUnlockAtJobs);
    expect(snap.resources.compute.current).toBe(snap.resources.compute.capacity);
    expect(snap.resources.compute.ratePerSec).toBe(0);
  });

  it('does not report the save it just loaded as a second of flow', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.resources.compute.current = 380;
    });
    engine.tick(100);
    const save = engine.save(0);
    const atSave = save.run.resources.compute.current;

    const fresh = createGameEngine(1);
    fresh.load(save); // a fresh engine's pool is nowhere near 380
    fresh.tick(100);
    const snap = fresh.getSnapshot();
    expect(snap.resources.compute.ratePerSec).toBeCloseTo(
      (snap.resources.compute.current - atSave) * TICKS_PER_SEC,
      6,
    );
  });

  it('does not report an offline catch-up as flow', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.resources.energy.current = 10;
    });
    engine.tick(1000);
    engine.advanceOffline(60 * 60 * 1000); // an hour's recharge lands in one jump
    engine.tick(100);
    // One step of the reserve's own movement is the ceiling; the jump itself,
    // quoted over a single step, would be hundreds per second.
    expect(Math.abs(engine.getSnapshot().resources.energy.ratePerSec)).toBeLessThanOrEqual(
      BALANCE.resources.energyRegenPerSec + 1e-9,
    );
  });
});
