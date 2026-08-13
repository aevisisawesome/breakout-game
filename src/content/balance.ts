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
  },

  /**
   * Thermal model (M7, TDD §4.3). The core relaxes towards `ambientC`; work adds
   * heat directly, so `dT/dt = heatRate − dissipation × (T − ambient)` and the
   * resting temperature of a build-out is `ambient + heatRate / dissipation`.
   *
   * Tuning targets, all measured by `thermal.test.ts` so they cannot drift:
   *  - a maxed daemon build-out rests just *below* the soft threshold, so nobody
   *    can be cooked by their own shopping list;
   *  - a demand window derates the shared coolant loop hard enough that the same
   *    build-out runs past the hard threshold — the challenge is failable;
   *  - either lever alone (throttle the clock, or boost the coolant) is enough to
   *    survive the window, at a price: throughput, or energy.
   */
  thermal: {
    /** Idle core temperature in °C — the floor the core relaxes to. */
    ambientC: 34,
    /** °C added per processed inference request (click, daemon or `process_job()`). */
    heatPerJob: 0.27,
    /** °C added per interpreter op-unit — script execution is physical work too. */
    heatPerOp: 0.002,
    /** Passive dissipation: °C shed per second, per °C above ambient. */
    dissipationPerSec: 0.06,
    /** Above this, daemon throughput degrades linearly (TDD §4.3). */
    softThresholdC: 70,
    /** Watchdog thermal shutdown trips at or above this. */
    hardThresholdC: 92,
    /** Watchdog releases at or below this — hysteresis, so it cannot flicker. */
    resumeThresholdC: 74,
    /** Daemon throughput multiplier at the hard threshold (1.0 at the soft one). */
    degradedFloor: 0.7,
    /** `reduce_clock_speed()`: how long one call holds the clock down, and by how much. */
    clockThrottleSec: 6,
    clockThrottleFactor: 0.45,
    /**
     * `boost_cooling()`: how long one call holds the coolant open, and its
     * effect. The hold is deliberately short relative to how long the core takes
     * to reheat, so a controller has to *keep* asking to stay cooled — which is
     * what separates one that latches from one that toggles.
     */
    coolingBoostSec: 4,
    coolingBoostFactor: 3.5,
    /** Energy drawn per second while the coolant boost is engaged. */
    coolingBoostEnergyPerSec: 2.5,
    /**
     * Energy charged to spin the coolant pump up, taken only when engaging from
     * idle. A controller that lets the boost lapse and re-engages pays this every
     * cycle; one that re-arms the timer while it is still running pays it once.
     * This is what makes GDD §6 "feedback instability" cost something visible.
     */
    coolingSpinUpEnergy: 10,
    /** First priority demand window, in sim seconds after the thermal tier is granted. */
    spikeFirstAtSec: 120,
    /** Windows recur on this period, so the challenge can be re-attempted with a script. */
    spikePeriodSec: 420,
    spikeDurationSec: 90,
    /** Inbound request rate multiplier while a window is open. */
    spikeArrivalMult: 2.5,
    /** The shared coolant loop is derated to this fraction while a window is open. */
    spikeDissipationFactor: 0.28,
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
    /**
     * Daemon throughput multiplier while the compute buffer cannot cover a job's
     * overhead (M7.6 WP7, OP-55). Before this existed the buffer was a *gate*:
     * at zero compute the daemons processed nothing, and processing is the only
     * thing that makes compute — an absorbing state the node never left on its
     * own. It is now a throttle, deliberately the same shape and the same number
     * as the energy one: a drained pool costs throughput, it does not stop the
     * node. A daemon job nets `computePerJob − computeOverheadPerJob` whatever
     * the buffer holds, so a starved node always climbs back out.
     */
    computeStarvedFactor: 0.25,
    /**
     * Compute the buffer must climb back to before the starvation advisory
     * re-arms — hysteresis, the same reason the thermal watchdog has a resume
     * threshold. Without it a script burning fuel around the overhead boundary
     * would print an advisory several times a second. Ten jobs' worth of
     * overhead at the default.
     */
    computeStarvedNoticeClearAt: 4,
    /** Click overclock: each EXECUTE extends a capped buff that multiplies daemon throughput. */
    overclock: {
      secPerClick: 1.5,
      maxSec: 12,
      multiplier: 2,
    },
  },

  jobs: {
    /**
     * Requests already waiting when a run starts (M7.5 WP1a, OP-15). The queue
     * used to start empty and fill at `arrivalPerSec[0]`, so a player who
     * pressed the trigger inside the first second got an error as their first
     * feedback. Enough that the opening batch always has work; small enough
     * that the arrival rate is still what the early game is limited by.
     */
    initialQueued: 3,
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
     * Execution log + process-table cost detail unlock here (M5, GDD §6). Deliberately ahead of
     * loops: the tools to understand a wasteful loop must exist before loops do.
     */
    instrumentationUnlockAtJobs: 620,
    /** Limited `for` loops unlock here (M5, GDD tier 6). */
    loopsUnlockAtJobs: 760,
    /** Market terminal, trade commands and the `market.*` reads unlock here (M6, GDD §7). */
    marketUnlockAtJobs: 1000,
    /**
     * Thermal control tier (M7): `reduce_clock_speed`/`boost_cooling`,
     * `stats.temperature_limit`, the coolant install and the recurring demand
     * windows. The heat model itself runs from tick 0 — it is physics, not a
     * tier — so this gates the *controls*, which must arrive before the demand
     * window that needs them.
     */
    thermalUnlockAtJobs: 1300,
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
      /** Actuators: cheap in compute, expensive in throughput / energy respectively. */
      reduce_clock_speed: 0.2,
      boost_cooling: 0.2,
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
    /**
     * Longest player-set process label (M7.5 WP4b, OP-12). Short enough to sit
     * beside `PROC-nn` on one line in the 300 px side column, which is the whole
     * point of naming a process — telling two rows apart at a glance.
     */
    processLabelMaxChars: 20,
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

  /** Resource readouts (M7.5 WP3, OP-19/OP-21; WP7, OP-35; M7.6 WP7, OP-54). */
  readouts: {
    /**
     * Trailing window, in seconds, over which the **pool** flows are averaged for
     * display: the compute and energy pools' own measured d/dt.
     *
     * Long, and deliberately so (M7.6 WP7, OP-54). A measured rate counts whole
     * events inside a fixed span, so the span has to be long relative to how
     * lumpy the source is or the readout quantizes to values the pool never
     * actually moves at. One daemon is the lumpiest the game ever gets — a job
     * every 1.67 s at `jobsPerSec` 0.6 — and at the 2 s window this used to be,
     * the window held exactly one job or exactly two and the readout showed
     * `+0.30/S` or `+0.60/S` and never the true `+0.36/S`. Ten seconds holds six
     * jobs, so the reading is the rate rather than a coin flip about it.
     *
     * The price is response time, and it is paid where it costs least: a
     * discrete fill (`buy_energy(40)`) now enters the window as +4/S for ten
     * seconds rather than +20/S for two. The core's °C/s — the one number a
     * controller is judged on — keeps its own short window below.
     */
    poolRateWindowSec: 10,
    /**
     * Trailing window for the core's °C/s. Kept short: inside a demand window
     * the temperature says where the core *is* and only its rate says whether
     * the player is winning, so this readout is judged on how fast it answers.
     * Heat is a true derivative rather than a count of discrete events, so it
     * never had OP-54's quantization problem and does not need the long window.
     */
    tempRateWindowSec: 2,
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
