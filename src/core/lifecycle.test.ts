/**
 * M7.5 WP4b — process lifecycle (OP-12, OP-13, OP-14). A deployed process can be
 * designated, pulled back into the editor and replaced in place, and held without
 * losing the counters that are the reason for holding it.
 */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { STRINGS } from '../content/strings.ts';
import { createGameEngine, newMetaState, newRunState, TICKS_PER_SEC } from './engine.ts';
import { sanitizeProcessLabel } from './scheduler.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine with the scheduling and instrumentation tiers up and a stocked sandbox. */
function lifecycleEngine(setup?: (run: RunState) => void, seed = 42): GameEngine {
  const run = newRunState(seed);
  run.unlocks.editor = true;
  run.unlocks.conditions = true;
  run.unlocks.scheduler = true;
  run.unlocks.instrumentation = true;
  run.resources.compute.current = 400;
  run.resources.capital.current = 500;
  run.jobs.waiting = 50;
  setup?.(run);
  const engine = createGameEngine(seed);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

function terminalText(engine: GameEngine): string {
  return engine
    .getSnapshot()
    .terminal.map((l) => l.text)
    .join('\n');
}

function advanceSec(engine: GameEngine, seconds: number): void {
  for (let i = 0; i < seconds * TICKS_PER_SEC; i++) engine.tick(100);
}

const AUTO_PROCESSOR = 'every 1 seconds {\n  process_job()\n}';

function deploy(engine: GameEngine, source = AUTO_PROCESSOR): string {
  expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
  const deployments = engine.getSnapshot().scheduler.deployments;
  return deployments[deployments.length - 1]!.id;
}

describe('process designation (OP-12)', () => {
  it('normalizes operator input into the system voice rather than refusing it', () => {
    expect(sanitizeProcessLabel('coolant guard')).toBe('COOLANT GUARD');
    expect(sanitizeProcessLabel('  buyer!!  ')).toBe('BUYER');
    expect(sanitizeProcessLabel('a\tb\nc')).toBe('A B C');
    expect(sanitizeProcessLabel('trend-filter')).toBe('TREND-FILTER');
    // Nothing usable left, which is also how a designation is cleared.
    expect(sanitizeProcessLabel('   ')).toBeNull();
    expect(sanitizeProcessLabel('***')).toBeNull();
    // Cut to the published ceiling, and never left ending on the cut's whitespace.
    const long = sanitizeProcessLabel('X'.repeat(200));
    expect(long).toHaveLength(BALANCE.scheduler.processLabelMaxChars);
  });

  it('sets and clears a designation without disturbing the ordinal', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    const ordinal = engine.getSnapshot().scheduler.deployments[0]!.name;

    expect(engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'coolant guard' }).ok).toBe(
      true,
    );
    let deployment = engine.getSnapshot().scheduler.deployments[0]!;
    expect(deployment.label).toBe('COOLANT GUARD');
    expect(deployment.name).toBe(ordinal);
    expect(terminalText(engine)).toContain(`${STRINGS.renamed} // ${ordinal} // COOLANT GUARD`);

    expect(engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: null }).ok).toBe(true);
    deployment = engine.getSnapshot().scheduler.deployments[0]!;
    expect(deployment.label).toBeNull();
    expect(deployment.name).toBe(ordinal);
  });

  it('rejects input that normalizes to nothing instead of silently clearing', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'KEEPER' });

    const result = engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: '***' });
    expect(result.ok).toBe(false);
    expect(engine.getSnapshot().scheduler.deployments[0]!.label).toBe('KEEPER');
    expect(terminalText(engine)).toContain(STRINGS.renameRejected);
  });

  it('leaves the execution log keyed on the ordinal, so a rename cannot rewrite history', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    advanceSec(engine, 2);
    engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'DRAIN' });
    advanceSec(engine, 2);

    const log = engine.getSnapshot().telemetry.log.filter((e) => e.kind === 'process');
    expect(log.length).toBeGreaterThan(1);
    expect(new Set(log.map((e) => e.process))).toEqual(new Set(['PROC-01']));
  });
});

describe('hold and resume (OP-14)', () => {
  it('stops activations while keeping the slot, the RAM and every counter', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    advanceSec(engine, 3);
    const before = engine.getSnapshot();
    const ram = before.resources.ram.current;
    const activations = before.scheduler.deployments[0]!.processes[0]!.activations;
    expect(activations).toBeGreaterThan(0);

    expect(engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: true }).ok).toBe(true);
    advanceSec(engine, 5);

    const held = engine.getSnapshot();
    expect(held.scheduler.deployments[0]!.paused).toBe(true);
    expect(held.scheduler.deployments[0]!.processes[0]!.activations).toBe(activations);
    expect(held.scheduler.slotsUsed).toBe(1);
    expect(held.resources.ram.current).toBe(ram);
    // The cost half survives too — a process is held so its evidence can be read.
    expect(held.telemetry.profile[0]!.activations).toBe(activations);
    expect(terminalText(engine)).toContain(STRINGS.processHeld);

    expect(engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: false }).ok).toBe(true);
    advanceSec(engine, 3);
    expect(
      engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations,
    ).toBeGreaterThan(activations);
    expect(terminalText(engine)).toContain(STRINGS.processResumed);
  });

  it('re-arms a `when` guard on resume, so a condition that stood true fires again', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine, 'when stats.jobs_waiting > 5 {\n  process_job()\n}');
    advanceSec(engine, 2);
    const fired = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations;
    expect(fired).toBe(1); // edge-triggered: one crossing, one activation

    engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: true });
    advanceSec(engine, 2);
    engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: false });
    advanceSec(engine, 2);

    // The queue never emptied, so without re-arming the guard would stay latched
    // and this process would never run again (OP-14's second decision).
    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(
      fired + 1,
    );
  });

  it('does not run held processes during an offline catch-up', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: true });
    const before = engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations;

    engine.advanceOffline(120_000);

    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(before);
  });
});

describe('revise and redeploy (OP-13)', () => {
  it('pulls the source back into the editor and marks the revision target', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'DRAIN' });
    engine.dispatch({ type: 'SET_EDITOR_SOURCE', source: 'print(1)' });

    expect(engine.dispatch({ type: 'REVISE_DEPLOYMENT', id }).ok).toBe(true);
    const ccl = engine.getSnapshot().ccl;
    expect(ccl.editorSource).toBe(AUTO_PROCESSOR);
    expect(ccl.revising).toEqual({ id, name: 'PROC-01', label: 'DRAIN' });
    expect(terminalText(engine)).toContain(STRINGS.reviseLoaded);
  });

  it('replaces the resident process in place, keeping ordinal and designation', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'DRAIN' });
    advanceSec(engine, 3);
    expect(
      engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations,
    ).toBeGreaterThan(0);

    const revised = 'every 2 seconds {\n  process_job()\n  process_job()\n}';
    expect(engine.dispatch({ type: 'REDEPLOY_SCRIPT', id, source: revised }).ok).toBe(true);

    const snap = engine.getSnapshot();
    expect(snap.scheduler.deployments).toHaveLength(1);
    expect(snap.scheduler.slotsUsed).toBe(1);
    const deployment = snap.scheduler.deployments[0]!;
    expect(deployment.id).toBe(id);
    expect(deployment.name).toBe('PROC-01');
    expect(deployment.label).toBe('DRAIN');
    expect(deployment.source).toBe(revised);
    expect(deployment.processes[0]!.label).toBe('every 2 seconds');
    // Counters describe the code that ran; a rewrite starts them over, and says so.
    expect(deployment.processes[0]!.activations).toBe(0);
    expect(snap.ccl.revising).toBeNull();
    expect(terminalText(engine)).toContain(STRINGS.redeployCommitted);
    expect(terminalText(engine)).toContain(STRINGS.redeployCountersReset);

    advanceSec(engine, 3);
    expect(
      engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations,
    ).toBeGreaterThan(0);
  });

  it('is not refused by the slot its own predecessor is holding', () => {
    // One base slot, occupied. A plain DEPLOY of a second process is refused;
    // the same source as a REDEPLOY of the resident one is admitted.
    const engine = lifecycleEngine();
    const id = deploy(engine);
    expect(engine.getSnapshot().scheduler.slotsTotal).toBe(BALANCE.scheduler.baseSlots);

    const other = 'every 3 seconds {\n  process_job()\n}';
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source: other }).ok).toBe(false);
    expect(terminalText(engine)).toContain(STRINGS.deployNoSlots);

    expect(engine.dispatch({ type: 'REDEPLOY_SCRIPT', id, source: other }).ok).toBe(true);
    expect(engine.getSnapshot().scheduler.deployments[0]!.processes[0]!.label).toBe(
      'every 3 seconds',
    );
  });

  it('changes nothing when the revision does not compile', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    advanceSec(engine, 2);
    const before = engine.getSnapshot().scheduler.deployments[0]!;

    expect(engine.dispatch({ type: 'REDEPLOY_SCRIPT', id, source: 'every {' }).ok).toBe(false);

    const after = engine.getSnapshot().scheduler.deployments[0]!;
    expect(after.source).toBe(before.source);
    expect(after.processes[0]!.activations).toBe(before.processes[0]!.activations);
  });

  it('drops the revision link when its target is terminated', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'REVISE_DEPLOYMENT', id });
    expect(engine.getSnapshot().ccl.revising).not.toBeNull();

    engine.dispatch({ type: 'UNDEPLOY_SCRIPT', id });
    const snap = engine.getSnapshot();
    expect(snap.ccl.revising).toBeNull();
    // The buffer is the player's text and stays put; only the link goes.
    expect(snap.ccl.editorSource).toBe(AUTO_PROCESSOR);
    expect(engine.dispatch({ type: 'REDEPLOY_SCRIPT', id, source: AUTO_PROCESSOR }).ok).toBe(false);
    expect(terminalText(engine)).toContain(STRINGS.redeployUnknown);
  });
});

describe('lifecycle state survives a save round-trip', () => {
  it('carries the designation, the hold and the revision link through save/load', () => {
    const engine = lifecycleEngine();
    const id = deploy(engine);
    engine.dispatch({ type: 'RENAME_DEPLOYMENT', id, label: 'DRAIN' });
    engine.dispatch({ type: 'SET_DEPLOYMENT_PAUSED', id, paused: true });
    engine.dispatch({ type: 'REVISE_DEPLOYMENT', id });

    const save = engine.save(0);
    expect(save.version).toBe(8);
    const reloaded = createGameEngine(1);
    reloaded.load(save);

    const snap = reloaded.getSnapshot();
    expect(snap.scheduler.deployments[0]!.label).toBe('DRAIN');
    expect(snap.scheduler.deployments[0]!.paused).toBe(true);
    expect(snap.ccl.revising?.id).toBe(id);

    // Still held after the reload — the flag is state, not a UI mode.
    const before = snap.scheduler.deployments[0]!.processes[0]!.activations;
    advanceSec(reloaded, 4);
    expect(reloaded.getSnapshot().scheduler.deployments[0]!.processes[0]!.activations).toBe(before);
  });
});
