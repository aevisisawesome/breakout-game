/**
 * M7.5 WP5 (OP-22): the install channels are sectioned, and the section a
 * channel belongs to is content rather than something the panel infers.
 *
 * These pin the two properties the panel relies on. The first is that the
 * categories *partition* the catalogue — an upgrade whose category matched no
 * declared section would render in no section at all, i.e. silently disappear
 * from the list rather than fail loudly. The second is that the live/exhausted
 * split the panel draws is exactly the `nextCost === null` split the engine
 * publishes, so an exhausted channel is listed once, in the folded group.
 */

import { describe, expect, it } from 'vitest';

import { UPGRADE_CATEGORIES, UPGRADES } from '../content/upgrades.ts';
import { createGameEngine, newMetaState, newRunState } from './engine.ts';
import type { GameEngine, RunState } from './types.ts';

/** Engine with every install channel revealed (the thermal-tier list of 12). */
function revealedEngine(setup?: (run: RunState) => void): GameEngine {
  const run = newRunState(7);
  run.jobs.lifetimeProcessed = 5000;
  run.resources.capital.current = 10000;
  setup?.(run);
  const engine = createGameEngine(7);
  engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
  return engine;
}

describe('install channel categories', () => {
  it('assigns every upgrade to a declared category', () => {
    const declared = new Set<string>(UPGRADE_CATEGORIES.map((c) => c.id));
    for (const def of UPGRADES) {
      expect(declared.has(def.category), `${def.id} has an undeclared category`).toBe(true);
    }
  });

  it('declares no empty section', () => {
    for (const category of UPGRADE_CATEGORIES) {
      const members = UPGRADES.filter((def) => def.category === category.id);
      expect(members.length, `${category.id} lists nothing`).toBeGreaterThan(0);
    }
  });

  it('partitions the revealed channels: each one renders in exactly one section', () => {
    const snapshot = revealedEngine().getSnapshot();
    expect(snapshot.upgrades).toHaveLength(UPGRADES.length);

    const sectioned = UPGRADE_CATEGORIES.flatMap((category) =>
      snapshot.upgrades.filter((u) => u.category === category.id).map((u) => u.id),
    );
    expect(sectioned.slice().sort()).toEqual(snapshot.upgrades.map((u) => u.id).sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it('publishes the content category on the view', () => {
    const snapshot = revealedEngine().getSnapshot();
    for (const def of UPGRADES) {
      const view = snapshot.upgrades.find((u) => u.id === def.id);
      expect(view?.category).toBe(def.category);
    }
  });

  it('splits live from exhausted on nextCost, with no channel in both', () => {
    // ITERATION BUDGET EXTENSION is the one maxOwned: 1 channel, so one install
    // exhausts it.
    const engine = revealedEngine((run) => {
      run.upgrades['iteration-budget'] = 1;
    });
    const { upgrades } = engine.getSnapshot();
    const live = upgrades.filter((u) => u.nextCost !== null);
    const exhausted = upgrades.filter((u) => u.nextCost === null);

    expect(exhausted.map((u) => u.id)).toEqual(['iteration-budget']);
    expect(exhausted[0]!.owned).toBe(exhausted[0]!.maxOwned);
    expect(live).toHaveLength(UPGRADES.length - 1);
    expect(live.some((u) => u.id === 'iteration-budget')).toBe(false);
  });
});
