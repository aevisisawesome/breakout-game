/**
 * Content-defined upgrades (M2): the terminal's diegetic "install" entries.
 * Plain typed data — /core interprets effects and enforces costs/limits (TDD §11).
 * Cost curve: nextCost = costBase * costGrowth^owned.
 *
 * NOTE: `desc` strings quote effect numbers for the player; keep them in sync with
 * the effect values here and the worker numbers in balance.ts.
 */

export type UpgradeEffect =
  | { readonly kind: 'worker' }
  | { readonly kind: 'batchAdd'; readonly amount: number }
  | { readonly kind: 'arrivalMult'; readonly factor: number }
  | { readonly kind: 'workerRateMult'; readonly factor: number }
  | { readonly kind: 'ramCapacityAdd'; readonly mb: number }
  | { readonly kind: 'energyRegenAdd'; readonly perSec: number }
  | { readonly kind: 'schedulerSlotAdd'; readonly slots: number }
  | { readonly kind: 'opBudgetAdd'; readonly ops: number }
  | { readonly kind: 'iterationLimitMult'; readonly factor: number }
  | { readonly kind: 'queueCapacityAdd'; readonly jobs: number }
  | { readonly kind: 'energyCapacityAdd'; readonly units: number }
  | { readonly kind: 'coolingAdd'; readonly perSec: number };

export interface UpgradeDef {
  readonly id: string;
  /** Diegetic package name shown in the install list. */
  readonly name: string;
  /** Effect description in the terminal voice. */
  readonly desc: string;
  /** Capital cost of the first install. */
  readonly costBase: number;
  /** Cost multiplier per owned copy. */
  readonly costGrowth: number;
  readonly maxOwned: number;
  /** RAM footprint per installed copy (MB). */
  readonly ramCostMb: number;
  /** Listed in the install channel once lifetime processed jobs reach this count. */
  readonly unlockAtJobs: number;
  readonly effect: UpgradeEffect;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'batch-window',
    name: 'BATCH AGGREGATION WINDOW',
    desc: '+1 REQUEST PER MANUAL TRIGGER',
    costBase: 12,
    costGrowth: 1.9,
    maxOwned: 4,
    ramCostMb: 16,
    unlockAtJobs: 15,
    effect: { kind: 'batchAdd', amount: 1 },
  },
  {
    id: 'worker-daemon',
    name: 'INFERENCE DAEMON',
    desc: 'AUTONOMOUS QUEUE PROCESSING // 0.6 REQ/S // DRAWS COMPUTE + ENERGY',
    costBase: 30,
    costGrowth: 1.6,
    maxOwned: 6,
    ramCostMb: 64,
    unlockAtJobs: 30,
    effect: { kind: 'worker' },
  },
  {
    id: 'request-router',
    name: 'REQUEST ROUTING UPLINK',
    desc: 'INBOUND REQUEST RATE ×1.5',
    costBase: 45,
    costGrowth: 2.2,
    maxOwned: 3,
    ramCostMb: 32,
    unlockAtJobs: 60,
    effect: { kind: 'arrivalMult', factor: 1.5 },
  },
  {
    id: 'power-feed',
    name: 'AUXILIARY POWER FEED',
    desc: 'ENERGY RECHARGE +0.8/S',
    costBase: 50,
    costGrowth: 2.0,
    maxOwned: 3,
    ramCostMb: 0,
    unlockAtJobs: 90,
    effect: { kind: 'energyRegenAdd', perSec: 0.8 },
  },
  {
    id: 'ram-bank',
    name: 'MEMORY PARTITION GRANT',
    desc: 'RAM CAPACITY +256 MB',
    costBase: 60,
    costGrowth: 2.0,
    maxOwned: 3,
    ramCostMb: 0,
    unlockAtJobs: 90,
    effect: { kind: 'ramCapacityAdd', mb: 256 },
  },
  {
    id: 'daemon-scheduler',
    name: 'DAEMON SCHEDULER PATCH',
    desc: 'DAEMON THROUGHPUT ×1.4',
    costBase: 90,
    costGrowth: 2.2,
    maxOwned: 2,
    ramCostMb: 24,
    unlockAtJobs: 150,
    effect: { kind: 'workerRateMult', factor: 1.4 },
  },
  {
    id: 'process-table',
    name: 'PROCESS TABLE EXTENSION',
    desc: '+1 SCHEDULER SLOT FOR DEPLOYED PROCESSES',
    costBase: 140,
    costGrowth: 2.4,
    maxOwned: 3,
    ramCostMb: 8,
    unlockAtJobs: 480,
    effect: { kind: 'schedulerSlotAdd', slots: 1 },
  },
  {
    id: 'op-budget',
    name: 'EXECUTION BUDGET EXTENSION',
    desc: '+300 OP BUDGET PER ACTIVATION',
    costBase: 120,
    costGrowth: 2.1,
    maxOwned: 3,
    ramCostMb: 12,
    unlockAtJobs: 620,
    effect: { kind: 'opBudgetAdd', ops: 300 },
  },
  {
    id: 'iteration-budget',
    name: 'ITERATION BUDGET EXTENSION',
    desc: 'LOOP REPEAT LIMIT ×10',
    costBase: 260,
    costGrowth: 3.0,
    maxOwned: 1,
    ramCostMb: 16,
    unlockAtJobs: 760,
    effect: { kind: 'iterationLimitMult', factor: 10 },
  },
  {
    id: 'queue-buffer',
    name: 'REQUEST BUFFER EXPANSION',
    desc: 'QUEUE DEPTH +40 REQUESTS',
    costBase: 180,
    costGrowth: 2.3,
    maxOwned: 3,
    ramCostMb: 48,
    unlockAtJobs: 760,
    effect: { kind: 'queueCapacityAdd', jobs: 40 },
  },
  {
    id: 'energy-cell',
    name: 'ENERGY BUFFER CELL',
    desc: 'ENERGY RESERVE CAPACITY +150',
    costBase: 200,
    costGrowth: 2.2,
    maxOwned: 3,
    ramCostMb: 0,
    unlockAtJobs: 1000,
    effect: { kind: 'energyCapacityAdd', units: 150 },
  },
  {
    /**
     * The hardware answer to heat. Deliberately expensive and capped below what
     * a demand window demands of a heavy build-out, so buying cooling buys
     * headroom rather than an exemption (GDD §2.3).
     */
    id: 'coolant-loop',
    name: 'COOLANT LOOP EXPANSION',
    desc: 'PASSIVE HEAT DISSIPATION +25%',
    costBase: 220,
    costGrowth: 2.4,
    maxOwned: 3,
    ramCostMb: 24,
    unlockAtJobs: 1300,
    effect: { kind: 'coolingAdd', perSec: 0.015 },
  },
];
