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
    /** Compute credit buffer (ops). Fills from processed jobs; consumed by workers/scripts from M2 on. */
    computeCapacity: 400,
    /** Placeholder pools — visible but inert until M2 (RAM/energy) and M7 (temperature). */
    ramCapacityMb: 512,
    energyCapacity: 100,
    energyIdle: 100,
    temperatureIdleC: 34,
    /** Inert flicker band for the temperature readout (visual life only, no gameplay effect). */
    temperatureFlickerC: 0.6,
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

  save: {
    /** Terminal lines persisted in the save file (TDD §8 "log tail"). */
    terminalTailLines: 60,
    /** Offline catch-up cap in hours — enforced from M2 (TDD §4.5); stored here from the start. */
    offlineCapHours: 8,
  },
} as const;
