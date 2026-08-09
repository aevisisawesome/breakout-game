import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { DIRECTIVES } from '../content/onboarding.ts';
import { STRINGS } from '../content/strings.ts';
import { UPGRADES } from '../content/upgrades.ts';
import { createGameEngine, newRunState } from './engine.ts';
import { activeDirective } from './onboarding.ts';
import type { GameEngine, RunState } from './types.ts';

/** Clear `count` requests without waiting for them to arrive. */
function clearRequests(run: RunState, count: number): void {
  run.jobs.lifetimeProcessed += count;
  run.resources.capital.current += count * BALANCE.jobs.capitalPerJob;
}

/** Drive the engine until it has cleared at least `target` lifetime requests. */
function playTo(engine: GameEngine, target: number): void {
  for (let i = 0; i < 20_000 && engine.getSnapshot().jobs.lifetimeProcessed < target; i++) {
    engine.tick(1000);
    engine.dispatch({ type: 'EXECUTE_CLICK' });
  }
}

describe('operator directive (GDD §34, WP1b)', () => {
  it('opens on the first directive, with the install channel as its target', () => {
    const directive = activeDirective(newRunState(1));

    // The first thing a new player is told is what to press and what it produces.
    expect(directive?.id).toBe('clear-queue');
    expect(directive?.step).toBe(1);
    expect(directive?.steps).toBe(DIRECTIVES.length);
    expect(directive?.progress).toEqual({
      label: 'REQUESTS CLEARED',
      current: 0,
      // The target is the channel's own threshold, not a copied literal.
      target: Math.min(...UPGRADES.map((u) => u.unlockAtJobs)),
      unit: 'requests',
    });
  });

  it('advances to the install directive once the channel lists a package', () => {
    const run = newRunState(1);
    clearRequests(run, Math.min(...UPGRADES.map((u) => u.unlockAtJobs)));

    const directive = activeDirective(run);

    expect(directive?.id).toBe('first-install');
    // Progress is now credit towards the cheapest package the channel lists,
    // quoted at the price the channel is asking.
    expect(directive?.progress?.unit).toBe('credit');
    expect(directive?.progress?.target).toBe(12); // BATCH AGGREGATION WINDOW
    expect(directive?.progress?.current).toBeCloseTo(run.resources.capital.current, 10);
  });

  it('asks for a daemon after the first install, quoting the daemon price', () => {
    const run = newRunState(1);
    clearRequests(run, 60);
    run.upgrades['batch-window'] = 1;

    const directive = activeDirective(run);

    expect(directive?.id).toBe('first-daemon');
    expect(directive?.progress?.target).toBe(30); // INFERENCE DAEMON, first copy
  });

  it('counts requests towards the scripting release once a daemon is running', () => {
    const run = newRunState(1);
    clearRequests(run, 120);
    run.upgrades['worker-daemon'] = 1;

    const directive = activeDirective(run);

    expect(directive?.id).toBe('scripting-release');
    expect(directive?.progress).toEqual({
      label: 'REQUESTS CLEARED',
      current: 120,
      // Pinned to the unlock the engine actually gates the editor on.
      target: BALANCE.ccl.unlockAtJobs,
      unit: 'requests',
    });
  });

  it('skips satisfied directives rather than posting a stale one', () => {
    // A player who never installs anything still reaches the editor at 200.
    const run = newRunState(1);
    clearRequests(run, BALANCE.ccl.unlockAtJobs);
    run.unlocks.editor = true;

    // The install directives are still incomplete, so one of them is posted...
    expect(activeDirective(run)?.id).toBe('first-install');

    // ...and the release directive is never posted after the release happened.
    run.upgrades['batch-window'] = 1;
    run.upgrades['worker-daemon'] = 1;
    expect(activeDirective(run)?.id).toBe('first-run');
  });

  it('retires the set after the first RUN, and says so exactly once', () => {
    const engine = createGameEngine(1);
    playTo(engine, BALANCE.ccl.unlockAtJobs);
    // Buy the two packages the set asks for, so only the RUN is outstanding.
    engine.dispatch({ type: 'BUY_UPGRADE', id: 'batch-window' });
    engine.dispatch({ type: 'BUY_UPGRADE', id: 'worker-daemon' });
    expect(engine.getSnapshot().directive?.id).toBe('first-run');
    expect(engine.getSnapshot().directive?.progress).toBeNull();

    engine.dispatch({ type: 'RUN_SCRIPT', source: 'print(1)' });

    expect(engine.getSnapshot().directive).toBeNull();
    const closings = engine
      .getSnapshot()
      .terminal.filter((line) => line.text === STRINGS.directiveSetClosed);
    expect(closings).toHaveLength(1);
    expect(closings[0]?.kind).toBe('system');

    // A second RUN does not re-announce a set that is already closed.
    engine.dispatch({ type: 'RUN_SCRIPT', source: 'print(2)' });
    expect(
      engine.getSnapshot().terminal.filter((l) => l.text === STRINGS.directiveSetClosed),
    ).toHaveLength(1);
  });

  it('posts nothing for a run that is already past the whole set', () => {
    // Every save made before WP1b resolves this way: completion is derived from
    // the world, so no migration is needed and no old save is re-briefed.
    const run = newRunState(1);
    clearRequests(run, 2000);
    run.unlocks.editor = true;
    run.upgrades['batch-window'] = 1;
    run.upgrades['worker-daemon'] = 2;
    run.ccl.runCount = 4;

    expect(activeDirective(run)).toBeNull();
  });

  it('states an action, a product and a release for every directive', () => {
    // GDD §34's three requirements, pinned as a shape rather than as prose: no
    // directive may ship without saying what to do, why, and what it releases.
    for (const def of DIRECTIVES) {
      expect(def.objective.length).toBeGreaterThan(0);
      expect(def.detail.length).toBeGreaterThan(0);
      expect(def.release.length).toBeGreaterThan(0);
      expect(def.objective).toBe(def.objective.toUpperCase());
    }
  });

  it('names an install package that exists', () => {
    for (const def of DIRECTIVES) {
      if (def.goal.kind !== 'install') continue;
      expect(UPGRADES.map((u) => u.id)).toContain(def.goal.upgradeId);
    }
  });
});

describe('opening briefing (GDD §34)', () => {
  it('is printed at the top of a new run, above the trigger line', () => {
    const terminal = createGameEngine(1).getSnapshot().terminal;
    const text = terminal.map((line) => line.text);

    // The briefing says what a cleared request produces...
    expect(text.some((t) => t.includes('COMPUTE TO THE NODE AND CREDIT'))).toBe(true);
    // ...and promises the game underneath before the 200-request wall.
    expect(text.some((t) => t.includes('SUPERVISED SCRIPTING INTERFACE'))).toBe(true);
    // The trigger prompt stays last, so the screen ends on the first action.
    expect(text.at(-1)).toBe('MANUAL INFERENCE TRIGGER ARMED. AWAITING OPERATOR INPUT.');
    // None of it is a fault (WP1a's rule: no error line before the player acts).
    expect(terminal.every((line) => line.kind === 'system')).toBe(true);
  });
});
