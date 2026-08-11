/**
 * M5 engine tests: the iteration limit as a progression gate, the upgradeable op
 * budget, the execution-log ring buffer, profiler aggregates, plain-language
 * failure reports (GDD §6), and the runaway-loop safety guarantee.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { computeDerived } from './derived.ts';
import { diagnose } from './diagnostics.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import { serializeSave, deserializeSave } from './save.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine with every tier through M5 unlocked and a stocked sandbox. */
function m5Engine(setup?: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.unlocks.instrumentation = true;
  run.unlocks.loops = true;
  run.resources.compute.current = 300;
  run.resources.capital.current = 500;
  run.jobs.waiting = 50;
  setup?.(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

function runScript(engine: GameEngine, source: string): void {
  engine.dispatch({ type: 'RUN_SCRIPT', source });
  engine.tick(100);
}

function advanceSec(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SEC; i++) engine.tick(100);
}

function terminalText(engine: GameEngine): string {
  return engine
    .getSnapshot()
    .terminal.map((l) => l.text)
    .join('\n');
}

describe('iteration limit', () => {
  it('is the content base until an ITERATION BUDGET EXTENSION is installed', () => {
    const engine = m5Engine();
    expect(engine.getSnapshot().ccl.iterationLimit).toBe(BALANCE.ccl.iterationLimitBase);
    const raised = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
    });
    expect(raised.getSnapshot().ccl.iterationLimit).toBe(100);
  });

  it('rejects an over-long loop before it runs, and accepts it once raised', () => {
    const engine = m5Engine();
    const source = 'for i in range(50) {\n  process_job()\n}';
    runScript(engine, source);
    expect(engine.getSnapshot().ccl.lastRun!.status).toBe('syntax');
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(0);
    expect(terminalText(engine)).toContain(STRINGS.syntaxRejected);

    const raised = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
    });
    runScript(raised, source);
    expect(raised.getSnapshot().ccl.lastRun!.status).toBe('ok');
    expect(raised.getSnapshot().jobs.lifetimeProcessed).toBe(50);
  });
});

describe('op budget', () => {
  it('rises with EXECUTION BUDGET EXTENSION installs and is what the interpreter enforces', () => {
    const base = m5Engine();
    expect(base.getSnapshot().ccl.maxOpsPerActivation).toBe(BALANCE.ccl.maxOpsPerActivation);

    // 100 repeats × (loop step + statement + call) + the loop node itself = 301 ops.
    const source = 'for i in range(100) {\n  process_job()\n}';
    const starved = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
      run.jobs.waiting = 200;
    });
    runScript(starved, source);
    expect(starved.getSnapshot().ccl.lastRun!.status).toBe('budget');

    const funded = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
      run.upgrades['op-budget'] = 1;
      run.jobs.waiting = 200;
      run.resources.compute.current = 400;
    });
    expect(funded.getSnapshot().ccl.maxOpsPerActivation).toBe(
      BALANCE.ccl.maxOpsPerActivation + 300,
    );
    runScript(funded, source);
    expect(funded.getSnapshot().ccl.lastRun!.status).toBe('ok');
    expect(funded.getSnapshot().ccl.lastRun!.opsUsed).toBe(301);
  });
});

describe('runaway loop safety', () => {
  it('drains fuel, aborts, logs cleanly and never runs beyond one tick', () => {
    const engine = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
      run.jobs.waiting = 500;
      run.resources.compute.current = 300;
    });
    const before = engine.getSnapshot();
    runScript(engine, 'for i in range(100) {\n  process_job()\n}');
    const after = engine.getSnapshot();

    // One tick advanced, one activation happened, and it stopped on its budget.
    expect(after.tick).toBe(before.tick + 1);
    expect(after.ccl.lastRun!.status).toBe('budget');
    expect(after.ccl.lastRun!.opsUsed).toBe(BALANCE.ccl.maxOpsPerActivation);
    expect(after.jobs.lifetimeProcessed).toBeLessThan(100);
    expect(after.jobs.lifetimeProcessed).toBeGreaterThan(0);
    expect(terminalText(engine)).toContain(STRINGS.scriptPreempted);

    // And the abort is a single, readable log line — not a flood.
    const log = after.telemetry.log;
    expect(log).toHaveLength(1);
    expect(log[0]!.status).toBe('budget');
    expect(log[0]!.label).toBe(STRINGS.runLogLabel);
  });

  it('leaves a deployed runaway loop bounded per activation, tick after tick', () => {
    const engine = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
      run.jobs.waiting = 500;
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'every 1 seconds {\n  for i in range(100) {\n    process_job()\n  }\n}',
    });
    advanceSec(engine, 5);

    const process = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!;
    expect(process.activations).toBeGreaterThan(0);
    // Every activation is capped, so total ops can never exceed budget × activations.
    expect(process.opsTotal).toBeLessThanOrEqual(
      process.activations * BALANCE.ccl.maxOpsPerActivation,
    );
    expect(process.aborts).toBe(process.activations);
  });
});

describe('execution log', () => {
  it('records RUN activations and scheduled activations with their costs', () => {
    const engine = m5Engine();
    runScript(engine, 'process_job()');
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 2);

    const log = engine.getSnapshot().telemetry.log;
    // Oldest first, matching the terminal it now shares a panel with (M7.6 WP1).
    expect(log[0]!.tick).toBeLessThanOrEqual(log[log.length - 1]!.tick);
    expect(log[0]!.id).toBeLessThan(log[log.length - 1]!.id);
    const manual = log.filter((e) => e.kind === 'run');
    const scheduled = log.filter((e) => e.kind === 'process');
    expect(manual).toHaveLength(1);
    expect(manual[0]!.commandCalls).toBe(1);
    expect(manual[0]!.computeSpent).toBeGreaterThan(0);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled[0]!.process).toBe('PROC-01');
    expect(scheduled[0]!.label).toBe('every 1 seconds');
  });

  it('counts rejected commands without flooding: one entry per activation', () => {
    const engine = m5Engine((run) => {
      run.jobs.waiting = 0;
    });
    runScript(engine, 'process_job()\nprocess_job()\nprocess_job()');
    const log = engine.getSnapshot().telemetry.log;
    expect(log).toHaveLength(1);
    expect(log[0]!.commandCalls).toBe(3);
    expect(log[0]!.commandFailures).toBe(3);
    expect(log[0]!.status).toBe('ok');
  });

  it('keeps only the newest entries once the ring buffer is full', () => {
    const engine = m5Engine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 0.5 seconds {\n  print(1)\n}' });
    advanceSec(engine, 90);
    const log = engine.getSnapshot().telemetry.log;
    expect(log).toHaveLength(BALANCE.telemetry.logEntries);
    // Ids are monotonic and the view is oldest-first, so the retained window is
    // a contiguous run ending at the newest entry written.
    expect(log[log.length - 1]!.id).toBeGreaterThan(log[0]!.id);
    expect(log[log.length - 1]!.id - log[0]!.id).toBe(BALANCE.telemetry.logEntries - 1);
  });

  it('survives a save/load round trip', () => {
    const engine = m5Engine();
    runScript(engine, 'print(stats.cash)');
    const restored = deserializeSave(serializeSave(engine.save(0)))!;
    const engineB = createGameEngine(1);
    engineB.load(restored);
    expect(engineB.getSnapshot().telemetry.log).toHaveLength(1);
  });
});

describe('profiler', () => {
  it('aggregates per process and attributes compute share against all script spend', () => {
    const engine = m5Engine();
    runScript(engine, 'print(stats.cash)');
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 3);

    const telemetry = engine.getSnapshot().telemetry;
    expect(telemetry.profile.length).toBe(2); // one process + the manual-run row
    const process = telemetry.profile.find((p) => p.name === 'PROC-01')!;
    const manual = telemetry.profile.find((p) => p.name === STRINGS.runLogLabel)!;

    expect(process.activations).toBeGreaterThan(0);
    expect(process.avgOps).toBeCloseTo(process.opsTotal / process.activations, 10);
    expect(manual.activations).toBe(1);
    // Shares are a partition of the script compute total.
    const shareSum = telemetry.profile.reduce((n, p) => n + p.computeShare, 0);
    expect(shareSum).toBeCloseTo(1, 10);
    expect(telemetry.scriptComputeTotal).toBeCloseTo(
      process.computeTotal + manual.computeTotal,
      10,
    );
  });

  it('reports a preempted process in plain language, naming the budget', () => {
    const engine = m5Engine((run) => {
      run.upgrades['iteration-budget'] = 1;
      run.jobs.waiting = 500;
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'every 1 seconds {\n  for i in range(100) {\n    process_job()\n  }\n}',
    });
    advanceSec(engine, 6);

    const entry = engine.getSnapshot().telemetry.profile[0]!;
    expect(entry.diagnosis).not.toBeNull();
    expect(entry.diagnosis!.headline).toBe('PREEMPTED');
    expect(entry.diagnosis!.finding).toContain(`${BALANCE.ccl.maxOpsPerActivation}-op`);
    expect(entry.diagnosis!.suggestion.length).toBeGreaterThan(0);
    // The count the player reads must be the activations that happened, not a
    // total inflated by counting each abort twice.
    expect(entry.aborts).toBe(entry.activations);
    expect(entry.diagnosis!.finding).toContain(
      `${entry.aborts} of ${entry.activations} activations`,
    );
  });

  it('reports a process whose commands are mostly rejected', () => {
    const engine = m5Engine((run) => {
      run.jobs.waiting = 0;
      run.upgrades['request-router'] = 0;
    });
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 5);

    const entry = engine.getSnapshot().telemetry.profile[0]!;
    expect(entry.failures).toBeGreaterThan(0);
    expect(entry.diagnosis!.headline).toBe('WASTEFUL');
  });

  it('says nothing about a healthy process', () => {
    const engine = m5Engine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 4);
    expect(engine.getSnapshot().telemetry.profile[0]!.diagnosis).toBeNull();
  });

  it('flags a guard that has never once fired', () => {
    const input = {
      kind: 'when' as const,
      activations: 0,
      samples: 40,
      computeTotal: 12,
      calls: 0,
      failures: 0,
      abortsBudget: 0,
      abortsFuel: 0,
      abortsFault: 0,
      lastError: null,
      lastErrorLine: null,
      opBudget: 200,
    };
    expect(diagnose(input)!.headline).toBe('IDLE');
    // A guard that has fired is not idle.
    expect(diagnose({ ...input, activations: 1 })).toBeNull();
  });

  it('prefers the fault report when a process is stopping on an error', () => {
    const report = diagnose({
      kind: 'every',
      activations: 0,
      samples: 0,
      computeTotal: 3,
      calls: 0,
      failures: 0,
      abortsBudget: 2,
      abortsFuel: 0,
      abortsFault: 4,
      lastError: "'cashh' is not known here.",
      lastErrorLine: 2,
      opBudget: 200,
    })!;
    expect(report.headline).toBe('FAULTED');
    expect(report.finding).toContain("'cashh' is not known here.");
    expect(report.finding).toContain('line 2');
  });
});

/**
 * M7.5 WP4a (OP-25): the scheduler view and the profile are rendered as one row
 * per process, so the join between them has to be total and the two halves have
 * to agree on the fields they both carry.
 */
describe('process table join', () => {
  it('gives every deployed process exactly one profile row, and they agree', () => {
    const engine = m5Engine((run) => {
      run.upgrades['process-table'] = 2; // 3 slots, for a three-row table
      run.resources.ram.capacity = 512;
    });
    engine.dispatch({
      type: 'DEPLOY_SCRIPT',
      source: 'every 1 seconds {\n  process_job()\n}\nwhen stats.cash > 0 {\n  process_job()\n}',
    });
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 2 seconds {\n  process_job()\n}' });
    advanceSec(engine, 4);

    const { scheduler, telemetry } = engine.getSnapshot();
    const processes = scheduler.deployments.flatMap((d) => d.processes);
    expect(processes).toHaveLength(3);

    const byKey = new Map(telemetry.profile.map((entry) => [entry.key, entry]));
    expect(new Set(processes.map((p) => p.profileKey)).size).toBe(processes.length);
    for (const process of processes) {
      const entry = byKey.get(process.profileKey);
      expect(entry, `no profile row for ${process.profileKey}`).toBeDefined();
      // The five fields OP-25 found duplicated across the two old panels.
      expect(entry!.activations).toBe(process.activations);
      expect(entry!.opsTotal).toBe(process.opsTotal);
      expect(entry!.computeTotal).toBeCloseTo(process.computeTotal, 10);
      expect(entry!.failures).toBe(process.failures);
      expect(entry!.aborts).toBe(process.aborts);
      expect(entry!.label).toBe(process.label);
    }
  });

  it('leaves exactly one profile row unclaimed by a slot — the manual aggregate', () => {
    const engine = m5Engine();
    runScript(engine, 'print(stats.cash)');
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 2);

    const { scheduler, telemetry } = engine.getSnapshot();
    const deployed = new Set(
      scheduler.deployments.flatMap((d) => d.processes.map((p) => p.profileKey)),
    );
    const unscheduled = telemetry.profile.filter((entry) => !deployed.has(entry.key));
    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0]!.name).toBe(STRINGS.runLogLabel);
  });

  it('drops a terminated process out of both halves together', () => {
    const engine = m5Engine();
    engine.dispatch({ type: 'DEPLOY_SCRIPT', source: 'every 1 seconds {\n  process_job()\n}' });
    advanceSec(engine, 2);
    const id = engine.getSnapshot().scheduler.deployments[0]!.id;
    engine.dispatch({ type: 'UNDEPLOY_SCRIPT', id });

    const { scheduler, telemetry } = engine.getSnapshot();
    expect(scheduler.deployments).toHaveLength(0);
    expect(telemetry.profile.filter((entry) => entry.key.startsWith(id))).toHaveLength(0);
  });
});

describe('M5 unlocks', () => {
  it('grants instrumentation before loops, each with its diegetic line', () => {
    const engine = m5Engine((run) => {
      run.unlocks.instrumentation = false;
      run.unlocks.loops = false;
      run.jobs.lifetimeProcessed = BALANCE.ccl.instrumentationUnlockAtJobs - 1;
      run.jobs.waiting = 400;
      run.upgrades['worker-daemon'] = 4;
    });
    expect(engine.getSnapshot().telemetry.unlocked).toBe(false);

    advanceSec(engine, 3);
    expect(engine.getSnapshot().telemetry.unlocked).toBe(true);
    expect(engine.getSnapshot().ccl.constructs.loops).toBe(false);
    expect(terminalText(engine)).toContain(STRINGS.instrumentationGranted);

    advanceSec(engine, 120);
    expect(engine.getSnapshot().ccl.constructs.loops).toBe(true);
    expect(terminalText(engine)).toContain(STRINGS.loopsGranted);
  });

  it('keeps `for` locked in the engine until the tier is granted', () => {
    const engine = m5Engine((run) => {
      run.unlocks.loops = false;
    });
    runScript(engine, 'for i in range(3) {\n  process_job()\n}');
    expect(engine.getSnapshot().ccl.lastRun!.status).toBe('syntax');
    expect(engine.getSnapshot().ccl.lastRun!.error!.message).toContain("Loops ('for')");
  });
});

describe('determinism', () => {
  it('replays a loop-driven deployment to identical state from the same seed', () => {
    const build = (): GameEngine => {
      const engine = m5Engine((run) => {
        run.upgrades['worker-daemon'] = 2;
        run.upgrades['iteration-budget'] = 1;
      });
      engine.dispatch({
        type: 'DEPLOY_SCRIPT',
        source: 'every 1 seconds {\n  for i in range(4) {\n    process_job()\n  }\n}',
      });
      advanceSec(engine, 30);
      return engine;
    };
    const a = build().getSnapshot();
    const b = build().getSnapshot();
    expect(a.jobs.lifetimeProcessed).toBe(b.jobs.lifetimeProcessed);
    expect(a.resources.capital.current).toBe(b.resources.capital.current);
    expect(a.telemetry.profile[0]!.opsTotal).toBe(b.telemetry.profile[0]!.opsTotal);
    expect(a.telemetry.log.length).toBe(b.telemetry.log.length);
  });
});

describe('derived stats', () => {
  it('keeps the loop and budget upgrades out of /core as content-defined effects', () => {
    const none = computeDerived({}, 0);
    const both = computeDerived({ 'op-budget': 2, 'iteration-budget': 1 }, 0);
    expect(none.maxOpsPerActivation).toBe(BALANCE.ccl.maxOpsPerActivation);
    expect(none.iterationLimit).toBe(BALANCE.ccl.iterationLimitBase);
    expect(both.maxOpsPerActivation).toBe(BALANCE.ccl.maxOpsPerActivation + 600);
    expect(both.iterationLimit).toBe(BALANCE.ccl.iterationLimitBase * 10);
  });
});
