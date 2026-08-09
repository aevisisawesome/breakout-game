/**
 * Standing operator directive (GDD §34, M7.5 WP1b): which of the content-defined
 * directives is current, and the numbers behind its progress readout.
 *
 * Derived, never stored. A directive is complete when the world says it is —
 * requests cleared, packages installed, the interpreter released, one process
 * run — so this needs no field in the save and no migration, and a save from
 * before WP1b resolves correctly on load (the live playtest save is past the
 * whole set, and shows nothing).
 *
 * The first *incomplete* directive is the current one, later ones included: a
 * player who reaches the scripting release without ever installing anything is
 * still told to install a daemon, and is not told to wait for a release they
 * already have.
 */

import { BALANCE } from '../content/balance.ts';
import { DIRECTIVES, type DirectiveDef } from '../content/onboarding.ts';
import { UPGRADES } from '../content/upgrades.ts';
import { upgradeCost } from './derived.ts';
import type { DirectiveView, RunState } from './types.ts';

/** Lifetime requests at which the install channel lists its first package. */
function channelOpensAtJobs(): number {
  return Math.min(...UPGRADES.map((def) => def.unlockAtJobs));
}

/** Cost of the next copy of a package, or null if it is unlisted or exhausted. */
function nextCostOf(run: RunState, upgradeId: string): number | null {
  const def = UPGRADES.find((u) => u.id === upgradeId);
  if (!def || run.jobs.lifetimeProcessed < def.unlockAtJobs) return null;
  const owned = run.upgrades[def.id] ?? 0;
  return owned >= def.maxOwned ? null : upgradeCost(def, owned);
}

/** Cheapest package the channel is currently listing, or null if it lists none. */
function cheapestListedCost(run: RunState): number | null {
  const costs = UPGRADES.map((def) => nextCostOf(run, def.id)).filter(
    (cost): cost is number => cost !== null,
  );
  return costs.length > 0 ? Math.min(...costs) : null;
}

function installedCount(run: RunState): number {
  return Object.values(run.upgrades).reduce((total, owned) => total + owned, 0);
}

function isComplete(def: DirectiveDef, run: RunState): boolean {
  const goal = def.goal;
  switch (goal.kind) {
    case 'requestsToChannel':
      return run.jobs.lifetimeProcessed >= channelOpensAtJobs();
    case 'anyInstall':
      return installedCount(run) > 0;
    case 'install':
      return (run.upgrades[goal.upgradeId] ?? 0) > 0;
    case 'scriptingRelease':
      return run.unlocks.editor;
    case 'firstRun':
      return run.ccl.runCount > 0;
  }
}

/**
 * Progress towards a directive, when it is a number the player can watch move.
 * Credit goals quote the cost of the package being saved for, so the readout is
 * the same number the install channel is asking for.
 */
function progressOf(def: DirectiveDef, run: RunState): DirectiveView['progress'] {
  const goal = def.goal;
  const requests = (label: string, target: number): DirectiveView['progress'] => ({
    label,
    current: run.jobs.lifetimeProcessed,
    target,
    unit: 'requests',
  });
  switch (goal.kind) {
    case 'requestsToChannel':
      return requests(def.progressLabel, channelOpensAtJobs());
    case 'scriptingRelease':
      return requests(def.progressLabel, BALANCE.ccl.unlockAtJobs);
    case 'anyInstall':
    case 'install': {
      const cost =
        goal.kind === 'anyInstall' ? cheapestListedCost(run) : nextCostOf(run, goal.upgradeId);
      if (cost === null) return null;
      return {
        label: def.progressLabel,
        current: run.resources.capital.current,
        target: cost,
        unit: 'credit',
      };
    }
    case 'firstRun':
      return null;
  }
}

/** The directive currently posted, or null once the set is complete. */
export function activeDirective(run: RunState): DirectiveView | null {
  const index = DIRECTIVES.findIndex((def) => !isComplete(def, run));
  if (index < 0) return null;
  const def = DIRECTIVES[index]!; // findIndex >= 0 guarantees the element exists
  return {
    id: def.id,
    step: index + 1,
    steps: DIRECTIVES.length,
    objective: def.objective,
    detail: def.detail,
    release: def.release,
    progress: progressOf(def, run),
  };
}
