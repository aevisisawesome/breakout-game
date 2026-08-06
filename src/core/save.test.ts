import { describe, expect, it } from 'vitest';

import { createGameEngine } from './engine.ts';
import { deserializeSave, serializeSave } from './save.ts';

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
    expect(savedB.run.resources).toEqual(savedA.run.resources);
    expect(savedB.run.jobs).toEqual(savedA.run.jobs);
    expect(savedB.run.rngState).toBe(savedA.run.rngState);
    expect(savedB.run.tick).toBe(savedA.run.tick);
  });

  it('rejects corrupt or foreign payloads', () => {
    expect(deserializeSave('not json at all')).toBeNull();
    expect(deserializeSave('{}')).toBeNull();
    expect(deserializeSave(JSON.stringify({ version: 99, savedAt: 0 }))).toBeNull();
    expect(deserializeSave(JSON.stringify({ version: 1, savedAt: 0, meta: {}, run: {} }))).toBeNull();
  });
});
