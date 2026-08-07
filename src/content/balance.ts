/**
 * All tunable balance numbers for the prototype live in this file (TDD §11).
 * /core converts per-second rates to per-tick values; nothing here is logic.
 */

/** A step curve keyed by lifetime jobs processed: the highest `atJobs` <= progress applies. */
export interface ProgressStep {
  readonly atJobs: number;
  readonly value: number;
}

export const BALANCE = {
  resources: {
    /** Compute credit buffer (ops). Fills from processed jobs; consumed by daemon overhead (M2+). */
    computeCapacity: 400,
    /** Base RAM capacity; installs consume footprints, memory grants raise it (M2). */
    ramCapacityMb: 512,
    energyCapacity: 100,
    energyIdle: 100,
    /** Sandbox power feed: baseline energy recharge per second (M2). */
    energyRegenPerSec: 1.2,
    /** Temperature is a placeholder pool — visible but inert until M7. */
    temperatureIdleC: 34,
    /** Inert flicker band for the temperature readout (visual life only, no gameplay effect). */
    temperatureFlickerC: 0.6,
  },

  workers: {
    /** Jobs processed per second per inference daemon. */
    jobsPerSec: 0.6,
    /** Compute drawn from the buffer per daemon-processed job (net vs. computePerJob stays positive). */
    computeOverheadPerJob: 0.4,
    /** Energy drain per daemon per second while actively working (scales with the throughput multiplier). */
    energyPerWorkerPerSec: 0.5,
    /** Daemon throughput multiplier while the energy pool is exhausted. */
    energyThrottledFactor: 0.25,
    /** Click overclock: each EXECUTE extends a capped buff that multiplies daemon throughput. */
    overclock: {
      secPerClick: 1.5,
      maxSec: 12,
      multiplier: 2,
    },
  },

  jobs: {
    /** Inference requests entering the queue, per second, stepped by lifetime jobs processed. */
    arrivalPerSec: [
      { atJobs: 0, value: 0.9 },
      { atJobs: 40, value: 1.6 },
      { atJobs: 120, value: 2.6 },
      { atJobs: 300, value: 4.0 },
      { atJobs: 700, value: 6.0 },
    ] as readonly ProgressStep[],
    /** Jobs processed per EXECUTE click ("batch size"), stepped by lifetime jobs processed. */
    batchPerClick: [
      { atJobs: 0, value: 1 },
      { atJobs: 25, value: 2 },
      { atJobs: 75, value: 3 },
      { atJobs: 150, value: 4 },
      { atJobs: 300, value: 6 },
      { atJobs: 600, value: 8 },
    ] as readonly ProgressStep[],
    /** Queue holds at most this many waiting jobs; overflow requests are dropped upstream. */
    queueCapacity: 60,
    /** Reward per processed job. */
    computePerJob: 1,
    capitalPerJob: 0.25,
  },

  ccl: {
    /** Scripting interface (M3) unlocks at this lifetime processed-job count. */
    unlockAtJobs: 200,
    /** Conditional rules (`if`/`else`, `and`/`or`/`not`) unlock here (M4, GDD tier 3). */
    conditionsUnlockAtJobs: 320,
    /** Scheduled processes (`every`/`when`) + DEPLOY unlock here (M4, GDD tier 4). */
    schedulerUnlockAtJobs: 480,
    /** Compute drawn per interpreter op-unit (TDD §5.2 fuel). */
    computePerOp: 0.05,
    /** Per-activation op-unit budget; exceeding it preempts the process. */
    maxOpsPerActivation: 200,
    /** Editor/script source size cap in characters (sanity guard, not RAM — M4). */
    maxSourceChars: 4000,
    /** buy_compute(n): capital price per rented compute unit. */
    computePricePerUnit: 0.2,
    /** Listed compute cost per command invocation, on top of op fuel (TDD §5.1 tier 2). */
    commandCosts: {
      process_job: 0.5,
      print: 0,
      buy_compute: 0,
    },
  },

  /** Scheduler (M4, TDD §5.3): slots, polling cadence, script RAM pricing. */
  scheduler: {
    /** Slots available before any PROCESS TABLE EXTENSION installs. */
    baseSlots: 1,
    /**
     * `when` guards are sampled every N ticks rather than every tick. Polling is
     * fuel-metered, so the cadence sets the standing compute cost of a condition.
     */
    whenPollTicks: 5,
    /** Shortest `every` interval accepted at deploy time, in ticks. */
    minIntervalTicks: 5,
    /** RAM footprint of a deployed script: a fixed base plus a per-AST-node charge. */
    scriptRamBaseMb: 6,
    scriptRamPerNodeMb: 0.5,
    /** Offline safe mode (TDD §4.5): activations per `every` process per catch-up chunk. */
    offlineMaxActivationsPerChunk: 20,
    /** Offline safe mode: total scheduled activations across one catch-up. */
    offlineMaxActivations: 400,
  },

  save: {
    /** Terminal lines persisted in the save file (TDD §8 "log tail"). */
    terminalTailLines: 60,
    /** Offline catch-up cap in hours (TDD §4.5). */
    offlineCapHours: 8,
    /** Offline catch-up advances in coarse chunks of this many seconds (TDD §4.5). */
    offlineChunkSec: 60,
    /** Absences shorter than this are ignored (quick refreshes are not "offline"). */
    offlineMinSec: 60,
  },
} as const;
