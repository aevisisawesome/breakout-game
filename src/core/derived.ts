/**
 * Derived simulation stats (M2): effective rates and capacities computed from
 * owned upgrades + progress-stepped base curves. Pure functions — recomputed
 * per tick; nothing here is stored state.
 */

import { BALANCE, type ProgressStep } from '../content/balance.ts';
import { UPGRADES, type UpgradeDef } from '../content/upgrades.ts';

/** Value of a step curve at a given progress point (highest step whose atJobs <= progress). */
export function stepValue(steps: readonly ProgressStep[], progress: number): number {
  let value = steps[0]?.value ?? 0;
  for (const step of steps) {
    if (progress >= step.atJobs) value = step.value;
  }
  return value;
}

/** Capital cost of the next install given how many are already owned. */
export function upgradeCost(def: UpgradeDef, owned: number): number {
  return def.costBase * Math.pow(def.costGrowth, owned);
}

export interface DerivedStats {
  workerCount: number;
  /** Total daemon throughput, jobs/sec, before overclock/energy modifiers. */
  workerJobsPerSec: number;
  arrivalPerSec: number;
  batchPerClick: number;
  ramCapacityMb: number;
  ramUsedMb: number;
  energyRegenPerSec: number;
  /**
   * Energy drain per second while the daemons are working. Scales with daemon
   * throughput, not just daemon count (TDD §4.3: energy is consumed in
   * proportion to compute utilization), so buying throughput buys a power bill.
   */
  energyDrainPerSec: number;
  /** Scheduler slots available for deployed processes (M4, TDD §5.3). */
  schedulerSlots: number;
  /** Op-unit budget per script activation (M5, TDD §5.2 "upgradeable"). */
  maxOpsPerActivation: number;
  /** Largest `range(n)` the parser accepts (M5, GDD tier 6). */
  iterationLimit: number;
  /** Waiting-request queue depth (M6/OP-3: raised by REQUEST BUFFER EXPANSION). */
  queueCapacity: number;
  /** Energy reserve capacity (M6: raised by ENERGY BUFFER CELL). */
  energyCapacity: number;
  /** Passive heat dissipation coefficient (M7: raised by COOLANT LOOP EXPANSION). */
  coolingPerSec: number;
}

export function computeDerived(
  upgrades: Record<string, number>,
  lifetimeJobs: number,
): DerivedStats {
  let workerCount = 0;
  let batchAdd = 0;
  let arrivalMult = 1;
  let workerRateMult = 1;
  let ramCapAdd = 0;
  let regenAdd = 0;
  let ramUsed = 0;
  let slotAdd = 0;
  let opBudgetAdd = 0;
  let iterationMult = 1;
  let queueCapAdd = 0;
  let energyCapAdd = 0;
  let coolingAdd = 0;

  for (const def of UPGRADES) {
    const owned = upgrades[def.id] ?? 0;
    if (owned <= 0) continue;
    ramUsed += def.ramCostMb * owned;
    const effect = def.effect;
    switch (effect.kind) {
      case 'worker':
        workerCount += owned;
        break;
      case 'batchAdd':
        batchAdd += effect.amount * owned;
        break;
      case 'arrivalMult':
        arrivalMult *= Math.pow(effect.factor, owned);
        break;
      case 'workerRateMult':
        workerRateMult *= Math.pow(effect.factor, owned);
        break;
      case 'ramCapacityAdd':
        ramCapAdd += effect.mb * owned;
        break;
      case 'energyRegenAdd':
        regenAdd += effect.perSec * owned;
        break;
      case 'schedulerSlotAdd':
        slotAdd += effect.slots * owned;
        break;
      case 'opBudgetAdd':
        opBudgetAdd += effect.ops * owned;
        break;
      case 'iterationLimitMult':
        iterationMult *= Math.pow(effect.factor, owned);
        break;
      case 'queueCapacityAdd':
        queueCapAdd += effect.jobs * owned;
        break;
      case 'energyCapacityAdd':
        energyCapAdd += effect.units * owned;
        break;
      case 'coolingAdd':
        coolingAdd += effect.perSec * owned;
        break;
    }
  }

  const w = BALANCE.workers;
  return {
    workerCount,
    workerJobsPerSec: workerCount * w.jobsPerSec * workerRateMult,
    arrivalPerSec: stepValue(BALANCE.jobs.arrivalPerSec, lifetimeJobs) * arrivalMult,
    batchPerClick: stepValue(BALANCE.jobs.batchPerClick, lifetimeJobs) + batchAdd,
    ramCapacityMb: BALANCE.resources.ramCapacityMb + ramCapAdd,
    ramUsedMb: ramUsed,
    energyRegenPerSec: BALANCE.resources.energyRegenPerSec + regenAdd,
    energyDrainPerSec: workerCount * w.energyPerWorkerPerSec * workerRateMult,
    schedulerSlots: BALANCE.scheduler.baseSlots + slotAdd,
    maxOpsPerActivation: BALANCE.ccl.maxOpsPerActivation + opBudgetAdd,
    iterationLimit: Math.round(BALANCE.ccl.iterationLimitBase * iterationMult),
    queueCapacity: BALANCE.jobs.queueCapacity + queueCapAdd,
    energyCapacity: BALANCE.resources.energyCapacity + energyCapAdd,
    coolingPerSec: BALANCE.thermal.dissipationPerSec + coolingAdd,
  };
}
