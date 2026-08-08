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
    /**
     * Base queue depth; overflow requests are dropped upstream. Raised by
     * REQUEST BUFFER EXPANSION installs (OP-3: burst consumption at the loop
     * tier could otherwise never find more than the base depth waiting).
     */
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
    /**
     * Execution log + profiler unlock here (M5, GDD §6). Deliberately ahead of
     * loops: the tools to understand a wasteful loop must exist before loops do.
     */
    instrumentationUnlockAtJobs: 620,
    /** Limited `for` loops unlock here (M5, GDD tier 6). */
    loopsUnlockAtJobs: 760,
    /** Market terminal, trade commands and the `market.*` reads unlock here (M6, GDD §7). */
    marketUnlockAtJobs: 1000,
    /** Compute drawn per interpreter op-unit (TDD §5.2 fuel). */
    computePerOp: 0.05,
    /**
     * Energy drawn per interpreter op-unit (M6, TDD §4.3: energy is consumed in
     * proportion to compute utilization). Small enough that early scripts barely
     * notice, large enough that a tier-6 loop running every second outruns the
     * sandbox feed — which is what makes bought energy necessary.
     */
    energyPerOp: 0.002,
    /** Per-activation op-unit budget before EXECUTION BUDGET EXTENSION installs. */
    maxOpsPerActivation: 200,
    /** `for` repeat cap enforced at parse time, before ITERATION BUDGET installs (TDD §5.2). */
    iterationLimitBase: 10,
    /** Editor/script source size cap in characters (sanity guard, not RAM — M4). */
    maxSourceChars: 4000,
    /** Listed compute cost per command invocation, on top of op fuel (TDD §5.1 tier 2). */
    commandCosts: {
      process_job: 0.5,
      print: 0,
      buy_compute: 0,
      sell_compute: 0,
      buy_energy: 0,
      sell_energy: 0,
      'market.price': 0,
      /** Averaging walks the history ring buffer, so polling it is not free. */
      'market.average': 0.1,
    },
  },

  /** Market simulation (M6, TDD §6). Regime and cycle shapes live in /content/market.ts. */
  market: {
    /** One price sample is recorded every N ticks (10 ticks = 1 s at the 10 Hz timestep). */
    sampleTicks: 10,
    /** Price-history ring buffer length, in samples. Backs `market.average` and the chart. */
    historySamples: 300,
    /** Largest `n` accepted by `market.average(good, n)`. */
    maxAverageSamples: 300,
    /** Floor on the price factor, so a deep trough can never reach or cross zero. */
    minPriceFactor: 0.15,
    /** Flat transaction fee, as a fraction of trade value (TDD §6 friction). */
    fee: 0.02,
    /** Price impact per unit ordered, as a fraction. 100 units moves the price 8%. */
    slippagePerUnit: 0.0008,
    /** Cap on slippage, so a very large order cannot invert the price. */
    maxSlippage: 0.5,
    /** Largest single order; above this the call is a misuse, not a failed trade. */
    maxOrderUnits: 1000,
    /**
     * Sim seconds after the market unlocks at which the scripted regime shift
     * fires (TDD §6). GDD §7: the first algorithm "should work well for a
     * while" — long enough to be written, deployed, watched paying out and
     * believed in, so that the shift reads as the world changing rather than
     * as the script never having worked.
     */
    regimeShiftAtSec: 900,
    /**
     * Capital given back on the exchange since the shift before the "your
     * algorithm is losing" narrative beat fires. Measured from the shift, not
     * lifetime, so a profitable stable phase does not mask the drawdown.
     */
    lossBeatDrawdownCr: 60,
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

  /** Debugging surfaces (M5, TDD §5.4 / GDD §6). */
  telemetry: {
    /** Execution-log ring buffer size (entries kept, newest last). */
    logEntries: 120,
    /** Activations counted before a ratio-based diagnosis is offered at all. */
    minActivationsForDiagnosis: 3,
    /** Aborted share of activations above which the process is reported as failing. */
    abortRatioWarn: 0.2,
    /** Rejected share of command calls above which the process is reported as wasteful. */
    failureRatioWarn: 0.3,
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
