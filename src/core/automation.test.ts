/**
 * M2 tests: upgrades, inference daemons, overclock, energy, offline catch-up,
 * save migration and the balance-pass pacing pins.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { createGameEngine, newMetaState, newRunState } from './engine.ts';
import { deserializeSave, serializeSave } from './save.ts';
import type { GameEngine, RunState, SaveFile } from './types.ts';

/** Engine loaded from a crafted run state (current save shape). */
function engineWith(setup: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  setup(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 7, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

/** Advance sim time in 1 s slices (stays under the catch-up cap). */
function advance(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds; i++) {
    engine.tick(1000);
  }
}

describe('BUY_UPGRADE', () => {
  it('rejects unknown and not-yet-revealed packages identically', () => {
    const engine = createGameEngine(1);
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'no-such-package' }).reason).toBe(
      STRINGS.installUnknown,
    );
    // batch-window exists but unlocks at 15 lifetime jobs; a fresh run has 0.
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'batch-window' }).reason).toBe(
      STRINGS.installUnknown,
    );
  });

  it('purchases along the cost curve, spending capital and reserving RAM', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 100;
      run.resources.capital.current = 100;
    });
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'worker-daemon' }).ok).toBe(true);
    let snap = engine.getSnapshot();
    expect(snap.resources.capital.current).toBeCloseTo(70, 10);
    expect(snap.workers.count).toBe(1);
    expect(snap.resources.ram.current).toBe(64);

    // Second daemon costs 30 * 1.6 = 48.
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'worker-daemon' }).ok).toBe(true);
    snap = engine.getSnapshot();
    expect(snap.resources.capital.current).toBeCloseTo(70 - 48, 10);
    expect(snap.workers.count).toBe(2);
    expect(snap.resources.ram.current).toBe(128);
  });

  it('rejects on insufficient capital', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 100;
      run.resources.capital.current = 10;
    });
    const result = engine.dispatch({ type: 'BUY_UPGRADE', id: 'worker-daemon' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.installNoCapital);
  });

  it('rejects when the install would exceed free RAM, until a memory grant lands', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 200;
      run.resources.capital.current = 10_000;
      // 6*64 + 3*32 + 2*16 = 512 MB â€” the base partition is exactly full.
      run.upgrades = { 'worker-daemon': 6, 'request-router': 3, 'batch-window': 2 };
    });
    const blocked = engine.dispatch({ type: 'BUY_UPGRADE', id: 'batch-window' });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe(STRINGS.installNoRam);

    // A memory grant has no footprint of its own and unblocks the install.
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'ram-bank' }).ok).toBe(true);
    expect(engine.dispatch({ type: 'BUY_UPGRADE', id: 'batch-window' }).ok).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.resources.ram.current).toBe(528);
    expect(snap.resources.ram.capacity).toBe(768);
  });

  it('rejects installs past the channel limit', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 200;
      run.resources.capital.current = 10_000;
      run.upgrades = { 'ram-bank': 3 };
    });
    const result = engine.dispatch({ type: 'BUY_UPGRADE', id: 'ram-bank' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.installLimit);
  });
});

describe('inference daemons', () => {
  it('process queued jobs without clicks, paying compute overhead and earning capital', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 100;
      run.upgrades = { 'worker-daemon': 1 };
      run.resources.compute.current = 50;
    });
    advance(engine, 60);
    const snap = engine.getSnapshot();
    // One daemon at 0.6 jobs/s over 60 s â‰ˆ 36 jobs (arrival 2.6/s keeps the queue fed).
    const processed = snap.jobs.lifetimeProcessed - 100;
    expect(processed).toBeGreaterThanOrEqual(34);
    expect(processed).toBeLessThanOrEqual(36);
    // Net compute per daemon job: +1 âˆ’ 0.4 overhead = +0.6.
    expect(snap.resources.compute.current).toBeCloseTo(50 + processed * 0.6, 6);
    expect(snap.resources.capital.current).toBeCloseTo(processed * 0.25, 6);
  });

  it('stall with an empty compute buffer (overhead is unaffordable)', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 100;
      run.upgrades = { 'worker-daemon': 2 };
      run.resources.compute.current = 0;
    });
    advance(engine, 30);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(100);
  });

  it('two same-seed engines with daemons stay in exact agreement', () => {
    const setup = (run: RunState): void => {
      run.jobs.lifetimeProcessed = 100;
      run.upgrades = { 'worker-daemon': 2, 'request-router': 1 };
      run.resources.compute.current = 80;
    };
    const a = engineWith(setup);
    const b = engineWith(setup);
    advance(a, 120);
    advance(b, 120);
    expect(a.save(0)).toEqual(b.save(0));
  });
});

describe('click overclock', () => {
  it('EXECUTE extends the buff up to the cap, and it decays over time', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 100;
      run.upgrades = { 'worker-daemon': 1 };
      run.resources.compute.current = 50;
      run.jobs.waiting = 60;
    });
    for (let i = 0; i < 20; i++) {
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }
    const w = BALANCE.workers.overclock;
    expect(engine.getSnapshot().workers.overclockRemainingSec).toBe(w.maxSec);
    advance(engine, 5);
    expect(engine.getSnapshot().workers.overclockRemainingSec).toBeCloseTo(w.maxSec - 5, 6);
  });

  it('roughly doubles daemon throughput while active', () => {
    const setup =
      (overclockSec: number) =>
      (run: RunState): void => {
        run.jobs.lifetimeProcessed = 700; // arrival 6/s: the queue is never the limit
        run.upgrades = { 'worker-daemon': 2 };
        run.resources.compute.current = 200;
        run.jobs.waiting = 60;
        run.workers.overclockRemainingSec = overclockSec;
      };
    const boosted = engineWith(setup(10));
    const baseline = engineWith(setup(0));
    advance(boosted, 10);
    advance(baseline, 10);
    const boostedJobs = boosted.getSnapshot().jobs.lifetimeProcessed - 700;
    const baselineJobs = baseline.getSnapshot().jobs.lifetimeProcessed - 700;
    expect(boostedJobs).toBeGreaterThanOrEqual(baselineJobs * 1.8);
  });
});

describe('energy', () => {
  it('drains under heavy daemon load and throttles throughput when exhausted', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 700; // arrival 6/s keeps 4 daemons saturated
      run.upgrades = { 'worker-daemon': 4 }; // drain 2.0/s vs regen 1.2/s
      run.resources.compute.current = 400;
    });
    advance(engine, 300);
    const snap = engine.getSnapshot();
    expect(snap.resources.energy.current).toBeLessThan(10);
    const processed = snap.jobs.lifetimeProcessed - 700;
    // Full rate would be 2.4 jobs/s * 300 s = 720; the energy wall must bite well below that,
    // but throttled daemons still make progress.
    expect(processed).toBeLessThan(650);
    expect(processed).toBeGreaterThan(300);
  });

  it('recharges to capacity while daemons are idle', () => {
    const engine = engineWith((run) => {
      run.resources.energy.current = 20;
    });
    advance(engine, 80);
    expect(engine.getSnapshot().resources.energy.current).toBe(BALANCE.resources.energyCapacity);
  });
});

describe('offline catch-up', () => {
  it('ignores short absences', () => {
    const engine = engineWith((run) => {
      run.upgrades = { 'worker-daemon': 1 };
      run.resources.compute.current = 50;
    });
    const before = engine.save(0);
    engine.advanceOffline((BALANCE.save.offlineMinSec - 10) * 1000);
    expect(engine.save(0)).toEqual(before);
  });

  it('with no daemons, only the queue fills (to its cap)', () => {
    const engine = createGameEngine(7);
    engine.advanceOffline(10 * 60 * 1000);
    const snap = engine.getSnapshot();
    expect(snap.jobs.waiting).toBe(BALANCE.jobs.queueCapacity);
    expect(snap.jobs.lifetimeProcessed).toBe(0);
    expect(snap.terminal.some((l) => l.text.startsWith('OFFLINE CATCH-UP'))).toBe(true);
  });

  it('daemons process at coarse average rates while away', () => {
    const engine = engineWith((run) => {
      run.jobs.lifetimeProcessed = 150; // arrival 2.6/s > daemon rate â€” daemons are the limit
      run.upgrades = { 'worker-daemon': 2 }; // 1.2 jobs/s, drain 1.0 < regen 1.2 â€” sustained
      run.resources.compute.current = 100;
    });
    engine.advanceOffline(10 * 60 * 1000);
    const snap = engine.getSnapshot();
    const processed = snap.jobs.lifetimeProcessed - 150;
    expect(processed).toBe(720); // 1.2 jobs/s * 600 s, exact in 60 s chunks
    expect(snap.resources.capital.current).toBeCloseTo(720 * 0.25, 6);
    expect(snap.resources.energy.current).toBe(BALANCE.resources.energyCapacity);
  });

  it('caps the absence at the configured maximum', () => {
    const setup = (run: RunState): void => {
      run.jobs.lifetimeProcessed = 150;
      run.upgrades = { 'worker-daemon': 2 };
      run.resources.compute.current = 100;
    };
    const capped = engineWith(setup);
    const exact = engineWith(setup);
    capped.advanceOffline(24 * 3600 * 1000);
    exact.advanceOffline(BALANCE.save.offlineCapHours * 3600 * 1000);
    expect(capped.getSnapshot().jobs.lifetimeProcessed).toBe(
      exact.getSnapshot().jobs.lifetimeProcessed,
    );
  });
});

describe('save migration', () => {
  it('migrates a v1 save (M1) through the full pipeline with default automation state', () => {
    const engine = createGameEngine(42);
    engine.tick(3000);
    const current = engine.save(123);
    // Reconstruct the M1 shape: no upgrades, no workers, no ccl/scheduler, version 1.
    const v1run = { ...current.run } as Record<string, unknown>;
    delete v1run.upgrades;
    delete v1run.workers;
    delete v1run.ccl;
    delete v1run.scheduler;
    delete v1run.flags;
    delete v1run.telemetry;
    delete v1run.market;
    delete v1run.thermal;
    const v1 = { version: 1, savedAt: 123, meta: current.meta, run: v1run };
    const text = serializeSave(v1 as unknown as SaveFile);

    const restored = deserializeSave(text);
    expect(restored).not.toBeNull();
    expect(restored!.version).toBe(7);
    expect(restored!.run.upgrades).toEqual({});
    expect(restored!.run.workers).toEqual({ processAccumulator: 0, overclockRemainingSec: 0 });
    expect(restored!.run.ccl).toEqual({
      editorSource: '',
      runCount: 0,
      lastRun: null,
      manual: {
        activations: 0,
        opsTotal: 0,
        computeTotal: 0,
        commandCalls: 0,
        commandFailures: 0,
      },
    });
    expect(restored!.run.scheduler).toEqual({ deployments: [], nextId: 1 });
    expect(restored!.run.telemetry).toEqual({ log: [], nextLogId: 1 });
    expect(restored!.run.flags).toEqual([]);
    expect(restored!.run.unlocks.editor).toBe(false);
    expect(restored!.run.unlocks.scheduler).toBe(false);
    expect(restored!.run.unlocks.instrumentation).toBe(false);
    expect(restored!.run.unlocks.loops).toBe(false);
    expect(restored!.run.market).toBeNull();
    expect(restored!.run.unlocks.market).toBe(false);
    // The heat model always runs, so the thermal machinery is always present —
    // but the *controls* are a tier, so the gate re-derives like the others.
    expect(restored!.run.thermal.openedAtTick).toBeNull();
    expect(restored!.run.thermal.clockTicks).toBe(0);
    expect(restored!.run.unlocks.thermal).toBe(false);
    expect(restored!.run.resources.temperature.current).toBe(BALANCE.thermal.ambientC);

    // And a fresh engine accepts the migrated file.
    const engineB = createGameEngine(1);
    engineB.load(restored!);
    expect(engineB.getSnapshot().jobs.lifetimeProcessed).toBe(current.run.jobs.lifetimeProcessed);
  });
});

describe('balance pass 1 (pacing pins)', () => {
  /** Greedy manual play: ~2 clicks per second. */
  function clickSecond(engine: GameEngine): void {
    engine.tick(500);
    engine.dispatch({ type: 'EXECUTE_CLICK' });
    engine.tick(500);
    engine.dispatch({ type: 'EXECUTE_CLICK' });
  }

  it('the first daemon is reachable within ~4 minutes of manual play', () => {
    const engine = createGameEngine(42);
    let firstAffordableAt = -1;
    for (let sec = 1; sec <= 240; sec++) {
      clickSecond(engine);
      const snap = engine.getSnapshot();
      const daemon = snap.upgrades.find((u) => u.id === 'worker-daemon');
      if (daemon && daemon.affordable) {
        firstAffordableAt = sec;
        break;
      }
    }
    expect(firstAffordableAt).toBeGreaterThanOrEqual(60);
    expect(firstAffordableAt).toBeLessThanOrEqual(240);
  });

  it('automation clearly beats manual-only play by the 10 minute mark', () => {
    const manual = createGameEngine(42);
    const automated = createGameEngine(42);
    const buyOrder = ['worker-daemon', 'request-router', 'power-feed'];
    for (let sec = 1; sec <= 600; sec++) {
      clickSecond(manual);
      clickSecond(automated);
      for (const id of buyOrder) {
        const view = automated.getSnapshot().upgrades.find((u) => u.id === id);
        if (view && view.affordable && view.ramOk && view.nextCost !== null) {
          automated.dispatch({ type: 'BUY_UPGRADE', id });
          break;
        }
      }
    }
    const manualJobs = manual.getSnapshot().jobs.lifetimeProcessed;
    const automatedJobs = automated.getSnapshot().jobs.lifetimeProcessed;
    expect(automatedJobs).toBeGreaterThan(manualJobs * 1.15);
  });
});
