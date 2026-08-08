/**
 * M4 engine tests: conditional scripts, the `every`/`when` scheduler, slot and
 * RAM accounting, the process monitor's counters, deployment persistence
 * (source in, AST recompiled), offline safe mode, and determinism.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine with every M4 tier unlocked and a stocked sandbox. */
function schedulerEngine(setup?: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.resources.compute.current = 200;
  run.resources.capital.current = 500;
  run.jobs.waiting = 40;
  setup?.(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 5, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

function terminalText(engine: GameEngine): string {
  return engine
    .getSnapshot()
    .terminal.map((l) => l.text)
    .join('\n');
}

/** Advance the sim by whole seconds of game time. */
function advanceSec(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SEC; i++) engine.tick(100);
}

const AUTO_PROCESSOR = 'every 1 seconds {\n  process_job()\n}';

describe('DEPLOY_SCRIPT', () => {
  it('installs the declarations into slots and charges RAM by script size', () => {
    const engine = schedulerEngine();
    const ramBefore = engine.getSnapshot().resources.ram.current;

    const result = engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    expect(result.ok).toBe(true);

    const snap = engine.getSnapshot();
    expect(snap.scheduler.slotsUsed).toBe(1);
    expect(snap.scheduler.slotsTotal).toBe(BALANCE.scheduler.baseSlots);
    expect(snap.scheduler.deployments).toHaveLength(1);
    expect(snap.scheduler.deployments[0]!.processes[0]!.label).toBe('every 1 seconds');
    expect(snap.scheduler.deployments[0]!.ramMb).toBeGreaterThanOrEqual(
      BALANCE.scheduler.scriptRamBaseMb,
    );
    expect(snap.resources.ram.current).toBe(ramBefore + snap.scheduler.deployments[0]!.ramMb);
    expect(terminalText(engine)).toContain(STRINGS.deployCommitted);
  });

  it('rejects a script with no scheduled declaration', () => {
    const engine = schedulerEngine();
    const result = engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'process_job()' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.deployNoProcesses);
  });

  it('rejects a deploy that would exceed the scheduler slots', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    const result = engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.deployNoSlots);
    expect(engine.getSnapshot().scheduler.slotsUsed).toBe(1);
  });

  it('rejects an interval below the minimum sampling period', () => {
    const engine = schedulerEngine();
    const belowMinSec = BALANCE.scheduler.minIntervalTicks / TICKS_PER_SEC / 2;
    const result = engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: `every ${belowMinSec} seconds {\n  process_job()\n}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.deployInterval);
  });

  it('fails diegetically when the memory partition cannot hold the script', () => {
    const engine = schedulerEngine((run) => {
      // Fill the memory partition to capacity with installed packages.
      run.upgrades = { 'worker-daemon': 6, 'batch-window': 4, 'request-router': 2 };
    });
    const snap = engine.getSnapshot();
    const free = snap.resources.ram.capacity - snap.resources.ram.current;
    expect(free).toBeLessThan(BALANCE.scheduler.scriptRamBaseMb);
    const result = engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.deployNoRam);
  });

  it('refuses to deploy before the scheduler is granted', () => {
    const engine = schedulerEngine((run) => {
      run.unlocks.scheduler = false;
    });
    const result = engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.deployNoAccess);
  });

  it('a PROCESS TABLE EXTENSION install adds a slot', () => {
    const engine = schedulerEngine((run) => {
      run.jobs.lifetimeProcessed = 480;
      run.upgrades = { 'process-table': 1 };
    });
    expect(engine.getSnapshot().scheduler.slotsTotal).toBe(BALANCE.scheduler.baseSlots + 1);
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR }).ok).toBe(true);
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR }).ok).toBe(true);
    expect(engine.getSnapshot().scheduler.slotsUsed).toBe(2);
  });

  it('UNDEPLOY_SCRIPT frees the slot and its RAM, and stops the process', () => {
    const engine = schedulerEngine();
    const ramBefore = engine.getSnapshot().resources.ram.current;
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    advanceSec(engine, 3);
    const id = engine.getSnapshot().scheduler.deployments[0]!.id;
    const processedWhileDeployed = engine.getSnapshot().jobs.lifetimeProcessed;
    expect(processedWhileDeployed).toBeGreaterThan(0);

    expect(engine.dispatch({ type: 'UNDEPLOY_SCRIPT', id }).ok).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.scheduler.slotsUsed).toBe(0);
    expect(snap.resources.ram.current).toBe(ramBefore);
    expect(terminalText(engine)).toContain(STRINGS.undeployed);

    advanceSec(engine, 3);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(processedWhileDeployed);
  });

  it('RUN executes the top-level body only and says so', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'RUN_SCRIPT', source: `print(1)\n${AUTO_PROCESSOR}` });
    engine.tick(100);
    expect(terminalText(engine)).toContain(STRINGS.runIgnoresProcesses);
    expect(engine.getSnapshot().scheduler.slotsUsed).toBe(0);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(0);
  });
});

describe('scheduling semantics', () => {
  it('runs an `every` process on its interval', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 2 seconds {\n  process_job()\n}' });
    advanceSec(engine, 10);
    // Due immediately on deploy, then every 2 s: ticks 1, 21, 41, 61, 81 within 10 s.
    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.activations).toBe(5);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(5);
  });

  it('edge-triggers a `when` process: once per false→true transition', () => {
    // Guard is false at deploy, rises once, then holds true.
    const engine = schedulerEngine((run) => {
      run.jobs.waiting = 0;
      run.jobs.arrivalAccumulator = 0;
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'when stats.jobs_waiting > 3 {\n  print("queue building")\n}',
    });
    advanceSec(engine, 20);

    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    // The queue crosses the threshold once and stays above it: exactly one activation.
    expect(engine.getSnapshot().jobs.waiting).toBeGreaterThan(3);
    expect(process.activations).toBe(1);
    const prints = engine
      .getSnapshot()
      .terminal.filter((l) => l.text.includes('queue building')).length;
    expect(prints).toBe(1);
  });

  it('re-arms a `when` process after the condition falls again', () => {
    const engine = schedulerEngine((run) => {
      run.jobs.waiting = 10;
      run.jobs.arrivalAccumulator = 0;
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'when stats.jobs_waiting > 5 {\n  print("high")\n}',
    });
    advanceSec(engine, 1); // guard rises → 1 activation
    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(1);

    // Drain the queue below the threshold so the guard falls, then refill it.
    for (let i = 0; i < 8; i++) engine.dispatch({ type: 'EXECUTE_CLICK' });
    advanceSec(engine, 1);
    expect(engine.getSnapshot().jobs.waiting).toBeLessThanOrEqual(5);
    advanceSec(engine, 20);
    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(2);
  });

  it('draws compute fuel for `when` polling even when the guard never fires', () => {
    const engine = schedulerEngine((run) => {
      run.jobs.waiting = 0;
      run.jobs.arrivalAccumulator = 0;
      run.upgrades = {};
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'when stats.cash > 1000000 {\n  process_job()\n}',
    });
    const computeBefore = engine.getSnapshot().resources.compute.current;
    advanceSec(engine, 10);
    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.activations).toBe(0);
    expect(process.opsTotal).toBeGreaterThan(0);
    expect(engine.getSnapshot().resources.compute.current).toBeLessThan(computeBefore);
  });

  it('runs conditional automation: the acceptance script gates on a compute reserve', () => {
    const engine = schedulerEngine((run) => {
      run.resources.compute.current = 30;
    });
    const source =
      'every 1 seconds {\n  if stats.compute_available > 20 {\n    process_job()\n  }\n}';
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);

    // No clicks at all from here on — the process is the only actor.
    advanceSec(engine, 60);
    const snap = engine.getSnapshot();
    expect(snap.jobs.lifetimeProcessed).toBeGreaterThan(0);
    expect(engine.save(0).run.jobs.lifetimeClicks).toBe(0);
    expect(snap.resources.capital.current).toBeGreaterThan(500);
    // The reserve holds: the process never drained the buffer past its own guard.
    expect(snap.resources.compute.current).toBeGreaterThan(0);
  });

  it('the first deploy lands its narrative victory beat', () => {
    const engine = schedulerEngine();
    expect(engine.getSnapshot().research.some((r) => r.entryId === 'first-process')).toBe(false);
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    expect(engine.getSnapshot().research.some((r) => r.entryId === 'first-process')).toBe(true);
  });
});

describe('process monitor', () => {
  it('counts activations, ops, compute and in-game failures', () => {
    const engine = schedulerEngine();
    // The rental is far beyond the capital on hand, so every activation logs a failure.
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'every 1 seconds {\n  process_job()\n  buy_compute(1000000)\n}',
    });
    advanceSec(engine, 5);

    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.activations).toBe(5);
    expect(process.opsTotal).toBeGreaterThan(0);
    expect(process.computeTotal).toBeGreaterThan(0);
    expect(process.failures).toBe(5);
    expect(process.lastStatus).toBe('ok'); // an in-game failure is not an abort
    expect(process.aborts).toBe(0);
  });

  it('keeps scheduled failures out of the terminal but shows print output', () => {
    const engine = schedulerEngine((run) => {
      run.jobs.waiting = 0;
      run.jobs.arrivalAccumulator = 0;
      run.upgrades = {};
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'every 1 seconds {\n  print("tick")\n  process_job()\n}',
    });
    advanceSec(engine, 5);
    const text = terminalText(engine);
    expect(text).toContain(':: tick');
    expect(text).not.toContain('PROCESS_JOB REJECTED');
  });

  it('flags a process that exhausts its op budget', () => {
    const engine = schedulerEngine();
    const filler = Array.from({ length: 300 }, (_, i) => `  v${i} = ${i}`).join('\n');
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: `every 1 seconds {\n${filler}\n}` });
    advanceSec(engine, 2);
    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.lastStatus).toBe('budget');
    expect(process.aborts).toBeGreaterThan(0);
    // Preemption is bounded by the balance budget, so it can never freeze the frame.
    expect(process.opsTotal).toBeLessThanOrEqual(
      process.activations * BALANCE.ccl.maxOpsPerActivation,
    );
  });

  it('reports a runtime fault with its message', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  proces_job()\n}' });
    advanceSec(engine, 1);
    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.lastStatus).toBe('error');
    expect(process.lastError).toContain("Did you mean 'process_job'?");
  });
});

describe('persistence + determinism', () => {
  it('saves deployments as source and recompiles them on load (TDD §8)', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    advanceSec(engine, 2);
    const save = engine.save(0);
    expect(save.run.scheduler.deployments[0]!.source).toBe(AUTO_PROCESSOR);
    expect(JSON.stringify(save)).not.toContain('"kind":"call"'); // no ASTs in the save

    const restored = createGameEngine(1);
    restored.load(save);
    const before = restored.getSnapshot().jobs.lifetimeProcessed;
    advanceSec(restored, 3);
    expect(restored.getSnapshot().scheduler.slotsUsed).toBe(1);
    expect(restored.getSnapshot().jobs.lifetimeProcessed).toBeGreaterThan(before);
  });

  it('drops a deployment whose source no longer compiles, diegetically', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    const save = engine.save(0);
    save.run.scheduler.deployments[0]!.source = 'every 1 seconds {'; // corrupted archive

    const restored = createGameEngine(1);
    restored.load(save);
    expect(restored.getSnapshot().scheduler.deployments).toHaveLength(0);
    expect(terminalText(restored)).toContain(STRINGS.deploymentDropped);
  });

  it('two same-seed engines running the same deployment agree exactly', () => {
    const replay = (engine: GameEngine): void => {
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  if stats.jobs_waiting > 2 {\n    process_job()\n  }\n}',
      });
      advanceSec(engine, 30);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
      advanceSec(engine, 30);
    };
    const a = schedulerEngine();
    const b = schedulerEngine();
    replay(a);
    replay(b);
    expect(a.save(0)).toEqual(b.save(0));
  });
});

describe('offline safe mode (TDD §4.5)', () => {
  it('runs `every` processes a bounded number of times while away', () => {
    const engine = schedulerEngine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
    engine.advanceOffline(4 * 3_600_000); // 4 hours

    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.activations).toBeGreaterThan(0);
    expect(process.activations).toBeLessThanOrEqual(BALANCE.scheduler.offlineMaxActivations);
    expect(terminalText(engine)).toContain('PROCESS ACTIVATIONS');
  });

  it("leaves `when` guards for the player's return", () => {
    const engine = schedulerEngine();
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'when stats.jobs_waiting > 1 {\n  process_job()\n}',
    });
    engine.advanceOffline(4 * 3_600_000);
    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(0);
  });

  it('is deterministic across identical absences', () => {
    const build = (): GameEngine => {
      const engine = schedulerEngine();
      engine.dispatch({ type: 'DEPLOY_SCRIPT', source: AUTO_PROCESSOR });
      engine.advanceOffline(2 * 3_600_000);
      return engine;
    };
    expect(build().save(0)).toEqual(build().save(0));
  });
});

describe('tier unlock beats', () => {
  it('grants conditions and the scheduler at their balance thresholds', () => {
    const engine = createGameEngine(7);
    // The terminal keeps only a bounded tail, so collect the lines as they are emitted.
    const emitted: string[] = [];
    engine.subscribe((events) => {
      for (const event of events) {
        if (event.type === 'TERMINAL_LINE') emitted.push(event.line.text);
      }
    });
    for (let i = 0; i < 4000 && !engine.getSnapshot().scheduler.unlocked; i++) {
      engine.tick(1000);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }
    const snap = engine.getSnapshot();
    expect(snap.jobs.lifetimeProcessed).toBeGreaterThanOrEqual(BALANCE.ccl.schedulerUnlockAtJobs);
    expect(snap.ccl.constructs.conditions).toBe(true);
    expect(snap.ccl.constructs.scheduling).toBe(true);
    expect(emitted).toContain(STRINGS.conditionsGranted);
    expect(emitted).toContain(STRINGS.schedulerGranted);
    expect(snap.research.some((r) => r.entryId === 'conditional-grant')).toBe(true);
    expect(snap.research.some((r) => r.entryId === 'scheduler-grant')).toBe(true);
  });

  it('rejects `if` in a script before the tier is granted', () => {
    const engine = schedulerEngine((run) => {
      run.unlocks.conditions = false;
      run.unlocks.scheduler = false;
    });
    const result = engine.dispatch({
      type: 'RUN_SCRIPT',
      source: 'if stats.cash > 10 {\n  process_job()\n}',
    });
    expect(result.ok).toBe(false);
    expect(terminalText(engine)).toContain("Conditional rules ('if')");
  });
});
