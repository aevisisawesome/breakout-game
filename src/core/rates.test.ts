/**
 * M7.5 WP3 tests: the signed rate readouts (OP-21) and the trailing window
 * behind the measured half of them.
 *
 * The claim being pinned is narrow and worth stating: a rate shown beside a
 * meter must agree with the meter. Before WP3, `compute.ratePerSec` quoted
 * daemon income only while script fuel came out of the same pool, and
 * `temperature.ratePerSec` was measured from *after* the step's heat had landed,
 * so it could report cooling and nothing else.
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
  engine.load({ version: 7, savedAt: 0, meta: newMetaState(), run });
  return engine;
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
  it('subtracts script fuel from the compute rate, so the readout agrees with the meter', () => {
    const engine = engineWith(builtOut);
    engine.tick(2000);
    const idle = engine.getSnapshot().resources.compute.ratePerSec;
    const before = engine.getSnapshot().resources.compute.current;

    // A process that burns fuel every activation and produces no compute.
    expect(
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  x = 1 + 2 + 3 + 4 + 5\n}\n',
      }).ok,
    ).toBe(true);
    engine.tick(2000);

    const snap = engine.getSnapshot();
    const drawn = snap.scheduler.deployments
      .flatMap((d) => d.processes)
      .reduce((total, p) => total + p.computeTotal, 0);
    expect(drawn).toBeGreaterThan(0);
    // The whole of the drop is the script, and nothing but the script.
    expect(idle - snap.resources.compute.ratePerSec).toBeCloseTo(drawn / 2, 6);
    // ...and the result tracks what the pool actually did. Loose by design: the
    // daemon half is a modelled steady rate and daemons land jobs in lumps, so
    // it leads or lags the pool by a fraction of a job over any short window.
    const measured = (snap.resources.compute.current - before) / 2;
    expect(Math.abs(snap.resources.compute.ratePerSec - measured)).toBeLessThan(0.1);
  });

  it('subtracts script draw from the energy balance too', () => {
    const engine = engineWith((run) => {
      builtOut(run);
      run.jobs.waiting = 0; // no daemon work, so only the script moves the reserve
      run.upgrades['worker-daemon'] = 0;
    });
    engine.tick(2000);
    const idle = engine.getSnapshot().resources.energy.ratePerSec;
    expect(idle).toBeCloseTo(BALANCE.resources.energyRegenPerSec, 10);

    expect(
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  x = 1 + 2 + 3 + 4 + 5\n}\n',
      }).ok,
    ).toBe(true);
    engine.tick(2000);
    expect(engine.getSnapshot().resources.energy.ratePerSec).toBeLessThan(idle);
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
