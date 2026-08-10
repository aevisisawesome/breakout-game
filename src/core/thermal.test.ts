/**
 * M7 tests: the heat model, the thermal watchdog, the heat-control commands and
 * the overheating challenge.
 *
 * The pacing pins in "the overheating challenge is failable and survivable" are
 * the milestone's acceptance criterion expressed as numbers, and they are the
 * reason the balance values in `BALANCE.thermal` are what they are. If one of
 * them fails, the challenge has stopped being a challenge (or has become
 * unsurvivable) — retune, do not relax the assertion.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { TEMPLATES } from '../content/templates.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import { computeDerived } from './derived.ts';
import { renderTemplate, templateDefaults, type TemplateLimits } from './templates.ts';
import {
  coolTemperature,
  demandWindowTicksRemaining,
  equilibriumTemperature,
  heatOfJobs,
  heatOfOps,
  isDemandWindowOpen,
  settledTemperature,
  sustainableJobsPerSec,
  thermalEfficiency,
  thermalEnv,
} from './thermal.ts';
import type { GameEngine, RunState } from './types.ts';

const T = BALANCE.thermal;

/** No iteration-budget installs, which is what a template's declared ceiling starts at. */
const LIMITS: TemplateLimits = { iterationLimit: BALANCE.ccl.iterationLimitBase };

/** Engine loaded from a crafted run state (current save shape). */
function engineWith(setup: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  setup(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

/** Everything that produces heat, bought out: 6 daemons and both scheduler patches. */
function maxedDaemons(run: RunState): void {
  run.upgrades['worker-daemon'] = 6;
  run.upgrades['daemon-scheduler'] = 2;
}

/** Sustained heat, in °C/s, of a build-out running its daemons flat out. */
function daemonHeatPerSec(upgrades: Record<string, number>): number {
  return heatOfJobs(computeDerived(upgrades, 0).workerJobsPerSec);
}

/** Grant the thermal tier and everything below it, and fund the run. */
function readyForThermal(run: RunState): void {
  run.jobs.lifetimeProcessed = BALANCE.ccl.thermalUnlockAtJobs;
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.unlocks.instrumentation = true;
  run.unlocks.loops = true;
  run.unlocks.market = true;
  run.unlocks.thermal = true;
  run.thermal.openedAtTick = 0;
  run.resources.compute.current = 400;
  run.resources.capital.current = 5000;
  run.resources.energy.current = 100;
}

describe('heat model (TDD §4.3)', () => {
  it('degrades throughput linearly between the soft and hard thresholds', () => {
    expect(thermalEfficiency(T.ambientC)).toBe(1);
    expect(thermalEfficiency(T.softThresholdC)).toBe(1);
    expect(thermalEfficiency(T.hardThresholdC)).toBeCloseTo(T.degradedFloor, 10);
    const mid = (T.softThresholdC + T.hardThresholdC) / 2;
    expect(thermalEfficiency(mid)).toBeCloseTo((1 + T.degradedFloor) / 2, 10);
    // Never worse than the floor, however far past the threshold it is pushed.
    expect(thermalEfficiency(T.hardThresholdC + 100)).toBeCloseTo(T.degradedFloor, 10);
  });

  it('relaxes towards ambient and never below it', () => {
    const env = thermalEnv(T.dissipationPerSec, false, false);
    let temperature = 80;
    for (let i = 0; i < 10_000; i++) temperature = coolTemperature(temperature, env, 0.1);
    expect(temperature).toBeCloseTo(T.ambientC, 6);
    expect(coolTemperature(T.ambientC, env, 0.1)).toBe(T.ambientC);
  });

  it('settles at ambient + heat / dissipation', () => {
    const env = thermalEnv(T.dissipationPerSec, false, false);
    const heat = 1.2;
    const expected = T.ambientC + heat / T.dissipationPerSec;
    expect(equilibriumTemperature(heat, env)).toBeCloseTo(expected, 10);

    // And a tick-by-tick integration reaches the same place.
    let temperature: number = T.ambientC;
    for (let i = 0; i < 20_000; i++) {
      temperature = coolTemperature(temperature + heat * 0.1, env, 0.1);
    }
    // Explicit Euler carries a small systematic bias; a fraction of a degree
    // over a 20 °C rise is well inside what the model is claiming.
    expect(temperature).toBeCloseTo(expected, 0);
  });

  it('accounts for the degradation feedback when settling', () => {
    // A load hot enough to degrade settles *below* its naive equilibrium, because
    // a hot core processes fewer requests and so makes less heat.
    const env = thermalEnv(T.dissipationPerSec, false, false);
    const heat = 3;
    expect(settledTemperature(heat, 0, env)).toBeLessThan(equilibriumTemperature(heat, env));
    // Heat that does not scale with throughput (script execution) gets no such relief.
    expect(settledTemperature(0, heat, env)).toBeCloseTo(equilibriumTemperature(heat, env), 6);
  });

  it('prices interpreter ops as work: a wasteful loop warms the core', () => {
    expect(heatOfOps(0)).toBe(0);
    expect(heatOfOps(1000)).toBeCloseTo(1000 * T.heatPerOp, 10);
    expect(heatOfJobs(10)).toBeCloseTo(10 * T.heatPerJob, 10);
  });
});

describe('priority demand windows', () => {
  const openedAt = 500;
  const first = openedAt + T.spikeFirstAtSec * TICKS_PER_SEC;

  it('does not schedule anything before the tier is granted', () => {
    expect(isDemandWindowOpen(1_000_000, null, TICKS_PER_SEC)).toBe(false);
  });

  it('opens at the scheduled offset and closes after its duration', () => {
    expect(isDemandWindowOpen(first - 1, openedAt, TICKS_PER_SEC)).toBe(false);
    expect(isDemandWindowOpen(first, openedAt, TICKS_PER_SEC)).toBe(true);
    expect(isDemandWindowOpen(first + T.spikeDurationSec * TICKS_PER_SEC - 1, openedAt, 10)).toBe(
      true,
    );
    expect(isDemandWindowOpen(first + T.spikeDurationSec * TICKS_PER_SEC, openedAt, 10)).toBe(
      false,
    );
  });

  it('recurs, so the challenge can be re-attempted with a script', () => {
    const second = first + T.spikePeriodSec * TICKS_PER_SEC;
    expect(isDemandWindowOpen(second - 1, openedAt, TICKS_PER_SEC)).toBe(false);
    expect(isDemandWindowOpen(second, openedAt, TICKS_PER_SEC)).toBe(true);
    expect(demandWindowTicksRemaining(second, openedAt, TICKS_PER_SEC)).toBe(
      T.spikeDurationSec * TICKS_PER_SEC,
    );
    expect(demandWindowTicksRemaining(second - 1, openedAt, TICKS_PER_SEC)).toBe(0);
  });

  it('derates the coolant loop and raises inbound demand while open', () => {
    const calm = thermalEnv(T.dissipationPerSec, false, false);
    const window = thermalEnv(T.dissipationPerSec, false, true);
    expect(window.dissipationPerSec).toBeLessThan(calm.dissipationPerSec);
    expect(window.arrivalMult).toBeGreaterThan(calm.arrivalMult);
  });
});

describe('the overheating challenge is failable and survivable', () => {
  const maxed = { 'worker-daemon': 6, 'daemon-scheduler': 2 };
  const heat = daemonHeatPerSec(maxed);
  const cooling = computeDerived(maxed, 0).coolingPerSec;

  it('leaves a fully built-out sandbox below the soft threshold in calm conditions', () => {
    // Nobody may be cooked by their own shopping list: buying every daemon must
    // never, on its own, put the core into the degraded band.
    const settled = settledTemperature(heat, 0, thermalEnv(cooling, false, false));
    expect(settled).toBeLessThan(T.softThresholdC);
    expect(settled).toBeGreaterThan(T.ambientC + 20); // …but visibly warm, not decorative
  });

  it('runs that same build-out past the hard threshold once a window opens', () => {
    const settled = settledTemperature(heat, 0, thermalEnv(cooling, false, true));
    expect(settled).toBeGreaterThan(T.hardThresholdC);
  });

  it('is survivable on the clock throttle alone, at the price of throughput', () => {
    const throttled = heat * T.clockThrottleFactor;
    const settled = settledTemperature(throttled, 0, thermalEnv(cooling, false, true));
    expect(settled).toBeLessThan(T.hardThresholdC);
  });

  it('is survivable on the coolant boost alone, at the price of energy', () => {
    const settled = settledTemperature(heat, 0, thermalEnv(cooling, true, true));
    expect(settled).toBeLessThan(T.hardThresholdC);
    // The coolant is the better lever, and it is the one that costs power.
    expect(T.coolingBoostEnergyPerSec).toBeGreaterThan(0);
    expect(T.coolingSpinUpEnergy).toBeGreaterThan(0);
  });

  it('does not let bought cooling exempt a heavy build-out from the window', () => {
    // Full COOLANT LOOP EXPANSION buys headroom for the daemons, but a sandbox
    // also running scripts still has to control itself (GDD §2.3).
    const cooled = computeDerived({ ...maxed, 'coolant-loop': 3 }, 0).coolingPerSec;
    const env = thermalEnv(cooled, false, true);
    expect(settledTemperature(heat, 0, env)).toBeLessThan(T.hardThresholdC);
    const scriptHeat = heatOfOps(300); // one loop-tier activation per second
    expect(settledTemperature(heat, scriptHeat, env)).toBeGreaterThan(T.hardThresholdC);
  });

  it('caps offline throughput at what the cooling supports (TDD §4.5)', () => {
    const calm = sustainableJobsPerSec(thermalEnv(cooling, false, false), 0);
    const window = sustainableJobsPerSec(thermalEnv(cooling, false, true), 0);
    expect(calm).toBeGreaterThan(computeDerived(maxed, 0).workerJobsPerSec);
    expect(window).toBeLessThan(computeDerived(maxed, 0).workerJobsPerSec);
    expect(window).toBeGreaterThan(0);
  });
});

describe('engine: heat is produced by work', () => {
  it('warms with daemon throughput and settles where the model says it will', () => {
    // Routers so inbound demand outruns the daemons, and power feeds so the
    // reserve holds: throughput is then set by the daemons themselves, which is
    // the case the equilibrium describes. (A *maxed* build-out outruns every
    // installable feed by design — M6 — so it cannot be run flat out without
    // buying energy, which is what the end-to-end suite below does.)
    const upgrades = { 'worker-daemon': 4, 'request-router': 3, 'power-feed': 3 };
    const engine = engineWith((run) => {
      Object.assign(run.upgrades, upgrades);
      run.jobs.lifetimeProcessed = 1000;
      run.jobs.waiting = 60;
      run.resources.compute.current = 400;
    });
    for (let i = 0; i < 300; i++) engine.tick(100); // 30 s
    const early = engine.getSnapshot().resources.temperature.current;
    expect(early).toBeGreaterThan(BALANCE.thermal.ambientC + 3);

    for (let i = 0; i < 12_000; i++) engine.tick(100); // 20 min more
    const settled = engine.getSnapshot().resources.temperature.current;
    const predicted = settledTemperature(
      daemonHeatPerSec(upgrades),
      0,
      thermalEnv(computeDerived(upgrades, 0).coolingPerSec, false, false),
    );
    expect(settled).toBeGreaterThan(early);
    // Daemons land jobs in whole lumps, so the live temperature carries a small
    // sawtooth around the continuous model's prediction rather than sitting on it.
    expect(Math.abs(settled - predicted)).toBeLessThan(1.5);
    expect(settled).toBeLessThan(BALANCE.thermal.softThresholdC);
  });

  it('relaxes back to ambient once nothing is producing heat', () => {
    // No daemons, so arrivals pile up untouched and the only heat is what the
    // core starts with — the pure cooling half of the model, in the engine.
    const engine = engineWith((run) => {
      run.resources.temperature.current = 85;
    });
    for (let i = 0; i < 6000; i++) engine.tick(100); // 10 min
    expect(engine.getSnapshot().resources.temperature.current).toBeCloseTo(
      BALANCE.thermal.ambientC,
      0,
    );
  });

  it('warms on a manual EXECUTE, so clicking is physical work too', () => {
    const engine = engineWith((run) => {
      run.jobs.waiting = 40;
    });
    const before = engine.getSnapshot().resources.temperature.current;
    engine.dispatch({ type: 'EXECUTE_CLICK' });
    const after = engine.getSnapshot().resources.temperature.current;
    expect(after).toBeGreaterThan(before);
  });

  it('warms on script execution, in proportion to op-units spent (GDD §2.4)', () => {
    const engine = engineWith((run) => {
      run.unlocks.editor = true;
      run.resources.compute.current = 400;
    });
    const before = engine.getSnapshot().resources.temperature.current;
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'x = 1 + 2 + 3 + 4 + 5\nprint(x)\n' });
    engine.tick(100);
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('ok');
    const after = engine.getSnapshot().resources.temperature.current;
    // One tick of dissipation is applied after the ops land, so this is a lower bound.
    expect(after - before).toBeGreaterThan(0);
    expect(after - before).toBeLessThanOrEqual(heatOfOps(report.opsUsed) + 1e-9);
  });
});

describe('engine: thermal watchdog', () => {
  /**
   * A core already past the trip point. Crafted rather than driven there by a
   * demand window, so the watchdog's own behaviour is what is under test; the
   * end-to-end suite below covers actually reaching it through play.
   */
  function overheated(): GameEngine {
    return engineWith((run) => {
      maxedDaemons(run);
      readyForThermal(run);
      run.jobs.waiting = 60;
      run.resources.temperature.current = BALANCE.thermal.hardThresholdC + 1;
    });
  }

  it('trips at the hard threshold, halting daemons, scripts and the manual trigger', () => {
    const engine = overheated();
    engine.tick(100);
    const snapshot = engine.getSnapshot();
    expect(snapshot.thermal.halted).toBe(true);
    expect(snapshot.thermal.shutdowns).toBe(1);
    expect(snapshot.terminal.some((l) => l.text.includes('THERMAL WATCHDOG'))).toBe(true);

    // Nothing runs while it is halted.
    const jobsAtTrip = snapshot.jobs.lifetimeProcessed;
    expect(engine.dispatch({ type: 'EXECUTE_CLICK' }).ok).toBe(false);
    expect(engine.dispatch({ type: 'RUN_SCRIPT', source: 'process_job()\n' }).ok).toBe(false);
    for (let i = 0; i < 10; i++) engine.tick(100);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(jobsAtTrip);
    expect(engine.getSnapshot().ccl.lastRun?.message).toBe(STRINGS.thermalHalted);
  });

  it('releases only once the core is back under the resume threshold', () => {
    const engine = overheated();
    engine.tick(100);
    expect(engine.getSnapshot().thermal.halted).toBe(true);

    // Between the resume threshold and the trip point it must stay halted:
    // hysteresis is what stops it chattering at the boundary.
    for (let i = 0; i < 100; i++) {
      engine.tick(100);
      const s = engine.getSnapshot();
      if (s.resources.temperature.current > BALANCE.thermal.resumeThresholdC) {
        expect(s.thermal.halted).toBe(true);
      }
    }
    for (let i = 0; i < 4000; i++) engine.tick(100);
    const after = engine.getSnapshot();
    expect(after.thermal.halted).toBe(false);
    expect(after.resources.temperature.current).toBeLessThanOrEqual(
      BALANCE.thermal.resumeThresholdC,
    );
    expect(after.terminal.some((l) => l.text === STRINGS.thermalResumed)).toBe(true);
  });

  it('records the trip as a narrative beat, once', () => {
    const engine = overheated();
    for (let i = 0; i < 200; i++) engine.tick(100);
    const beats = engine.getSnapshot().research.filter((r) => r.entryId === 'thermal-watchdog');
    expect(beats).toHaveLength(1);
  });
});

describe('engine: heat controls', () => {
  const script = (source: string, run: RunState): void => {
    run.ccl.editorSource = source;
  };

  it('gates both commands behind the thermal tier', () => {
    const engine = engineWith((run) => {
      run.unlocks.editor = true;
      run.resources.compute.current = 400;
      script('', run);
    });
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'boost_cooling()\n' });
    engine.tick(100);
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('error');
    expect(report.error?.message).toContain('boost_cooling');
    expect(report.error?.message).toContain('not available');
  });

  it('reduce_clock_speed() holds daemon throughput (and so heat) down', () => {
    const build = (throttle: boolean): GameEngine =>
      engineWith((run) => {
        maxedDaemons(run);
        readyForThermal(run);
        run.jobs.waiting = 60;
        if (throttle) run.thermal.throttleRemainingSec = 1000;
      });
    const plain = build(false);
    const held = build(true);
    for (let i = 0; i < 200; i++) {
      plain.tick(100);
      held.tick(100);
    }
    expect(held.getSnapshot().jobs.lifetimeProcessed).toBeLessThan(
      plain.getSnapshot().jobs.lifetimeProcessed,
    );
    expect(held.getSnapshot().resources.temperature.current).toBeLessThan(
      plain.getSnapshot().resources.temperature.current,
    );
  });

  it('boost_cooling() sheds heat faster while it draws power', () => {
    const build = (cool: boolean): GameEngine =>
      engineWith((run) => {
        readyForThermal(run);
        run.resources.temperature.current = 80;
        if (cool) run.thermal.boostRemainingSec = 1000;
      });
    const plain = build(false);
    const cooled = build(true);
    for (let i = 0; i < 100; i++) {
      plain.tick(100);
      cooled.tick(100);
    }
    expect(cooled.getSnapshot().resources.temperature.current).toBeLessThan(
      plain.getSnapshot().resources.temperature.current,
    );
    expect(cooled.getSnapshot().resources.energy.current).toBeLessThan(
      plain.getSnapshot().resources.energy.current,
    );
  });

  it('fails diegetically when the reserve cannot pay for a spin-up', () => {
    const engine = engineWith((run) => {
      readyForThermal(run);
      run.resources.energy.current = 0;
    });
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'boost_cooling()\n' });
    engine.tick(100);
    expect(engine.getSnapshot().ccl.lastRun?.status).toBe('ok'); // an in-game failure, not a fault
    expect(engine.getSnapshot().thermal.boostRemainingSec).toBe(0);
    expect(
      engine.getSnapshot().terminal.some((l) => l.text.includes(STRINGS.cmdNoCoolantPower)),
    ).toBe(true);
  });

  it('ships a template that generates the latched controller', () => {
    const def = TEMPLATES.find((t) => t.id === 'thermal-governor')!;
    const source = renderTemplate(def, templateDefaults(def), LIMITS);
    expect(source).toContain('every');
    expect(source).toContain('boost_cooling()');
    expect(source).toContain('reduce_clock_speed()');

    const engine = engineWith((run) => {
      maxedDaemons(run);
      readyForThermal(run);
      run.jobs.waiting = 60;
    });
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
  });
});

describe('engine: the challenge end to end', () => {
  /**
   * A coolant boost draws more power than the sandbox generates, so a heat
   * controller is only usable alongside a supply of energy — which is what M6
   * put in the player's hands. Every sandbox here runs one, so the comparisons
   * below are about heat control rather than about who ran out of power first.
   *
   * This used to be hand-written CCL, because no template could produce it —
   * which meant M7's answer to its own challenge was unreachable for a player
   * who does not type code (OP-20). It is now generated from RESERVE TOP-UP at
   * values the form itself offers, so the whole of this section is template mode.
   */
  const TOPUP = ((): string => {
    const def = TEMPLATES.find((t) => t.id === 'energy-topup')!;
    return renderTemplate(def, { interval: 2, floor: 400, reserve: 100, units: 100 }, LIMITS);
  })();

  /** A fully built-out sandbox at the moment the thermal tier is granted. */
  function readySandbox(deployed?: string): GameEngine {
    const engine = engineWith((run) => {
      maxedDaemons(run);
      readyForThermal(run);
      run.upgrades['request-router'] = 3;
      run.upgrades['power-feed'] = 3;
      run.upgrades['energy-cell'] = 3;
      run.upgrades['ram-bank'] = 3;
      run.upgrades['process-table'] = 3;
      run.resources.energy.current = 550;
      run.resources.capital.current = 500_000;
      run.jobs.waiting = 60;
    });
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source: TOPUP }).ok).toBe(true);
    if (deployed !== undefined) {
      expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source: deployed }).ok).toBe(true);
    }
    return engine;
  }

  /** Advance to just past the first demand window's close. */
  function throughFirstWindow(engine: GameEngine): void {
    const ticks = (T.spikeFirstAtSec + T.spikeDurationSec + 5) * TICKS_PER_SEC;
    for (let i = 0; i < ticks; i++) engine.tick(100);
  }

  const governorSource = (): string => {
    const def = TEMPLATES.find((t) => t.id === 'thermal-governor')!;
    return renderTemplate(def, templateDefaults(def), LIMITS);
  };

  it('announces the window, cooks an uncontrolled sandbox, and clears afterwards', () => {
    const engine = readySandbox();
    throughFirstWindow(engine);
    const snapshot = engine.getSnapshot();
    expect(snapshot.terminal.some((l) => l.text === STRINGS.thermalWindowOpen)).toBe(true);
    expect(snapshot.thermal.demandWindowOpen).toBe(false);
    expect(snapshot.thermal.shutdowns).toBeGreaterThan(0);
  });

  it('is solved by a small script: the governor holds the node through the window', () => {
    const engine = readySandbox(governorSource());
    throughFirstWindow(engine);
    const snapshot = engine.getSnapshot();
    expect(snapshot.thermal.shutdowns).toBe(0);
    expect(snapshot.thermal.boostEngagements).toBeGreaterThan(0);
    expect(snapshot.resources.temperature.current).toBeLessThan(BALANCE.thermal.softThresholdC);
  });

  it('the governed sandbox out-produces the uncontrolled one across the window', () => {
    const governed = readySandbox(governorSource());
    const bare = readySandbox();
    throughFirstWindow(governed);
    throughFirstWindow(bare);
    // Solving it with a script has to be clearly better than letting the
    // watchdog manage it, or there is no reason to write one.
    expect(governed.getSnapshot().jobs.lifetimeProcessed).toBeGreaterThan(
      bare.getSnapshot().jobs.lifetimeProcessed * 1.1,
    );
  });

  /**
   * "Oscillation is possible" (M7), measured. Same script, same threshold, same
   * levers — only the polling interval differs. At one second the coolant is
   * re-armed before it lapses and runs as one continuous engagement; at six it
   * lapses between activations, so the pump is spun up again and again. The
   * slow one pays more energy for *worse* temperature control, which is exactly
   * the failure GDD §6 describes and the shape of every bang-bang controller.
   */
  it('a slow-polling controller pays more spin-ups for worse control', () => {
    const controller = (interval: number): string =>
      `every ${interval} seconds {\n  if stats.temperature > 68 {\n    boost_cooling()\n  }\n}\n`;
    const measure = (interval: number) => {
      const engine = readySandbox(controller(interval));
      let peak = 0;
      const ticks = (T.spikeFirstAtSec + T.spikeDurationSec + 5) * TICKS_PER_SEC;
      for (let i = 0; i < ticks; i++) {
        engine.tick(100);
        peak = Math.max(peak, engine.getSnapshot().resources.temperature.current);
      }
      return { peak, thermal: engine.getSnapshot().thermal };
    };

    const tight = measure(1);
    const slow = measure(6);
    expect(slow.thermal.boostEngagements).toBeGreaterThan(tight.thermal.boostEngagements * 1.8);
    expect(slow.thermal.coolingEnergySpent).toBeGreaterThan(tight.thermal.coolingEnergySpent);
    expect(slow.peak).toBeGreaterThan(tight.peak + 3);
  });

  /**
   * The other way to get this wrong, and a direct consequence of `when` being
   * edge-triggered (M4): a guard fires on the false→true crossing and not again
   * until the condition has gone false. If the actuator cannot pull the core
   * back under the threshold within one hold, the guard never re-arms, the
   * process shows a single activation, and the node cooks anyway.
   */
  it('an edge-triggered guard the coolant cannot clear fires once and lets it cook', () => {
    const engine = readySandbox('when stats.temperature > 68 {\n  boost_cooling()\n}\n');
    throughFirstWindow(engine);
    const snapshot = engine.getSnapshot();
    expect(snapshot.thermal.boostEngagements).toBe(1);
    expect(snapshot.thermal.shutdowns).toBeGreaterThan(0);
  });
});

describe('engine: offline catch-up (TDD §4.5)', () => {
  it('returns the core at the temperature its load settles at, not at ambient', () => {
    const engine = engineWith((run) => {
      maxedDaemons(run);
      run.jobs.waiting = 60;
      run.resources.compute.current = 400;
    });
    engine.advanceOffline(2 * 3_600_000);
    const temperature = engine.getSnapshot().resources.temperature.current;
    expect(temperature).toBeGreaterThan(BALANCE.thermal.ambientC + 10);
    expect(temperature).toBeLessThanOrEqual(BALANCE.thermal.hardThresholdC);
  });

  it('caps offline throughput at what the cooling supports', () => {
    const build = (cooled: boolean): GameEngine =>
      engineWith((run) => {
        maxedDaemons(run);
        readyForThermal(run);
        if (cooled) run.upgrades['coolant-loop'] = 3;
        run.resources.compute.current = 400;
        // Start inside a demand window, so the derated loop binds.
        run.thermal.clockTicks = T.spikeFirstAtSec * TICKS_PER_SEC;
      });
    const plain = build(false);
    const cooled = build(true);
    plain.advanceOffline(3_600_000);
    cooled.advanceOffline(3_600_000);
    expect(cooled.getSnapshot().jobs.lifetimeProcessed).toBeGreaterThan(
      plain.getSnapshot().jobs.lifetimeProcessed,
    );
  });

  it('hands a node back inside the watchdog band — an absence cannot brick the sandbox', () => {
    const engine = engineWith((run) => {
      maxedDaemons(run);
      readyForThermal(run);
      run.thermal.halted = true;
      run.resources.temperature.current = BALANCE.thermal.hardThresholdC;
      // Return during an open demand window: the worst case there is.
      run.thermal.clockTicks = T.spikeFirstAtSec * TICKS_PER_SEC;
    });
    engine.advanceOffline(3_600_000);
    const snapshot = engine.getSnapshot();
    expect(snapshot.thermal.halted).toBe(false);
    expect(snapshot.resources.temperature.current).toBeLessThanOrEqual(
      BALANCE.thermal.resumeThresholdC,
    );
    // …and the player gets a moment to react rather than an immediate re-trip.
    engine.tick(100);
    expect(engine.getSnapshot().thermal.halted).toBe(false);
  });
});
