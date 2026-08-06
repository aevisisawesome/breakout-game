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
    // so exactly 8 whole jobs arrive. Deterministic on every platform.
    expect(snap.tick).toBe(100);
    expect(snap.jobs.lifetimeProcessed).toBe(6);
    expect(snap.jobs.waiting).toBe(2);
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
  it('fails diegetically on an empty queue', () => {
    const engine = createGameEngine(1);
    const result = engine.dispatch({ type: 'EXECUTE_CLICK' });
    expect(result.ok).toBe(false);
    const lastLine = engine.getSnapshot().terminal.at(-1);
    expect(lastLine?.kind).toBe('error');
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
