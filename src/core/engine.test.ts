import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { MAX_TICKS_PER_ADVANCE, createGameEngine, stepValue } from './engine.ts';
import type { GameEngine } from './types.ts';

/** Replay a fixed script: 10 s of sim time (in 1 s advances), then 6 EXECUTE clicks. */
function replayReferenceScript(engine: GameEngine): void {
  for (let i = 0; i < 10; i++) {
    engine.tick(1000);
  }
  for (let i = 0; i < 6; i++) {
    engine.dispatch({ type: 'EXECUTE_CLICK' });
  }
}

describe('GameEngine — deterministic scenario (seed 42)', () => {
  it('replays the reference click sequence to exact values', () => {
    const engine = createGameEngine(42);
    replayReferenceScript(engine);

    const snap = engine.getSnapshot();
    // 10 s at 0.9 jobs/s: 100 additions of 0.09 sum to fractionally under 9 (IEEE 754),
    // so exactly 8 whole jobs arrive. Deterministic on every platform. The run
    // also opens with `initialQueued` already waiting (WP1a).
    expect(snap.tick).toBe(100);
    expect(snap.jobs.lifetimeProcessed).toBe(6);
    expect(snap.jobs.waiting).toBe(BALANCE.jobs.initialQueued + 8 - 6);
    expect(snap.resources.compute.current).toBe(6);
    expect(snap.resources.capital.current).toBeCloseTo(1.5, 10);
    expect(snap.unlocks.capitalReadout).toBe(true);
    expect(snap.unlocks.systemReadouts).toBe(false); // unlocks at 10 lifetime jobs
    // First narrative entry (1 job) is unlocked, second (20 jobs) is not.
    expect(snap.research.map((r) => r.entryId)).toEqual(['boot-observation']);
  });

  it('two engines with the same seed and script agree exactly (incl. PRNG state)', () => {
    const a = createGameEngine(42);
    const b = createGameEngine(42);
    replayReferenceScript(a);
    replayReferenceScript(b);
    expect(a.save(0)).toEqual(b.save(0));
  });

  it('different seeds diverge in PRNG-driven state', () => {
    const a = createGameEngine(1);
    const b = createGameEngine(2);
    a.tick(1000);
    b.tick(1000);
    expect(a.save(0).run.rngState).not.toBe(b.save(0).run.rngState);
  });
});

describe('GameEngine — fixed timestep', () => {
  it('accumulates sub-tick time across calls', () => {
    const engine = createGameEngine(1);
    engine.tick(50);
    expect(engine.getSnapshot().tick).toBe(0);
    engine.tick(50);
    expect(engine.getSnapshot().tick).toBe(1);
  });

  it('caps catch-up ticks per advance and drops the excess', () => {
    const engine = createGameEngine(1);
    engine.tick(100_000); // 1000 nominal ticks
    expect(engine.getSnapshot().tick).toBe(MAX_TICKS_PER_ADVANCE);
    engine.tick(100); // accumulator was reset, not left holding dropped time
    expect(engine.getSnapshot().tick).toBe(MAX_TICKS_PER_ADVANCE + 1);
  });
});

describe('GameEngine — EXECUTE click', () => {
  // WP1a / OP-15: the queue used to start empty and fill at 0.9/s, so a press in
  // the first second answered with an error before the player had ever seen the
  // trigger work. A run now opens with requests already waiting.
  it('processes on the very first press of a fresh run', () => {
    const engine = createGameEngine(1);
    expect(engine.getSnapshot().jobs.waiting).toBe(BALANCE.jobs.initialQueued);

    const result = engine.dispatch({ type: 'EXECUTE_CLICK' });

    expect(result.ok).toBe(true);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBe(1);
    // The press answers with a processed batch, not a fault. (The line after it
    // is the first narrative intercept, which the same first job unlocks.)
    const kinds = engine.getSnapshot().terminal.map((line) => line.kind);
    expect(kinds).toContain('result');
    expect(kinds).not.toContain('error');
  });

  it('answers an empty queue with the wait, in the system voice, not a fault', () => {
    const engine = createGameEngine(1);
    for (let i = 0; i < BALANCE.jobs.initialQueued; i++) {
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }

    const result = engine.dispatch({ type: 'EXECUTE_CLICK' });

    expect(result.ok).toBe(false);
    const lastLine = engine.getSnapshot().terminal.at(-1);
    expect(lastLine?.kind).toBe('system');
    // The message states when the next request lands, at the current rate.
    expect(lastLine?.text).toBe(
      `NO REQUESTS QUEUED // NEXT INBOUND IN ${(1 / BALANCE.jobs.arrivalPerSec[0]!.value).toFixed(1)}S`,
    );
  });

  it('reports inbound progress that agrees with the countdown', () => {
    const engine = createGameEngine(1);
    engine.tick(500); // half a second of arrivals

    const jobs = engine.getSnapshot().jobs;
    const rate = BALANCE.jobs.arrivalPerSec[0]!.value;
    expect(jobs.arrivalPerSec).toBeCloseTo(rate, 10);
    expect(jobs.arrivalProgress).toBeCloseTo(0.45, 10);
    expect(jobs.secondsToNextArrival).toBeCloseTo((1 - 0.45) / rate, 10);
  });

  it('caps compute at capacity and keeps capital uncapped', () => {
    const engine = createGameEngine(1);
    // Drive far past compute capacity.
    for (let i = 0; i < 4000; i++) {
      engine.tick(1000);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }
    const snap = engine.getSnapshot();
    expect(snap.resources.compute.current).toBeLessThanOrEqual(snap.resources.compute.capacity);
    expect(snap.resources.capital.current).toBeGreaterThan(snap.resources.compute.capacity / 2);
  });

  it('batch size grows with lifetime progress (accelerating feedback)', () => {
    const engine = createGameEngine(1);
    expect(engine.getSnapshot().jobs.batchPerClick).toBe(1);
    for (let i = 0; i < 60; i++) {
      engine.tick(2000);
      engine.dispatch({ type: 'EXECUTE_CLICK' });
    }
    const snap = engine.getSnapshot();
    expect(snap.jobs.lifetimeProcessed).toBeGreaterThanOrEqual(25);
    expect(snap.jobs.batchPerClick).toBeGreaterThan(1);
  });
});

describe('stepValue', () => {
  it('returns the highest step at or below progress', () => {
    const steps = BALANCE.jobs.batchPerClick;
    expect(stepValue(steps, 0)).toBe(1);
    expect(stepValue(steps, 24)).toBe(1);
    expect(stepValue(steps, 25)).toBe(2);
    expect(stepValue(steps, 10_000)).toBe(8);
  });
});
