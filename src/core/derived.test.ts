import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { UPGRADES } from '../content/upgrades.ts';
import { computeDerived, stepValue, upgradeCost } from './derived.ts';

const def = (id: string) => {
  const found = UPGRADES.find((u) => u.id === id);
  if (!found) throw new Error(`missing upgrade def: ${id}`);
  return found;
};

describe('upgradeCost', () => {
  it('follows the geometric cost curve', () => {
    const daemon = def('worker-daemon');
    expect(upgradeCost(daemon, 0)).toBe(daemon.costBase);
    expect(upgradeCost(daemon, 1)).toBeCloseTo(daemon.costBase * daemon.costGrowth, 10);
    expect(upgradeCost(daemon, 3)).toBeCloseTo(daemon.costBase * daemon.costGrowth ** 3, 10);
  });
});

describe('computeDerived', () => {
  it('returns base curves with no upgrades', () => {
    const d = computeDerived({}, 0);
    expect(d.workerCount).toBe(0);
    expect(d.workerJobsPerSec).toBe(0);
    expect(d.arrivalPerSec).toBe(stepValue(BALANCE.jobs.arrivalPerSec, 0));
    expect(d.batchPerClick).toBe(stepValue(BALANCE.jobs.batchPerClick, 0));
    expect(d.ramCapacityMb).toBe(BALANCE.resources.ramCapacityMb);
    expect(d.ramUsedMb).toBe(0);
    expect(d.energyRegenPerSec).toBe(BALANCE.resources.energyRegenPerSec);
    expect(d.energyDrainPerSec).toBe(0);
  });

  it('aggregates upgrade effects multiplicatively/additively per kind', () => {
    const d = computeDerived(
      {
        'worker-daemon': 2,
        'daemon-scheduler': 1,
        'request-router': 2,
        'batch-window': 3,
        'ram-bank': 1,
        'power-feed': 2,
      },
      0,
    );
    expect(d.workerCount).toBe(2);
    expect(d.workerJobsPerSec).toBeCloseTo(2 * BALANCE.workers.jobsPerSec * 1.4, 10);
    expect(d.arrivalPerSec).toBeCloseTo(stepValue(BALANCE.jobs.arrivalPerSec, 0) * 1.5 ** 2, 10);
    expect(d.batchPerClick).toBe(stepValue(BALANCE.jobs.batchPerClick, 0) + 3);
    expect(d.ramCapacityMb).toBe(BALANCE.resources.ramCapacityMb + 256);
    expect(d.ramUsedMb).toBe(
      2 * def('worker-daemon').ramCostMb +
        def('daemon-scheduler').ramCostMb +
        2 * def('request-router').ramCostMb +
        3 * def('batch-window').ramCostMb,
    );
    expect(d.energyRegenPerSec).toBeCloseTo(BALANCE.resources.energyRegenPerSec + 1.6, 10);
    // Drain tracks throughput, not head-count (M6, TDD §4.3), so the daemon
    // scheduler patch's ×1.4 shows up in the power bill too.
    expect(d.energyDrainPerSec).toBeCloseTo(2 * BALANCE.workers.energyPerWorkerPerSec * 1.4, 10);
  });

  it('steps base curves by lifetime jobs', () => {
    const d = computeDerived({}, 1_000);
    expect(d.arrivalPerSec).toBe(6.0);
    expect(d.batchPerClick).toBe(8);
  });
});
