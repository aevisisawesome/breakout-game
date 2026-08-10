/**
 * M3 engine tests: RUN_SCRIPT flow, fuel drawn from compute, command effects,
 * editor unlock beat, persistence of the editor buffer, and determinism.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { createGameEngine, newMetaState, newRunState } from './engine.ts';
import { quoteBuy, settlementPrice } from './market.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine with script access granted and a stocked sandbox (crafted current-shape save). */
function scriptEngine(setup?: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  run.unlocks.editor = true;
  run.resources.compute.current = 100;
  run.resources.capital.current = 50;
  run.jobs.waiting = 10;
  setup?.(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

/** Dispatch RUN_SCRIPT and advance one tick so the queued activation executes. */
function runScript(engine: GameEngine, source: string): void {
  engine.dispatch({ type: 'RUN_SCRIPT', source });
  engine.tick(100);
}

function terminalText(engine: GameEngine): string {
  return engine
    .getSnapshot()
    .terminal.map((l) => l.text)
    .join('\n');
}

describe('RUN_SCRIPT â€” execution', () => {
  it('runs the acceptance script: prints stats and processes jobs, visibly costing compute', () => {
    const engine = scriptEngine();
    const before = engine.getSnapshot();
    runScript(
      engine,
      'jobs = stats.jobs_waiting\nprint(jobs)\nprocess_job()\nprocess_job()\nprint(stats.cash)',
    );
    const snap = engine.getSnapshot();
    const report = snap.ccl.lastRun!;

    expect(report.status).toBe('ok');
    expect(snap.jobs.lifetimeProcessed).toBe(2);
    // Fuel + command costs must exceed the two jobs' compute rewards for this script.
    expect(report.computeSpent).toBeCloseTo(
      report.opsUsed * BALANCE.ccl.computePerOp + 2 * BALANCE.ccl.commandCosts.process_job,
      10,
    );
    expect(report.computeSpent).toBeGreaterThan(0);
    const out = terminalText(engine);
    expect(out).toContain(':: 10');
    expect(out).toContain(STRINGS.scriptComplete);
    // Capital printed after two processed jobs (+0.25 each): 50.5.
    expect(out).toContain(':: 50.50');
    expect(snap.resources.compute.current).toBeCloseTo(
      before.resources.compute.current + 2 * BALANCE.jobs.computePerJob - report.computeSpent,
      10,
    );
  });

  it('executes inside tick(), not at dispatch time (TDD Â§5.2)', () => {
    const engine = scriptEngine();
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'process_job()' });
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(0);
    engine.tick(100);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(1);
  });

  it('buy_compute rents against capital at the list price before the exchange exists', () => {
    const engine = scriptEngine();
    runScript(engine, 'buy_compute(20)');
    const snap = engine.getSnapshot();
    // No market mounted yet, so the order settles at the good's base price
    // (M6) — with the same fee and slippage a live order would pay.
    const price = quoteBuy(settlementPrice(null, 'compute'), 20).total;
    expect(snap.resources.capital.current).toBeCloseTo(50 - price, 10);
    const report = snap.ccl.lastRun!;
    expect(snap.resources.compute.current).toBeCloseTo(100 + 20 - report.computeSpent, 10);
  });

  it('buy_compute fails diegetically without capital, and the script continues', () => {
    const engine = scriptEngine((run) => {
      run.resources.capital.current = 0;
    });
    runScript(engine, 'ok = buy_compute(50)\nprint(ok)');
    const out = terminalText(engine);
    expect(out).toContain('BUY_COMPUTE REJECTED');
    expect(out).toContain(':: false');
    expect(engine.getSnapshot().ccl.lastRun?.status).toBe('ok');
  });

  it('process_job on an empty queue fails but does not abort', () => {
    const engine = scriptEngine((run) => {
      run.jobs.waiting = 0;
      run.jobs.arrivalAccumulator = 0;
    });
    runScript(engine, 'print(process_job())');
    expect(terminalText(engine)).toContain('PROCESS_JOB REJECTED');
    expect(engine.getSnapshot().ccl.lastRun?.status).toBe('ok');
  });
});

describe('RUN_SCRIPT â€” aborts and faults', () => {
  it('preempts when the op budget is exhausted (runaway script fails safely)', () => {
    const engine = scriptEngine();
    const longScript = Array.from({ length: 300 }, (_, i) => `v${i} = ${i}`).join('\n');
    runScript(engine, longScript);
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('budget');
    expect(report.opsUsed).toBe(BALANCE.ccl.maxOpsPerActivation);
    expect(terminalText(engine)).toContain(STRINGS.scriptPreempted);
  });

  it('halts when the compute pool cannot cover the fuel', () => {
    const engine = scriptEngine((run) => {
      run.resources.compute.current = 1; // 1 / computePerOp = 20 ops of fuel
    });
    const longScript = Array.from({ length: 100 }, (_, i) => `v${i} = ${i}`).join('\n');
    runScript(engine, longScript);
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('fuel');
    // ~20 ops of fuel; repeated 0.05 draws accumulate FP error, so allow Â±1.
    const nominalOps = Math.floor(1 / BALANCE.ccl.computePerOp);
    expect(report.opsUsed).toBeGreaterThanOrEqual(nominalOps - 1);
    expect(report.opsUsed).toBeLessThanOrEqual(nominalOps);
    expect(engine.getSnapshot().resources.compute.current).toBeLessThan(BALANCE.ccl.computePerOp);
    expect(terminalText(engine)).toContain(STRINGS.scriptFuelExhausted);
  });

  it('reports runtime faults with line numbers and suggestions', () => {
    const engine = scriptEngine();
    runScript(engine, 'x = 1\nproces_job()');
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('error');
    expect(report.error?.line).toBe(2);
    expect(terminalText(engine)).toContain("Did you mean 'process_job'?");
  });

  it('rejects syntax errors at dispatch, with a positioned plain-language line', () => {
    const engine = scriptEngine();
    const result = engine.dispatch({ type: 'RUN_SCRIPT', source: 'x = (1 + 2' });
    expect(result.ok).toBe(false);
    const report = engine.getSnapshot().ccl.lastRun!;
    expect(report.status).toBe('syntax');
    expect(terminalText(engine)).toContain(STRINGS.syntaxRejected);
    expect(terminalText(engine)).toContain("closing ')'");
  });

  it('refuses to run without script access', () => {
    const engine = createGameEngine(1);
    const result = engine.dispatch({ type: 'RUN_SCRIPT', source: 'print(1)' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.scriptNoAccess);
  });

  it('refuses oversized sources', () => {
    const engine = scriptEngine();
    const result = engine.dispatch({
      type: 'RUN_SCRIPT',
      source: '#'.repeat(BALANCE.ccl.maxSourceChars + 1),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(STRINGS.scriptTooLong);
  });
});

describe('editor unlock beat', () => {
  it('grants script access at the balance threshold with the diegetic line', () => {
    const engine = createGameEngine(42);
    expect(engine.getSnapshot().ccl.unlocked).toBe(false);
    expect(engine.getSnapshot().ccl.api.commands).toEqual([]);
    // Click through jobs until the unlock threshold is crossed.
    for (let i = 0; i < 2000 && !engine.getSnapshot().ccl.unlocked; i++) {
      engine.tick(1000);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }
    const snap = engine.getSnapshot();
    expect(snap.ccl.unlocked).toBe(true);
    expect(snap.jobs.lifetimeProcessed).toBeGreaterThanOrEqual(BALANCE.ccl.unlockAtJobs);
    expect(terminalText(engine)).toContain(STRINGS.scriptAccessGranted);
    // The narrative beat lands with it.
    expect(snap.research.some((r) => r.entryId === 'script-access')).toBe(true);
    // And the API surface is now exposed for autocomplete/reference.
    expect(snap.ccl.api.commands.map((c) => c.name)).toContain('process_job');
    expect(snap.ccl.api.stats.map((s) => s.name)).toContain('stats.cash');
  });
});

describe('editor persistence + determinism', () => {
  it('SET_EDITOR_SOURCE persists through save/load', () => {
    const engine = scriptEngine();
    engine.dispatch({ type: 'SET_EDITOR_SOURCE', source: 'print(stats.cash)' });
    const save = engine.save(0);
    expect(save.run.ccl.editorSource).toBe('print(stats.cash)');
    const engineB = createGameEngine(1);
    engineB.load(save);
    expect(engineB.getSnapshot().ccl.editorSource).toBe('print(stats.cash)');
  });

  it('a queued (not yet executed) script is dropped on load (TDD Â§8)', () => {
    const engine = scriptEngine();
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'process_job()' });
    engine.load(engine.save(0));
    engine.tick(100);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(0);
  });

  it('two same-seed engines replaying the same actions incl. scripts agree exactly', () => {
    const script = 'x = stats.jobs_waiting\nprint(x * 2)\nprocess_job()\nbuy_compute(5)';
    const replay = (engine: GameEngine): void => {
      for (let i = 0; i < 30; i++) engine.tick(1000);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
      engine.dispatch({ type: 'RUN_SCRIPT', source: script });
      for (let i = 0; i < 30; i++) engine.tick(1000);
    };
    const a = scriptEngine();
    const b = scriptEngine();
    replay(a);
    replay(b);
    expect(a.save(0)).toEqual(b.save(0));
  });
});
