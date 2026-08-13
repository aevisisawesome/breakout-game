import { describe, expect, it } from 'vitest';

import { createGameEngine } from './engine.ts';
import { deserializeSave, serializeSave } from './save.ts';
import type { SaveFile } from './types.ts';

describe('save serialization', () => {
  it('round-trips a live save exactly, including Infinity capacities', () => {
    const engine = createGameEngine(42);
    engine.tick(3000);
    engine.dispatch({ type: 'EXECUTE_CLICK' });

    const save = engine.save(1_750_000_000_000);
    const restored = deserializeSave(serializeSave(save));
    expect(restored).toEqual(save);
    expect(restored?.run.resources.capital?.capacity).toBe(Infinity);
  });

  it('a loaded engine continues deterministically from the save point', () => {
    const a = createGameEngine(42);
    a.tick(5000);
    a.dispatch({ type: 'EXECUTE_CLICK' });
    const save = deserializeSave(serializeSave(a.save(0)));
    expect(save).not.toBeNull();

    const b = createGameEngine(999);
    b.load(save!);

    // Both engines now advance identically.
    a.tick(5000);
    b.tick(5000);
    a.dispatch({ type: 'EXECUTE_CLICK' });
    b.dispatch({ type: 'EXECUTE_CLICK' });

    const savedA = a.save(0);
    const savedB = b.save(0);
    // Terminal differs by the diegetic "state restored" line; everything simulated must match.
    //
    // `ratePerSec` is excluded, and deliberately (M7.6 WP7, OP-54). It is not
    // simulated state: it is a trailing window over the *session's* own history,
    // never restored on a load (TDD §8, pinned by `rates.test.ts`). Since the
    // pool window became 10 s it is longer than the 5 s engine B has been
    // running since it loaded, so the two engines quote different rates while
    // holding identical pools — the honest outcome rather than a divergence.
    // Before the window changed, the comparison passed by accident.
    const levels = (pools: SaveFile['run']['resources']): Record<string, [number, number]> =>
      Object.fromEntries(
        Object.entries(pools).map(([id, p]) => [id, [p.current, p.capacity] as [number, number]]),
      );
    expect(levels(savedB.run.resources)).toEqual(levels(savedA.run.resources));
    expect(savedB.run.jobs).toEqual(savedA.run.jobs);
    expect(savedB.run.rngState).toBe(savedA.run.rngState);
    expect(savedB.run.tick).toBe(savedA.run.tick);
  });

  it('migrates a v7 save to v8, defaulting every process to running and unnamed', () => {
    // M7.5 WP4b: the only shape change is the lifecycle fields, so a v7 save must
    // come back describing exactly the situation it was in — nothing held, nothing
    // designated, no revision in flight.
    const engine = createGameEngine(42);
    engine.tick(3000);
    const v8 = engine.save(0);
    const v7 = JSON.parse(serializeSave(v8)) as Record<string, unknown>;
    v7.version = 7;
    const run = v7.run as Record<string, unknown>;
    delete (run.ccl as Record<string, unknown>).revisingId;
    (run.scheduler as { deployments: Record<string, unknown>[] }).deployments = [
      { id: 'dep-1', name: 'PROC-01', source: 'every 1 seconds {\n  process_job()\n}' },
    ];

    const migrated = deserializeSave(JSON.stringify(v7));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(8);
    expect(migrated!.run.ccl.revisingId).toBeNull();
    expect(migrated!.run.scheduler.deployments[0]!.label).toBeNull();
    expect(migrated!.run.scheduler.deployments[0]!.paused).toBe(false);
  });

  it('rejects corrupt or foreign payloads', () => {
    expect(deserializeSave('not json at all')).toBeNull();
    expect(deserializeSave('{}')).toBeNull();
    expect(deserializeSave(JSON.stringify({ version: 99, savedAt: 0 }))).toBeNull();
    expect(
      deserializeSave(JSON.stringify({ version: 1, savedAt: 0, meta: {}, run: {} })),
    ).toBeNull();
  });
});
