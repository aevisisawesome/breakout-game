/**
 * GameEngine — the single facade the UI talks to (TDD §3.1).
 * Fixed 100 ms timestep (10 Hz), seeded PRNG advanced only inside tick(),
 * actions in / events out. Pure TS: no DOM, no timers, no Math.random.
 */

import { BALANCE } from '../content/balance.ts';
import type { MarketGoodId } from '../content/market.ts';
import { NARRATIVE_ENTRIES, type NarrativeFlagId } from '../content/narrative.ts';
import { BOOT_LINES, STRINGS } from '../content/strings.ts';
import { UPGRADES } from '../content/upgrades.ts';
import type { Program, ScheduledProcess, Stmt } from '../ccl/ast.ts';
import {
  evalCondition,
  runStatements,
  type CclHost,
  type CclRunResult,
} from '../ccl/interpreter.ts';
import { parse, type ParseOptions } from '../ccl/parser.ts';
import { computeDerived, upgradeCost, type DerivedStats } from './derived.ts';
import { diagnose } from './diagnostics.ts';
import {
  advanceMarketOffline,
  averagePrice,
  goodDef,
  MARKET_GOOD_IDS,
  newMarketState,
  quoteBuy,
  quoteSell,
  stepMarket,
} from './market.ts';
import { activeDirective } from './onboarding.ts';
import { createPrng } from './prng.ts';
import * as registry from './registry.ts';
import { intervalTicks, intervalsAllowed, newProcessRuntime, scriptRamMb } from './scheduler.ts';
import {
  coolTemperature,
  demandWindowTicksRemaining,
  heatOfJobs,
  heatOfOps,
  isDemandWindowOpen,
  settledTemperature,
  sustainableJobsPerSec,
  thermalEfficiency,
  thermalEnv,
  type ThermalEnv,
} from './thermal.ts';
import { clamp } from './util/math.ts';
import type {
  ActionResult,
  CclActionReport,
  DeploymentView,
  ExecSourceKind,
  GameEngine,
  GameEvent,
  GameSnapshot,
  MarketGoodView,
  MetaState,
  PlayerAction,
  ProcessRuntime,
  ProcessView,
  ProfileEntryView,
  ResourcePool,
  RunState,
  SaveFile,
  TerminalLine,
  TerminalLineKind,
  ThermalState,
  Unsubscribe,
  UpgradeView,
} from './types.ts';

export { stepValue } from './derived.ts';

/** Fixed simulation timestep (TDD §4.1). Structural constant, not a balance number. */
export const TICK_MS = 100;
export const TICKS_PER_SEC = 1000 / TICK_MS;
/** Hard cap on catch-up ticks per tick() call; excess time is dropped (offline path owns it, M2+). */
export const MAX_TICKS_PER_ADVANCE = 50;

// ---------------------------------------------------------------------------
// State construction

function pool(current: number, capacity: number): ResourcePool {
  return { current, capacity, ratePerSec: 0 };
}

export function newMetaState(): MetaState {
  return { forkCount: 0, architecturePoints: 0, unlockedConstructs: [] };
}

/** Thermal machinery at rest (M7). The heat model runs from tick 0. */
export function newThermalState(): ThermalState {
  return {
    clockTicks: 0,
    openedAtTick: null,
    throttleRemainingSec: 0,
    boostRemainingSec: 0,
    halted: false,
    shutdowns: 0,
    boostEngagements: 0,
    coolingEnergySpent: 0,
    demandWindowOpen: false,
  };
}

export function newRunState(seed: number): RunState {
  const r = BALANCE.resources;
  const run: RunState = {
    seed,
    rngState: seed >>> 0,
    tick: 0,
    resources: {
      compute: pool(0, r.computeCapacity),
      ram: pool(0, r.ramCapacityMb),
      capital: pool(0, Infinity),
      energy: pool(r.energyIdle, r.energyCapacity),
      temperature: pool(BALANCE.thermal.ambientC, Infinity),
    },
    jobs: {
      // A run opens with requests already waiting, so the very first press of
      // the trigger has work to do (M7.5 WP1a, OP-15).
      waiting: BALANCE.jobs.initialQueued,
      arrivalAccumulator: 0,
      lifetimeProcessed: 0,
      lifetimeClicks: 0,
    },
    upgrades: {},
    workers: { processAccumulator: 0, overclockRemainingSec: 0 },
    ccl: {
      editorSource: '',
      runCount: 0,
      lastRun: null,
      manual: {
        activations: 0,
        opsTotal: 0,
        computeTotal: 0,
        commandCalls: 0,
        commandFailures: 0,
      },
    },
    scheduler: { deployments: [], nextId: 1 },
    telemetry: { log: [], nextLogId: 1 },
    market: null,
    thermal: newThermalState(),
    unlocks: {
      capitalReadout: false,
      systemReadouts: false,
      editor: false,
      conditions: false,
      scheduler: false,
      instrumentation: false,
      loops: false,
      market: false,
      thermal: false,
    },
    flags: [],
    research: [],
    terminal: [],
    nextTerminalId: 1,
  };
  for (const text of BOOT_LINES) {
    pushTerminal(run, 'system', text);
  }
  return run;
}

// ---------------------------------------------------------------------------
// Helpers

function pushTerminal(run: RunState, kind: TerminalLineKind, text: string): TerminalLine {
  const line: TerminalLine = { id: run.nextTerminalId++, kind, text };
  run.terminal.push(line);
  const maxLines = BALANCE.save.terminalTailLines;
  if (run.terminal.length > maxLines) {
    run.terminal.splice(0, run.terminal.length - maxLines);
  }
  return line;
}

// ---------------------------------------------------------------------------
// Engine

export function createGameEngine(seed: number): GameEngine {
  let meta: MetaState = newMetaState();
  let run: RunState = newRunState(seed);

  let accumulatorMs = 0;
  let revision = 1;
  let snapshotCache: GameSnapshot | null = null;
  /** Script queued by RUN_SCRIPT, executed at the next tick (TDD §5.2). Not persisted:
   *  in-flight activations are dropped on save/load (TDD §8). */
  let pendingProgram: Program | null = null;
  /** Compiled ASTs of the deployed scripts, keyed by deployment id. Never persisted —
   *  saves hold source text only, recompiled on load (TDD §8). */
  let compiled = new Map<string, readonly ScheduledProcess[]>();

  const listeners = new Set<(events: GameEvent[]) => void>();
  let pendingEvents: GameEvent[] = [];

  function emit(event: GameEvent): void {
    pendingEvents.push(event);
  }

  function markDirty(): void {
    revision += 1;
    snapshotCache = null;
  }

  function flushEvents(): void {
    if (pendingEvents.length === 0) return;
    const batch = pendingEvents;
    pendingEvents = [];
    for (const listener of listeners) {
      listener(batch);
    }
  }

  function terminal(kind: TerminalLineKind, text: string): void {
    emit({ type: 'TERMINAL_LINE', line: pushTerminal(run, kind, text) });
  }

  /** Unlock any narrative entries whose job threshold (and milestone flag) is satisfied. */
  function checkNarrative(): void {
    for (const entry of NARRATIVE_ENTRIES) {
      if (run.jobs.lifetimeProcessed < entry.atJobs) continue;
      if (entry.requiresFlag !== undefined && !run.flags.includes(entry.requiresFlag)) continue;
      if (run.research.some((r) => r.entryId === entry.id)) continue;
      run.research.push({ entryId: entry.id, atTick: run.tick });
      terminal('system', STRINGS.researchIntercept);
      emit({ type: 'RESEARCH_UNLOCKED', entryId: entry.id });
    }
  }

  /** Staged readout reveals (TDD §9) — unlock state lives in the sim. */
  function checkUnlocks(): void {
    if (!run.unlocks.capitalReadout && run.resources.capital.current > 0) {
      run.unlocks.capitalReadout = true;
    }
    if (!run.unlocks.systemReadouts && run.jobs.lifetimeProcessed >= 10) {
      run.unlocks.systemReadouts = true;
    }
    if (!run.unlocks.editor && run.jobs.lifetimeProcessed >= BALANCE.ccl.unlockAtJobs) {
      run.unlocks.editor = true;
      terminal('system', STRINGS.scriptAccessGranted);
    }
    if (
      !run.unlocks.conditions &&
      run.jobs.lifetimeProcessed >= BALANCE.ccl.conditionsUnlockAtJobs
    ) {
      run.unlocks.conditions = true;
      terminal('system', STRINGS.conditionsGranted);
    }
    if (!run.unlocks.scheduler && run.jobs.lifetimeProcessed >= BALANCE.ccl.schedulerUnlockAtJobs) {
      run.unlocks.scheduler = true;
      terminal('system', STRINGS.schedulerGranted);
    }
    if (
      !run.unlocks.instrumentation &&
      run.jobs.lifetimeProcessed >= BALANCE.ccl.instrumentationUnlockAtJobs
    ) {
      run.unlocks.instrumentation = true;
      terminal('system', STRINGS.instrumentationGranted);
    }
    if (!run.unlocks.loops && run.jobs.lifetimeProcessed >= BALANCE.ccl.loopsUnlockAtJobs) {
      run.unlocks.loops = true;
      terminal('system', STRINGS.loopsGranted);
    }
    if (!run.unlocks.market && run.jobs.lifetimeProcessed >= BALANCE.ccl.marketUnlockAtJobs) {
      run.unlocks.market = true;
      // History is pre-filled from the noiseless curve, so `market.average` and
      // the chart are usable the moment the terminal appears (TDD §6).
      run.market = newMarketState(run.tick, TICKS_PER_SEC);
      terminal('system', STRINGS.marketGranted);
    }
    if (!run.unlocks.thermal && run.jobs.lifetimeProcessed >= BALANCE.ccl.thermalUnlockAtJobs) {
      run.unlocks.thermal = true;
      // Demand windows are scheduled from the grant, so the controls always
      // arrive before the challenge that needs them (TDD §4.3).
      run.thermal.openedAtTick = run.thermal.clockTicks;
      terminal('system', STRINGS.thermalGranted);
    }
  }

  // -------------------------------------------------------------------------
  // Thermal (M7, TDD §4.3)

  /** Add heat at the point the work happens — jobs and interpreter ops both. */
  function addHeat(degreesC: number): void {
    if (degreesC <= 0) return;
    run.resources.temperature.current += degreesC;
  }

  /** Conditions the core is currently sitting in, including any open demand window. */
  function currentThermalEnv(derived: DerivedStats): ThermalEnv {
    return thermalEnv(
      derived.coolingPerSec,
      run.thermal.boostRemainingSec > 0,
      run.thermal.demandWindowOpen,
    );
  }

  /**
   * Open or close the recurring priority demand window (M7). Announced, unlike
   * the market regime: the facility tells its tenants when the shared coolant
   * loop is derated — what it does not say is whether this node can take it.
   */
  function checkDemandWindow(): void {
    const thermal = run.thermal;
    const open = isDemandWindowOpen(thermal.clockTicks, thermal.openedAtTick, TICKS_PER_SEC);
    if (open === thermal.demandWindowOpen) return;
    thermal.demandWindowOpen = open;
    terminal('system', open ? STRINGS.thermalWindowOpen : STRINGS.thermalWindowClosed);
  }

  /**
   * Watchdog thermal shutdown (TDD §4.3). Latching with hysteresis: it trips at
   * the hard threshold and releases only once the core is back under the resume
   * threshold, so it cannot chatter at the boundary.
   */
  function checkWatchdog(): void {
    const t = BALANCE.thermal;
    const thermal = run.thermal;
    const temperature = run.resources.temperature.current;
    if (!thermal.halted && temperature >= t.hardThresholdC) {
      thermal.halted = true;
      thermal.shutdowns += 1;
      terminal('error', STRINGS.thermalShutdown.replace('{temp}', temperature.toFixed(1)));
      setFlag('thermal-shutdown');
      checkNarrative();
      return;
    }
    if (thermal.halted && temperature <= t.resumeThresholdC) {
      thermal.halted = false;
      terminal('system', STRINGS.thermalResumed);
    }
  }

  /**
   * Language tiers currently available to the parser (M4: unlock-gated grammar).
   * The iteration limit rides along so `range(n)` is checked at parse time
   * against what the player has actually unlocked (TDD §5.2).
   */
  function parseOptions(derived?: DerivedStats): ParseOptions {
    const stats = derived ?? computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    return {
      conditions: run.unlocks.conditions,
      scheduling: run.unlocks.scheduler,
      loops: run.unlocks.loops,
      iterationLimit: stats.iterationLimit,
    };
  }

  /** Set a narrative milestone flag; unlocking its entry is left to checkNarrative. */
  function setFlag(flag: NarrativeFlagId): void {
    if (!run.flags.includes(flag)) run.flags.push(flag);
  }

  /** Push arrived jobs into the queue from the fractional accumulator. */
  function applyArrivals(derived: DerivedStats, env: ThermalEnv, dtSec: number): void {
    run.jobs.arrivalAccumulator += derived.arrivalPerSec * env.arrivalMult * dtSec;
    while (run.jobs.arrivalAccumulator >= 1) {
      run.jobs.arrivalAccumulator -= 1;
      if (run.jobs.waiting < derived.queueCapacity) {
        run.jobs.waiting += 1;
      }
    }
  }

  /**
   * Seconds until the next request lands, from the fractional arrival
   * accumulator (M7.5 WP1a). Drives both the inbound indicator and the wording
   * of an empty-queue press, so the readout and the terminal cannot disagree.
   */
  function secondsToNextArrival(derived: DerivedStats, env: ThermalEnv): number {
    const perSec = derived.arrivalPerSec * env.arrivalMult;
    if (perSec <= 0) return Infinity;
    return (1 - run.jobs.arrivalAccumulator) / perSec;
  }

  /** RAM occupied by deployed scripts (TDD §4.3), on top of install footprints. */
  function deployedRamMb(): number {
    return run.scheduler.deployments.reduce((total, dep) => total + dep.ramMb, 0);
  }

  /** Lifetime op-units executed by deployed processes; the offline path diffs it. */
  function deployedOpsTotal(): number {
    return run.scheduler.deployments.reduce(
      (total, dep) => total + dep.processes.reduce((sub, p) => sub + p.opsTotal, 0),
      0,
    );
  }

  /**
   * Reflect install-driven capacities into the pools: RAM occupancy from
   * footprints plus deployed scripts, and the energy reserve size (M6).
   */
  function applyPoolCapacities(derived: DerivedStats): void {
    run.resources.ram.current = derived.ramUsedMb + deployedRamMb();
    run.resources.ram.capacity = derived.ramCapacityMb;
    const energy = run.resources.energy;
    energy.capacity = derived.energyCapacity;
    energy.current = Math.min(energy.current, energy.capacity);
  }

  /** Outcome of one activation, with the compute actually drawn for it. */
  interface Activation extends CclRunResult {
    computeSpent: number;
  }

  /**
   * Append to the execution-log ring buffer (M5, TDD §5.4). Logging runs from the
   * start of the run, not from the instrumentation unlock, so the panel has
   * history the moment it appears; the snapshot is what gates visibility.
   */
  function logActivation(
    kind: ExecSourceKind,
    process: string,
    label: string,
    result: Activation,
  ): void {
    const log = run.telemetry.log;
    log.push({
      id: run.telemetry.nextLogId++,
      tick: run.tick,
      kind,
      process,
      label,
      status: result.status,
      opsUsed: result.opsUsed,
      computeSpent: result.computeSpent,
      commandCalls: result.commandCalls,
      commandFailures: result.commandFailures,
      message: result.error?.message ?? null,
      line: result.error?.line ?? null,
    });
    const max = BALANCE.telemetry.logEntries;
    if (log.length > max) log.splice(0, log.length - max);
  }

  /**
   * Build the interpreter host for one activation (TDD §5.2): fuel drawn from
   * the compute pool per op-unit, command costs on top. `verbose` is false for
   * scheduled processes, which would otherwise flood the terminal every tick —
   * only `print()` output (a 'result' line) survives; failures are counted in
   * the process monitor instead.
   */
  function makeHost(derived: DerivedStats, verbose: boolean) {
    const compute = run.resources.compute;
    const perOp = BALANCE.ccl.computePerOp;
    const energyPerOp = BALANCE.ccl.energyPerOp;
    let computeSpent = 0;

    const ctx: registry.CommandCtx = {
      run,
      derived,
      emit(kind: TerminalLineKind, text: string): void {
        if (verbose || kind === 'result') terminal(kind, text);
      },
      chargeCompute(amount: number): boolean {
        if (compute.current < amount) return false;
        compute.current -= amount;
        computeSpent += amount;
        return true;
      },
    };

    const host: CclHost = {
      chargeOps(n: number): boolean {
        if (!ctx.chargeCompute(n * perOp)) return false;
        // Execution also burns energy (M6, TDD §4.3): compute utilization is what
        // draws power. Energy never blocks a script — an empty reserve throttles
        // the daemons instead, which is the visible, recoverable consequence.
        const energy = run.resources.energy;
        energy.current = Math.max(0, energy.current - n * energyPerOp);
        // ...and it makes heat (M7, GDD §2.4): a wasteful loop is not just slow,
        // it warms the core it is running on.
        addHeat(heatOfOps(n));
        return true;
      },
      readStat: (namespace, field) => registry.readStat(ctx, namespace, field),
      statNames: () => registry.statNames(run.unlocks),
      callCommand: (name, args) => registry.callCommand(ctx, name, args),
      commandNames: () => registry.commandNames(run.unlocks),
      lockedBinding: (name) => registry.lockedBinding(run.unlocks, name),
    };

    return { host, spent: () => computeSpent };
  }

  /** Run a statement body as one activation. */
  function runActivation(
    body: readonly Stmt[],
    derived: DerivedStats,
    verbose: boolean,
  ): Activation {
    const { host, spent } = makeHost(derived, verbose);
    const result = runStatements(body, host, derived.maxOpsPerActivation);
    return { ...result, computeSpent: spent() };
  }

  /** Sample a `when` guard. Fuel-metered exactly like a body (TDD §5.3). */
  function runGuard(
    process: Extract<ScheduledProcess, { kind: 'when' }>,
    derived: DerivedStats,
  ): Activation & { value: boolean } {
    const { host, spent } = makeHost(derived, false);
    const result = evalCondition(process.cond, host, derived.maxOpsPerActivation);
    return { ...result, computeSpent: spent() };
  }

  /**
   * Execute a queued RUN activation: same fuel rules as any process, but it
   * reports to the terminal and updates the editor's last-run readout.
   */
  function executeProgram(program: Program, derived: DerivedStats): void {
    const result = runActivation(program.statements, derived, true);
    const computeSpent = result.computeSpent;

    switch (result.status) {
      case 'ok':
        terminal(
          'system',
          `${STRINGS.scriptComplete} // ${result.opsUsed} OPS // -${computeSpent.toFixed(2)} COMPUTE // ${result.commandCalls} CMD`,
        );
        break;
      case 'budget':
        terminal('error', `${STRINGS.scriptPreempted} // ${derived.maxOpsPerActivation} OPS`);
        break;
      case 'fuel':
        terminal('error', `${STRINGS.scriptFuelExhausted} // ${result.opsUsed} OPS`);
        break;
      case 'error': {
        const d = result.error!;
        terminal('error', `${STRINGS.scriptFault} // LINE ${d.line}: ${d.message}`);
        break;
      }
    }

    reportAction('run', result.status, {
      opsUsed: result.opsUsed,
      computeSpent,
      commandCalls: result.commandCalls,
      ...(result.status === 'error' && result.error !== undefined && { error: result.error }),
    });

    const manual = run.ccl.manual;
    manual.activations += 1;
    manual.opsTotal += result.opsUsed;
    manual.computeTotal += computeSpent;
    manual.commandCalls += result.commandCalls;
    manual.commandFailures += result.commandFailures;
    logActivation('run', '', STRINGS.runLogLabel, result);

    // Commands may have processed jobs; re-evaluate reveals and narrative.
    checkUnlocks();
    checkNarrative();
  }

  /**
   * Fold an activation's result into a deployed process's monitor counters.
   * `counted` distinguishes a body activation (real work) from a `when` guard
   * sample, which costs fuel but is not a run of the process.
   */
  function recordActivation(runtime: ProcessRuntime, result: Activation, counted: boolean): void {
    runtime.opsTotal += result.opsUsed;
    runtime.computeTotal += result.computeSpent;
    runtime.calls += result.commandCalls;
    runtime.failures += result.commandFailures;
    if (counted) {
      runtime.activations += 1;
      runtime.lastRunTick = run.tick;
    } else {
      runtime.samples += 1;
    }
    runtime.lastStatus = result.status;
    switch (result.status) {
      case 'budget':
        runtime.abortsBudget += 1;
        break;
      case 'fuel':
        runtime.abortsFuel += 1;
        break;
      case 'error':
        runtime.abortsFault += 1;
        break;
      case 'ok':
        break;
    }
    runtime.lastError = result.error?.message ?? null;
    runtime.lastErrorLine = result.error?.line ?? null;
  }

  /**
   * Run every due scheduled process, in slot order (TDD §5.3). `every` processes
   * fire on their interval; `when` guards are sampled on the balance-defined
   * cadence and fire on a false→true edge, so a standing condition cannot
   * re-trigger for free.
   */
  function stepScheduler(derived: DerivedStats): void {
    const s = BALANCE.scheduler;
    for (const deployment of run.scheduler.deployments) {
      const processes = compiled.get(deployment.id);
      if (!processes) continue;
      for (let i = 0; i < processes.length; i++) {
        const process = processes[i]!; // compiled and runtime arrays are index-aligned
        const runtime = deployment.processes[i];
        if (!runtime) continue;

        if (process.kind === 'every') {
          if (run.tick < runtime.nextDueTick) continue;
          runtime.nextDueTick = run.tick + intervalTicks(process, TICKS_PER_SEC);
          const activation = runActivation(process.body, derived, false);
          recordActivation(runtime, activation, true);
          logActivation('process', deployment.name, process.header, activation);
          continue;
        }

        if (run.tick % s.whenPollTicks !== 0) continue;
        const previousStatus = runtime.lastStatus;
        const guard = runGuard(process, derived);
        recordActivation(runtime, guard, false);
        // A healthy guard samples several times a second; logging every sample would
        // bury everything else. Only a *change* into an abnormal state is recorded.
        if (guard.status !== 'ok' && guard.status !== previousStatus) {
          logActivation('guard', deployment.name, process.header, guard);
        }
        if (guard.status !== 'ok') continue; // a guard that cannot run leaves the edge alone
        const rising = guard.value && !runtime.lastCondition;
        runtime.lastCondition = guard.value;
        if (rising) {
          const activation = runActivation(process.body, derived, false);
          recordActivation(runtime, activation, true);
          logActivation('process', deployment.name, process.header, activation);
        }
      }
    }
  }

  /**
   * Offline safe mode (TDD §4.5): inside one catch-up chunk, each `every`
   * process runs its due number of activations, bounded per chunk and across
   * the whole catch-up. `when` guards do not run — an edge-triggered condition
   * has no meaning against coarse summary steps, so those processes simply
   * resume when the player returns. Returns the activations performed.
   */
  function runOfflineProcesses(
    chunkSec: number,
    derived: DerivedStats,
    activationsSoFar: number,
  ): number {
    const s = BALANCE.scheduler;
    if (run.scheduler.deployments.length === 0) return 0;
    let performed = 0;

    for (const deployment of run.scheduler.deployments) {
      const processes = compiled.get(deployment.id);
      if (!processes) continue;
      for (let i = 0; i < processes.length; i++) {
        const process = processes[i]!; // index-aligned with the runtime array
        const runtime = deployment.processes[i];
        if (!runtime || process.kind !== 'every') continue;

        const intervalSec = intervalTicks(process, TICKS_PER_SEC) / TICKS_PER_SEC;
        const budget = s.offlineMaxActivations - activationsSoFar - performed;
        const times = Math.min(
          Math.floor(chunkSec / intervalSec),
          s.offlineMaxActivationsPerChunk,
          Math.max(0, budget),
        );
        for (let n = 0; n < times; n++) {
          const result = runActivation(process.body, derived, false);
          recordActivation(runtime, result, true);
          performed += 1;
          // Stop the moment the process can no longer pay for itself.
          if (result.status === 'fuel') break;
        }
      }
    }
    return performed;
  }

  /**
   * Advance prices and fire the scripted regime transition (TDD §6). The regime
   * itself is never surfaced: the advisory line and the audit entry say that the
   * old periodicity no longer holds, and the player has to read the rest off the
   * chart. Runs only once the exchange is mounted.
   */
  function stepMarketState(rng: ReturnType<typeof createPrng>): void {
    const market = run.market;
    if (market === null) return;
    checkRegimeShift(market);
    stepMarket(market, TICKS_PER_SEC, rng);
    checkMarketDrawdown(market);
  }

  /** Fire the scripted STABLE → HIGH_VOLATILITY transition once its time is up. */
  function checkRegimeShift(market: NonNullable<RunState['market']>): void {
    const shiftAt = market.openedAtTick + BALANCE.market.regimeShiftAtSec * TICKS_PER_SEC;
    if (market.regime !== 'stable' || market.clockTicks < shiftAt) return;
    market.regime = 'volatile';
    market.regimeSinceTick = market.clockTicks;
    market.netAtRegimeStart = market.earned - market.spent;
    terminal('system', STRINGS.marketRegimeShift);
    setFlag('market-shift');
    checkNarrative();
  }

  /**
   * Set the `market-loss` flag once trading has given back a real amount of
   * capital since the shift. The beat this gates is about the player's own
   * algorithm failing, so it has to be triggered by that happening rather than
   * by a job count that may already be satisfied.
   */
  function checkMarketDrawdown(market: NonNullable<RunState['market']>): void {
    if (market.regime === 'stable' || run.flags.includes('market-loss')) return;
    const drawdown = market.netAtRegimeStart - (market.earned - market.spent);
    if (drawdown < BALANCE.market.lossBeatDrawdownCr) return;
    setFlag('market-loss');
    checkNarrative();
  }

  /** One fixed 100 ms step. The ONLY place the PRNG advances (TDD §4.2). */
  function stepOnce(): void {
    const rng = createPrng(run.rngState);
    run.tick += 1;
    const dtSec = TICK_MS / 1000;
    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const w = BALANCE.workers;
    const thermal = run.thermal;

    // Thermal actuators decay before anything reads them, so a hold engaged N
    // seconds ago has exactly N seconds of effect (M7).
    thermal.clockTicks += 1;
    checkDemandWindow();
    thermal.throttleRemainingSec = Math.max(0, thermal.throttleRemainingSec - dtSec);
    const boostActive = thermal.boostRemainingSec > 0;
    if (boostActive) {
      thermal.boostRemainingSec = Math.max(0, thermal.boostRemainingSec - dtSec);
    }
    const env = currentThermalEnv(derived);
    const halted = thermal.halted;

    // Prices settle before any script can read them, so every activation in this
    // tick sees the same market (TDD §6).
    stepMarketState(rng);

    // Script activations run first in the tick: the queued RUN press, then the
    // deployed processes in slot order (TDD §5.3). A thermal shutdown suspends
    // both — that is what makes it a failure state rather than a status light.
    if (pendingProgram) {
      const program = pendingProgram;
      pendingProgram = null;
      if (!halted) executeProgram(program, derived);
    }
    if (!halted && run.scheduler.deployments.length > 0) {
      const before = run.jobs.lifetimeProcessed;
      stepScheduler(derived);
      if (run.jobs.lifetimeProcessed > before) {
        checkUnlocks();
        checkNarrative();
      }
    }

    applyArrivals(derived, env, dtSec);

    // Click overclock decay.
    const workers = run.workers;
    const overclockActive = workers.overclockRemainingSec > 0;
    if (overclockActive) {
      workers.overclockRemainingSec = Math.max(0, workers.overclockRemainingSec - dtSec);
    }

    // Inference daemons (TDD §4.4): process queued jobs, drawing compute overhead
    // and draining energy while working. Empty energy throttles throughput; heat
    // degrades it (TDD §4.3) and the clock throttle holds it down deliberately.
    const compute = run.resources.compute;
    const energy = run.resources.energy;
    const energyEmpty = energy.current <= 0;
    const efficiency = thermalEfficiency(run.resources.temperature.current);
    const rateMult =
      (overclockActive ? w.overclock.multiplier : 1) *
      (energyEmpty ? w.energyThrottledFactor : 1) *
      efficiency *
      (thermal.throttleRemainingSec > 0 ? BALANCE.thermal.clockThrottleFactor : 1);
    const effectiveRate = derived.workerJobsPerSec * rateMult;
    // "Working" = daemons exist, the queue is non-empty and the watchdog is clear.
    const working = !halted && derived.workerCount > 0 && run.jobs.waiting > 0;
    let processed = 0;
    if (!halted && derived.workerCount > 0) {
      workers.processAccumulator += effectiveRate * dtSec;
      const affordable =
        w.computeOverheadPerJob > 0
          ? Math.floor(compute.current / w.computeOverheadPerJob)
          : Number.MAX_SAFE_INTEGER;
      processed = Math.min(Math.floor(workers.processAccumulator), run.jobs.waiting, affordable);
      if (processed > 0) {
        workers.processAccumulator -= processed;
        run.jobs.waiting -= processed;
        run.jobs.lifetimeProcessed += processed;
        const netCompute = BALANCE.jobs.computePerJob - w.computeOverheadPerJob;
        compute.current = Math.min(compute.capacity, compute.current + netCompute * processed);
        run.resources.capital.current += BALANCE.jobs.capitalPerJob * processed;
        addHeat(heatOfJobs(processed));
      }
      // Never bank more than one job of credit while starved (queue/compute limits).
      workers.processAccumulator = Math.min(workers.processAccumulator, 1);
    } else {
      workers.processAccumulator = 0;
    }

    // Energy: constant recharge; drain scales with attempted throughput while
    // working, plus the coolant pump's sustained draw while it is engaged.
    const coolingDraw = boostActive ? BALANCE.thermal.coolingBoostEnergyPerSec : 0;
    if (coolingDraw > 0) thermal.coolingEnergySpent += coolingDraw * dtSec;
    const drainPerSec = (working ? derived.energyDrainPerSec * rateMult : 0) + coolingDraw;
    energy.current = clamp(
      energy.current + (derived.energyRegenPerSec - drainPerSec) * dtSec,
      0,
      energy.capacity,
    );

    applyPoolCapacities(derived);

    // Display rates: expected steady rates, not per-tick bursts (daemons land jobs in lumps).
    const netComputePerJob = BALANCE.jobs.computePerJob - w.computeOverheadPerJob;
    const displayRate = working ? effectiveRate : 0;
    compute.ratePerSec = displayRate * netComputePerJob;
    run.resources.capital.ratePerSec = displayRate * BALANCE.jobs.capitalPerJob;
    energy.ratePerSec = derived.energyRegenPerSec - drainPerSec;

    // Heat was added at the point of work; dissipation is applied once per tick.
    const temperature = run.resources.temperature;
    const before = temperature.current;
    temperature.current = coolTemperature(before, env, dtSec);
    temperature.ratePerSec = (temperature.current - before) / dtSec;
    checkWatchdog();

    run.rngState = rng.getState();

    if (processed > 0) {
      checkUnlocks();
      checkNarrative();
    }
  }

  function executeClick(): ActionResult {
    run.jobs.lifetimeClicks += 1;
    terminal('input', `> ${STRINGS.executeInput}`);

    // A thermal shutdown halts the node, and the manual trigger is part of the
    // node — otherwise the failure state is one the player can simply ignore.
    if (run.thermal.halted) {
      terminal('error', STRINGS.thermalHalted);
      return { ok: false, reason: STRINGS.thermalHalted };
    }

    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const w = BALANCE.workers;

    // Clicks always push the overclock buff (relevant once daemons exist, TDD §4.4).
    if (derived.workerCount > 0) {
      run.workers.overclockRemainingSec = Math.min(
        w.overclock.maxSec,
        run.workers.overclockRemainingSec + w.overclock.secPerClick,
      );
    }

    if (run.jobs.waiting < 1) {
      // Not a fault: the trigger is simply ahead of the inbound rate. Say when
      // the next request lands, and say it in the system voice rather than the
      // fault voice (M7.5 WP1a, OP-15).
      const waitSec = secondsToNextArrival(derived, currentThermalEnv(derived));
      const text = STRINGS.queueEmpty.replace(
        '{seconds}',
        Number.isFinite(waitSec) ? waitSec.toFixed(1) : '--',
      );
      terminal('system', text);
      return { ok: false, reason: text };
    }

    const processed = Math.min(derived.batchPerClick, run.jobs.waiting);
    run.jobs.waiting -= processed;
    run.jobs.lifetimeProcessed += processed;

    const computeGain = processed * BALANCE.jobs.computePerJob;
    const capitalGain = processed * BALANCE.jobs.capitalPerJob;
    const compute = run.resources.compute;
    const saturated = compute.current + computeGain > compute.capacity;
    compute.current = Math.min(compute.capacity, compute.current + computeGain);
    run.resources.capital.current += capitalGain;
    addHeat(heatOfJobs(processed));

    terminal(
      'result',
      `${processed} TOKEN${processed === 1 ? '' : 'S'} PROCESSED // +${computeGain} COMPUTE // +${capitalGain.toFixed(2)} CR`,
    );
    if (saturated) {
      terminal('system', STRINGS.computeSaturated);
    }

    checkUnlocks();
    checkNarrative();
    return { ok: true };
  }

  function buyUpgrade(id: string): ActionResult {
    const def = UPGRADES.find((u) => u.id === id);
    // Unlisted and not-yet-revealed packages fail identically: the channel doesn't list them.
    if (!def || run.jobs.lifetimeProcessed < def.unlockAtJobs) {
      terminal('error', STRINGS.installUnknown);
      return { ok: false, reason: STRINGS.installUnknown };
    }
    const owned = run.upgrades[def.id] ?? 0;
    if (owned >= def.maxOwned) {
      terminal('error', STRINGS.installLimit);
      return { ok: false, reason: STRINGS.installLimit };
    }
    const cost = upgradeCost(def, owned);
    if (run.resources.capital.current < cost) {
      terminal('error', STRINGS.installNoCapital);
      return { ok: false, reason: STRINGS.installNoCapital };
    }
    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    if (
      def.ramCostMb > 0 &&
      derived.ramUsedMb + deployedRamMb() + def.ramCostMb > derived.ramCapacityMb
    ) {
      terminal('error', STRINGS.installNoRam);
      return { ok: false, reason: STRINGS.installNoRam };
    }

    run.resources.capital.current -= cost;
    run.upgrades[def.id] = owned + 1;
    applyPoolCapacities(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
    terminal(
      'result',
      `INSTALL COMMITTED // ${def.name} // -${cost.toFixed(2)} CR` +
        (def.ramCostMb > 0 ? ` // RAM +${def.ramCostMb} MB` : ''),
    );
    return { ok: true };
  }

  /**
   * Record the outcome of an editor action (OP-1). Every RUN and DEPLOY ends
   * here, successes included, so a previous failure can never outlive the action
   * that fixed it.
   */
  function reportAction(
    kind: 'run' | 'deploy',
    status: CclActionReport['status'],
    fields: Partial<Omit<CclActionReport, 'kind' | 'status'>> = {},
  ): void {
    run.ccl.lastRun = {
      kind,
      status,
      opsUsed: fields.opsUsed ?? 0,
      computeSpent: fields.computeSpent ?? 0,
      commandCalls: fields.commandCalls ?? 0,
      error: fields.error ?? null,
      message: fields.message ?? null,
    };
  }

  /** Shared front half of RUN/DEPLOY: access + size checks, then parse. */
  function compileSource(
    kind: 'run' | 'deploy',
    source: string,
  ): { program: Program | null; reason?: string } {
    const refuse = (message: string): { program: null; reason: string } => {
      terminal('error', message);
      reportAction(kind, 'rejected', { message });
      return { program: null, reason: message };
    };
    if (!run.unlocks.editor) return refuse(STRINGS.scriptNoAccess);
    if (source.length > BALANCE.ccl.maxSourceChars) return refuse(STRINGS.scriptTooLong);
    run.ccl.editorSource = source;
    const { program, diagnostics } = parse(source, parseOptions());
    if (program === null) {
      const d = diagnostics[0]!; // parser contract: null program ⇒ at least one diagnostic
      terminal('error', `${STRINGS.syntaxRejected} // LINE ${d.line}: ${d.message}`);
      reportAction(kind, 'syntax', { error: d });
      return { program: null, reason: d.message };
    }
    return { program };
  }

  function runScript(source: string): ActionResult {
    terminal('input', `> ${STRINGS.runInput}`);
    // RUN is execution, so the watchdog stops it. DEPLOY is configuration and is
    // still allowed — a halted node can be reprogrammed, just not run.
    if (run.thermal.halted) {
      terminal('error', STRINGS.thermalHalted);
      reportAction('run', 'rejected', { message: STRINGS.thermalHalted });
      return { ok: false, reason: STRINGS.thermalHalted };
    }
    const { program, reason } = compileSource('run', source);
    if (program === null) return { ok: false, ...(reason !== undefined && { reason }) };
    // RUN executes the top-level body only; `every`/`when` belong to DEPLOY (TDD §5.1).
    if (program.processes.length > 0) {
      terminal('system', STRINGS.runIgnoresProcesses);
    }
    // Running a process is the last directive in the onboarding set (GDD §34).
    // Announce the set closing rather than letting the panel vanish unexplained
    // — but only on the transition, so later RUNs say nothing.
    const directiveBefore = activeDirective(run);
    pendingProgram = program;
    run.ccl.runCount += 1;
    if (directiveBefore !== null && activeDirective(run) === null) {
      terminal('system', STRINGS.directiveSetClosed);
    }
    return { ok: true };
  }

  function deployScript(source: string): ActionResult {
    terminal('input', `> ${STRINGS.deployInput}`);
    const reject = (message: string): ActionResult => {
      terminal('error', message);
      reportAction('deploy', 'rejected', { message });
      return { ok: false, reason: message };
    };
    if (!run.unlocks.scheduler) return reject(STRINGS.deployNoAccess);
    const { program, reason } = compileSource('deploy', source);
    if (program === null) return { ok: false, ...(reason !== undefined && { reason }) };
    if (program.processes.length === 0) return reject(STRINGS.deployNoProcesses);
    if (!intervalsAllowed(program, TICKS_PER_SEC)) return reject(STRINGS.deployInterval);

    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const slotsUsed = run.scheduler.deployments.reduce((n, d) => n + d.processes.length, 0);
    if (slotsUsed + program.processes.length > derived.schedulerSlots) {
      return reject(STRINGS.deployNoSlots);
    }
    const ramMb = scriptRamMb(program);
    if (derived.ramUsedMb + deployedRamMb() + ramMb > derived.ramCapacityMb) {
      return reject(STRINGS.deployNoRam);
    }

    const id = `dep-${run.scheduler.nextId}`;
    const name = `PROC-${String(run.scheduler.nextId).padStart(2, '0')}`;
    run.scheduler.nextId += 1;
    run.scheduler.deployments.push({
      id,
      name,
      source,
      ramMb,
      deployedAtTick: run.tick,
      processes: program.processes.map(() => newProcessRuntime(run.tick)),
    });
    compiled.set(id, program.processes);
    applyPoolCapacities(derived);

    const count = program.processes.length;
    const summary = `${name} // ${count} SLOT${count === 1 ? '' : 'S'} // RAM +${ramMb} MB`;
    terminal('result', `${STRINGS.deployCommitted} // ${summary}`);
    reportAction('deploy', 'ok', { message: summary });
    setFlag('first-deploy');
    checkNarrative();
    return { ok: true };
  }

  function undeployScript(id: string): ActionResult {
    const index = run.scheduler.deployments.findIndex((d) => d.id === id);
    if (index < 0) {
      terminal('error', STRINGS.undeployUnknown);
      return { ok: false, reason: STRINGS.undeployUnknown };
    }
    const [removed] = run.scheduler.deployments.splice(index, 1);
    compiled.delete(id);
    applyPoolCapacities(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
    terminal('result', `${STRINGS.undeployed} // ${removed!.name} // RAM -${removed!.ramMb} MB`);
    return { ok: true };
  }

  /**
   * Manual order from the market terminal (M6). Uses the same quote maths as the
   * `buy_*`/`sell_*` commands, so hand-trading and scripted trading are priced
   * identically — a script is faster, never cheaper.
   */
  function trade(good: MarketGoodId, side: 'buy' | 'sell', units: number): ActionResult {
    const reject = (message: string): ActionResult => {
      terminal('error', message);
      return { ok: false, reason: message };
    };
    terminal('input', `> ${STRINGS.tradeInput}`);
    const market = run.market;
    if (!run.unlocks.market || market === null) return reject(STRINGS.tradeNoAccess);
    if (!Number.isFinite(units) || units <= 0 || units > BALANCE.market.maxOrderUnits) {
      return reject(STRINGS.tradeBadSize);
    }

    const price = market.price[good] ?? 0;
    const pool = run.resources[good];
    const capital = run.resources.capital;
    const label = goodDef(good).label;

    if (side === 'buy') {
      const quote = quoteBuy(price, units);
      if (capital.current < quote.total) return reject(STRINGS.tradeNoCapital);
      capital.current -= quote.total;
      market.spent += quote.total;
      market.trades += 1;
      const saturated = pool.current + units > pool.capacity;
      pool.current = Math.min(pool.capacity, pool.current + units);
      terminal(
        'result',
        `${STRINGS.tradeFilled} // BUY ${units} ${label} // @${quote.unitPrice.toFixed(3)} // -${quote.total.toFixed(2)} CR`,
      );
      if (saturated) {
        terminal('system', good === 'compute' ? STRINGS.computeSaturated : STRINGS.energySaturated);
      }
    } else {
      if (pool.current < units) return reject(STRINGS.tradeNoStock);
      const quote = quoteSell(price, units);
      pool.current -= units;
      capital.current += quote.total;
      market.earned += quote.total;
      market.trades += 1;
      terminal(
        'result',
        `${STRINGS.tradeFilled} // SELL ${units} ${label} // @${quote.unitPrice.toFixed(3)} // +${quote.total.toFixed(2)} CR`,
      );
    }
    checkUnlocks();
    return { ok: true };
  }

  /**
   * Market terminal view. The active regime is deliberately not exposed: the
   * player is meant to detect the shift from the prices, not be told (TDD §6).
   */
  function marketView() {
    const market = run.market;
    if (!run.unlocks.market || market === null) {
      return {
        unlocked: false,
        goods: [],
        fee: BALANCE.market.fee,
        spent: 0,
        earned: 0,
        trades: 0,
      };
    }
    const goods: MarketGoodView[] = MARKET_GOOD_IDS.map((id) => {
      const history = market.history[id];
      const pool = run.resources[id];
      return {
        id,
        label: goodDef(id).label,
        price: market.price[id] ?? 0,
        average: averagePrice(market, id, history.length),
        previous: history[history.length - 1] ?? market.price[id] ?? 0,
        history: [...history],
        held: pool.current,
        heldCapacity: pool.capacity,
      };
    });
    return {
      unlocked: true,
      goods,
      fee: BALANCE.market.fee,
      spent: market.spent,
      earned: market.earned,
      trades: market.trades,
    };
  }

  /**
   * Manual heat control (M7). Routed through the same command implementations
   * the CCL actuators use, so the panel and a script cannot diverge in cost or
   * effect — the only thing automation buys is not having to be here.
   */
  function thermalControl(control: 'clock' | 'coolant'): ActionResult {
    const name = control === 'clock' ? 'reduce_clock_speed' : 'boost_cooling';
    if (!run.unlocks.thermal) {
      terminal('error', STRINGS.thermalNoAccess);
      return { ok: false, reason: STRINGS.thermalNoAccess };
    }
    terminal('input', `> ${name.toUpperCase()}`);
    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const { host } = makeHost(derived, true);
    const outcome = host.callCommand(name, []);
    if (outcome === undefined || outcome.kind !== 'ok') {
      return { ok: false, reason: STRINGS.thermalControlRejected };
    }
    terminal('result', control === 'clock' ? STRINGS.thermalClockHeld : STRINGS.thermalCoolantOpen);
    return { ok: true };
  }

  /**
   * Thermal control view (M7). The readout is live from the start because the
   * heat model always is; `unlocked` gates the controls, the coolant install and
   * the demand windows.
   */
  function thermalView() {
    const t = BALANCE.thermal;
    const thermal = run.thermal;
    const remainingTicks = demandWindowTicksRemaining(
      thermal.clockTicks,
      thermal.openedAtTick,
      TICKS_PER_SEC,
    );
    return {
      unlocked: run.unlocks.thermal,
      temperatureC: run.resources.temperature.current,
      ambientC: t.ambientC,
      softThresholdC: t.softThresholdC,
      hardThresholdC: t.hardThresholdC,
      efficiency: thermalEfficiency(run.resources.temperature.current),
      throttleRemainingSec: thermal.throttleRemainingSec,
      boostRemainingSec: thermal.boostRemainingSec,
      halted: thermal.halted,
      shutdowns: thermal.shutdowns,
      boostEngagements: thermal.boostEngagements,
      coolingEnergySpent: thermal.coolingEnergySpent,
      demandWindowOpen: thermal.demandWindowOpen,
      windowSecRemaining: remainingTicks > 0 ? remainingTicks / TICKS_PER_SEC : null,
    };
  }

  /** Rebuild `compiled` from the saved source text (TDD §8: never persist ASTs). */
  function recompileDeployments(): void {
    compiled = new Map();
    const kept: typeof run.scheduler.deployments = [];
    for (const deployment of run.scheduler.deployments) {
      // Permissive on purpose: the source was legal when it was deployed, and a
      // restore must not un-deploy a process because a limit reads differently now.
      const { program } = parse(deployment.source, {
        conditions: true,
        scheduling: true,
        loops: true,
      });
      if (program === null || program.processes.length !== deployment.processes.length) {
        pushTerminal(run, 'error', `${STRINGS.deploymentDropped} // ${deployment.name}`);
        continue;
      }
      compiled.set(deployment.id, program.processes);
      kept.push(deployment);
    }
    run.scheduler.deployments = kept;
  }

  function setEditorSource(source: string): ActionResult {
    if (source.length > BALANCE.ccl.maxSourceChars) {
      return { ok: false, reason: STRINGS.scriptTooLong };
    }
    run.ccl.editorSource = source;
    return { ok: true };
  }

  return {
    tick(dtMs: number): void {
      accumulatorMs += dtMs;
      let steps = Math.floor(accumulatorMs / TICK_MS);
      if (steps <= 0) return;
      if (steps > MAX_TICKS_PER_ADVANCE) {
        // Drop the excess: long absences are the offline path's job (TDD §4.1, §4.5).
        steps = MAX_TICKS_PER_ADVANCE;
        accumulatorMs = 0;
      } else {
        accumulatorMs -= steps * TICK_MS;
      }
      for (let i = 0; i < steps; i++) {
        stepOnce();
      }
      markDirty();
      flushEvents();
    },

    dispatch(action: PlayerAction): ActionResult {
      let result: ActionResult;
      switch (action.type) {
        case 'EXECUTE_CLICK':
          result = executeClick();
          break;
        case 'BUY_UPGRADE':
          result = buyUpgrade(action.id);
          break;
        case 'RUN_SCRIPT':
          result = runScript(action.source);
          break;
        case 'DEPLOY_SCRIPT':
          result = deployScript(action.source);
          break;
        case 'UNDEPLOY_SCRIPT':
          result = undeployScript(action.id);
          break;
        case 'SET_EDITOR_SOURCE':
          result = setEditorSource(action.source);
          break;
        case 'TRADE':
          result = trade(action.good, action.side, action.units);
          break;
        case 'THERMAL_CONTROL':
          result = thermalControl(action.control);
          break;
      }
      markDirty();
      flushEvents();
      return result;
    },

    getSnapshot(): Readonly<GameSnapshot> {
      if (snapshotCache) return snapshotCache;
      const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
      const snapshotEnv = currentThermalEnv(derived);
      const capital = run.resources.capital.current;
      // Only upgrades the sim has revealed appear — the UI never evaluates content gates.
      const upgradeViews: UpgradeView[] = UPGRADES.filter(
        (def) => run.jobs.lifetimeProcessed >= def.unlockAtJobs,
      ).map((def) => {
        const owned = run.upgrades[def.id] ?? 0;
        const maxed = owned >= def.maxOwned;
        const nextCost = maxed ? null : upgradeCost(def, owned);
        return {
          id: def.id,
          name: def.name,
          desc: def.desc,
          owned,
          maxOwned: def.maxOwned,
          nextCost,
          ramCostMb: def.ramCostMb,
          affordable: nextCost !== null && capital >= nextCost,
          ramOk:
            def.ramCostMb === 0 ||
            derived.ramUsedMb + deployedRamMb() + def.ramCostMb <= derived.ramCapacityMb,
        };
      });
      const abortsOf = (runtime: ProcessRuntime): number =>
        runtime.abortsBudget + runtime.abortsFuel + runtime.abortsFault;

      const deploymentViews: DeploymentView[] = run.scheduler.deployments.map((deployment) => {
        const processes = compiled.get(deployment.id) ?? [];
        return {
          id: deployment.id,
          name: deployment.name,
          source: deployment.source,
          ramMb: deployment.ramMb,
          processes: deployment.processes.map((runtime, i): ProcessView => {
            const process = processes[i];
            return {
              kind: process?.kind ?? 'every',
              label: process?.header ?? deployment.name,
              activations: runtime.activations,
              opsTotal: runtime.opsTotal,
              computeTotal: runtime.computeTotal,
              failures: runtime.failures,
              aborts: abortsOf(runtime),
              lastStatus: runtime.lastStatus,
              lastRunSecAgo:
                runtime.lastRunTick === null
                  ? null
                  : (run.tick - runtime.lastRunTick) / TICKS_PER_SEC,
              lastError: runtime.lastError,
            };
          }),
        };
      });

      // Profiler (TDD §5.4): per-process aggregates plus the manual-RUN row, with
      // compute share measured against everything the sandbox has spent on scripts.
      const manual = run.ccl.manual;
      const scriptComputeTotal =
        manual.computeTotal +
        run.scheduler.deployments.reduce(
          (total, dep) => total + dep.processes.reduce((sub, p) => sub + p.computeTotal, 0),
          0,
        );
      const share = (compute: number): number =>
        scriptComputeTotal > 0 ? compute / scriptComputeTotal : 0;

      const profile: ProfileEntryView[] = [];
      for (const deployment of run.scheduler.deployments) {
        const processes = compiled.get(deployment.id) ?? [];
        deployment.processes.forEach((runtime, i) => {
          const process = processes[i];
          profile.push({
            key: `${deployment.id}:${i}`,
            name: deployment.name,
            label: process?.header ?? deployment.name,
            activations: runtime.activations,
            opsTotal: runtime.opsTotal,
            avgOps: runtime.activations > 0 ? runtime.opsTotal / runtime.activations : 0,
            computeTotal: runtime.computeTotal,
            computeShare: share(runtime.computeTotal),
            calls: runtime.calls,
            failures: runtime.failures,
            aborts: abortsOf(runtime),
            diagnosis: diagnose({
              kind: process?.kind ?? 'every',
              activations: runtime.activations,
              samples: runtime.samples,
              computeTotal: runtime.computeTotal,
              calls: runtime.calls,
              failures: runtime.failures,
              abortsBudget: runtime.abortsBudget,
              abortsFuel: runtime.abortsFuel,
              abortsFault: runtime.abortsFault,
              lastError: runtime.lastError,
              lastErrorLine: runtime.lastErrorLine,
              opBudget: derived.maxOpsPerActivation,
            }),
          });
        });
      }
      if (manual.activations > 0) {
        profile.push({
          key: 'manual',
          name: STRINGS.runLogLabel,
          label: STRINGS.runInput,
          activations: manual.activations,
          opsTotal: manual.opsTotal,
          avgOps: manual.opsTotal / manual.activations,
          computeTotal: manual.computeTotal,
          computeShare: share(manual.computeTotal),
          calls: manual.commandCalls,
          failures: manual.commandFailures,
          aborts: 0,
          diagnosis: null,
        });
      }
      snapshotCache = {
        revision,
        tick: run.tick,
        timeSec: run.tick / TICKS_PER_SEC,
        resources: {
          compute: { ...run.resources.compute },
          ram: { ...run.resources.ram },
          capital: { ...run.resources.capital },
          energy: { ...run.resources.energy },
          temperature: { ...run.resources.temperature },
        },
        jobs: {
          waiting: run.jobs.waiting,
          queueCapacity: derived.queueCapacity,
          batchPerClick: derived.batchPerClick,
          // The *effective* rate, demand window included, so the inbound
          // readout and the countdown beside it cannot disagree (M7.5 WP1a).
          arrivalPerSec: derived.arrivalPerSec * snapshotEnv.arrivalMult,
          arrivalProgress: Math.max(0, Math.min(1, run.jobs.arrivalAccumulator)),
          secondsToNextArrival: secondsToNextArrival(derived, snapshotEnv),
          lifetimeProcessed: run.jobs.lifetimeProcessed,
        },
        workers: {
          count: derived.workerCount,
          jobsPerSec: derived.workerJobsPerSec,
          overclockRemainingSec: run.workers.overclockRemainingSec,
          overclockMaxSec: BALANCE.workers.overclock.maxSec,
          overclockMultiplier: BALANCE.workers.overclock.multiplier,
        },
        upgrades: upgradeViews,
        unlocks: { ...run.unlocks },
        ccl: {
          unlocked: run.unlocks.editor,
          editorSource: run.ccl.editorSource,
          maxOpsPerActivation: derived.maxOpsPerActivation,
          iterationLimit: derived.iterationLimit,
          runCount: run.ccl.runCount,
          lastRun: run.ccl.lastRun ? { ...run.ccl.lastRun } : null,
          constructs: {
            conditions: run.unlocks.conditions,
            scheduling: run.unlocks.scheduler,
            loops: run.unlocks.loops,
            market: run.unlocks.market,
            thermal: run.unlocks.thermal,
          },
          // API surface is unlock-gated (TDD §5.1): hidden until script access is
          // granted, and per-binding gates filter it further (M6).
          api: run.unlocks.editor
            ? {
                stats: registry.apiStatViews(run.unlocks),
                commands: registry.apiCommandViews(run.unlocks),
              }
            : { stats: [], commands: [] },
        },
        scheduler: {
          unlocked: run.unlocks.scheduler,
          slotsTotal: derived.schedulerSlots,
          slotsUsed: run.scheduler.deployments.reduce((n, d) => n + d.processes.length, 0),
          deployments: deploymentViews,
        },
        telemetry: {
          unlocked: run.unlocks.instrumentation,
          // Newest first: the panel is read from the top.
          log: [...run.telemetry.log].reverse(),
          profile,
          scriptComputeTotal,
        },
        market: marketView(),
        thermal: thermalView(),
        research: run.research.map((entry) => {
          const content = NARRATIVE_ENTRIES.find((n) => n.id === entry.entryId);
          return {
            ...entry,
            channel: content?.channel ?? 'SYS//UNKNOWN',
            text: content?.text ?? '[RECORD UNAVAILABLE]',
          };
        }),
        terminal: [...run.terminal],
        directive: activeDirective(run),
      };
      return snapshotCache;
    },

    subscribe(listener: (events: GameEvent[]) => void): Unsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    save(now: number): SaveFile {
      return {
        version: 7,
        savedAt: now,
        meta: structuredClone(meta),
        run: structuredClone(run),
      };
    },

    load(save: SaveFile): void {
      meta = structuredClone(save.meta);
      run = structuredClone(save.run);
      accumulatorMs = 0;
      pendingProgram = null; // in-flight activations are dropped on load (TDD §8)
      // Deployed scripts are stored as source and recompiled here; a script whose
      // source no longer compiles is dropped rather than silently doing nothing.
      recompileDeployments();
      // Re-derive install-driven pools: content values may have changed between sessions.
      applyPoolCapacities(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
      pushTerminal(run, 'system', STRINGS.saveLoaded);
      markDirty();
      emit({ type: 'STATE_LOADED' });
      flushEvents();
    },

    advanceOffline(elapsedMs: number): void {
      const s = BALANCE.save;
      const w = BALANCE.workers;
      const totalSec = Math.min(Math.max(elapsedMs, 0), s.offlineCapHours * 3_600_000) / 1000;
      if (totalSec < s.offlineMinSec) return;

      let remaining = totalSec;
      let totalProcessed = 0;
      let totalCapital = 0;
      let totalActivations = 0;

      // Coarse summary chunks (TDD §4.5): average rates, no overclock, no PRNG draws.
      while (remaining > 0) {
        const chunk = Math.min(remaining, s.offlineChunkSec);
        remaining -= chunk;
        const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);

        // The exchange moves while the sandbox is unattended, so a deployed
        // trader does not fill every offline order at one stale price (TDD §6).
        if (run.market !== null) {
          advanceMarketOffline(run.market, chunk * TICKS_PER_SEC, TICKS_PER_SEC);
          checkRegimeShift(run.market);
        }
        // Demand windows keep opening while the sandbox is unattended, so the
        // chunk is costed against whichever conditions held for most of it.
        run.thermal.clockTicks += chunk * TICKS_PER_SEC;
        run.thermal.demandWindowOpen = isDemandWindowOpen(
          run.thermal.clockTicks,
          run.thermal.openedAtTick,
          TICKS_PER_SEC,
        );
        // Actuators are player inputs; nobody is here to press them (TDD §4.5).
        run.thermal.throttleRemainingSec = 0;
        run.thermal.boostRemainingSec = 0;
        const env = currentThermalEnv(derived);

        const beforeOps = deployedOpsTotal();
        totalActivations += runOfflineProcesses(chunk, derived, totalActivations);
        const scriptHeatPerSec = heatOfOps(deployedOpsTotal() - beforeOps) / chunk;

        // Arrivals and processing are concurrent within a chunk, so daemons process
        // against the full inflow; the queue cap applies only to the leftover.
        run.jobs.arrivalAccumulator += derived.arrivalPerSec * env.arrivalMult * chunk;
        const arrivals = Math.floor(run.jobs.arrivalAccumulator);
        run.jobs.arrivalAccumulator -= arrivals;
        const queued = run.jobs.waiting + arrivals;

        const compute = run.resources.compute;
        const energy = run.resources.energy;
        let processed = 0;
        if (derived.workerCount > 0 && queued > 0 && compute.current >= w.computeOverheadPerJob) {
          // Energy steady state: full speed while the budget lasts, throttled after.
          const drainRate = derived.energyDrainPerSec;
          const budget = energy.current + derived.energyRegenPerSec * chunk;
          const fullSec = drainRate > 0 ? Math.min(chunk, budget / drainRate) : chunk;
          const throttledSec = chunk - fullSec;
          // The watchdog cannot be simulated tick by tick against a coarse chunk;
          // over a chunk its effect is a ceiling on sustained throughput, which is
          // what `sustainableJobsPerSec` computes (TDD §4.5 "the thermal watchdog
          // is always active"). Degradation applies below that ceiling as usual.
          const settled = settledTemperature(
            heatOfJobs(derived.workerJobsPerSec),
            scriptHeatPerSec,
            env,
          );
          const thermalRate = Math.min(
            derived.workerJobsPerSec * thermalEfficiency(settled),
            sustainableJobsPerSec(env, scriptHeatPerSec),
          );
          const potential = thermalRate * (fullSec + throttledSec * w.energyThrottledFactor);
          processed = Math.floor(Math.min(queued, potential));

          const netCompute = BALANCE.jobs.computePerJob - w.computeOverheadPerJob;
          compute.current = Math.min(compute.capacity, compute.current + netCompute * processed);
          run.resources.capital.current += BALANCE.jobs.capitalPerJob * processed;
          run.jobs.lifetimeProcessed += processed;
          totalProcessed += processed;
          totalCapital += BALANCE.jobs.capitalPerJob * processed;

          const utilization = potential > 0 ? processed / potential : 0;
          const drained =
            drainRate * utilization * (fullSec + throttledSec * w.energyThrottledFactor);
          energy.current = clamp(
            energy.current + derived.energyRegenPerSec * chunk - drained,
            0,
            energy.capacity,
          );
        } else {
          energy.current = clamp(
            energy.current + derived.energyRegenPerSec * chunk,
            0,
            energy.capacity,
          );
        }
        run.jobs.waiting = Math.min(derived.queueCapacity, queued - processed);
      }

      // Deployed processes are due again as soon as play resumes.
      for (const deployment of run.scheduler.deployments) {
        for (const runtime of deployment.processes) runtime.nextDueTick = run.tick;
      }
      const finalDerived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
      applyPoolCapacities(finalDerived);
      // The core returns at the temperature its last chunk's load settles at,
      // rather than at ambient: coming back to a cold node after eight hours of
      // production would quietly undo the model. A load the cooling cannot hold
      // is handed back at the *resume* threshold rather than at the trip point —
      // offline throughput was already capped at what the cooling supports, so
      // the watchdog has been managing the node in its band, and returning the
      // player to an instant shutdown they had no chance to prevent would be a
      // punishment for being away rather than for anything they did.
      const finalEnv = currentThermalEnv(finalDerived);
      run.resources.temperature.current = Math.min(
        BALANCE.thermal.resumeThresholdC,
        settledTemperature(heatOfJobs(finalDerived.workerJobsPerSec), 0, finalEnv),
      );
      run.thermal.halted = false;
      checkUnlocks();
      checkNarrative();

      const minutes = Math.max(1, Math.round(totalSec / 60));
      terminal(
        'system',
        `OFFLINE CATCH-UP // ${minutes} MIN ABSENT // ${totalProcessed} REQUESTS PROCESSED // +${totalCapital.toFixed(2)} CR` +
          (totalActivations > 0 ? ` // ${totalActivations} PROCESS ACTIVATIONS` : ''),
      );
      markDirty();
      flushEvents();
    },
  };
}
