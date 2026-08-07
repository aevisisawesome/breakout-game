/**
 * GameEngine — the single facade the UI talks to (TDD §3.1).
 * Fixed 100 ms timestep (10 Hz), seeded PRNG advanced only inside tick(),
 * actions in / events out. Pure TS: no DOM, no timers, no Math.random.
 */

import { BALANCE } from '../content/balance.ts';
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
import { createPrng } from './prng.ts';
import * as registry from './registry.ts';
import { intervalTicks, intervalsAllowed, newProcessRuntime, scriptRamMb } from './scheduler.ts';
import { clamp } from './util/math.ts';
import type {
  ActionResult,
  DeploymentView,
  GameEngine,
  GameEvent,
  GameSnapshot,
  MetaState,
  PlayerAction,
  ProcessRuntime,
  ProcessView,
  ResourcePool,
  RunState,
  SaveFile,
  TerminalLine,
  TerminalLineKind,
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
      temperature: pool(r.temperatureIdleC, Infinity),
    },
    jobs: { waiting: 0, arrivalAccumulator: 0, lifetimeProcessed: 0, lifetimeClicks: 0 },
    upgrades: {},
    workers: { processAccumulator: 0, overclockRemainingSec: 0 },
    ccl: { editorSource: '', runCount: 0, lastRun: null },
    scheduler: { deployments: [], nextId: 1 },
    unlocks: {
      capitalReadout: false,
      systemReadouts: false,
      editor: false,
      conditions: false,
      scheduler: false,
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
  }

  /** Language tiers currently available to the parser (M4: unlock-gated grammar). */
  function parseOptions(): ParseOptions {
    return { conditions: run.unlocks.conditions, scheduling: run.unlocks.scheduler };
  }

  /** Set a narrative milestone flag; unlocking its entry is left to checkNarrative. */
  function setFlag(flag: NarrativeFlagId): void {
    if (!run.flags.includes(flag)) run.flags.push(flag);
  }

  /** Push arrived jobs into the queue from the fractional accumulator. */
  function applyArrivals(arrivalPerSec: number, dtSec: number): void {
    run.jobs.arrivalAccumulator += arrivalPerSec * dtSec;
    while (run.jobs.arrivalAccumulator >= 1) {
      run.jobs.arrivalAccumulator -= 1;
      if (run.jobs.waiting < BALANCE.jobs.queueCapacity) {
        run.jobs.waiting += 1;
      }
    }
  }

  /** RAM occupied by deployed scripts (TDD §4.3), on top of install footprints. */
  function deployedRamMb(): number {
    return run.scheduler.deployments.reduce((total, dep) => total + dep.ramMb, 0);
  }

  /** Reflect install footprints + deployed scripts into the RAM pool. */
  function applyRamPools(derived: DerivedStats): void {
    run.resources.ram.current = derived.ramUsedMb + deployedRamMb();
    run.resources.ram.capacity = derived.ramCapacityMb;
  }

  /** Outcome of one activation, with the compute actually drawn for it. */
  interface Activation extends CclRunResult {
    computeSpent: number;
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
        return ctx.chargeCompute(n * perOp);
      },
      readStat: (namespace, field) => registry.readStat(ctx, namespace, field),
      statNames: registry.statNames,
      callCommand: (name, args) => registry.callCommand(ctx, name, args),
      commandNames: registry.commandNames,
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
    const result = runStatements(body, host, BALANCE.ccl.maxOpsPerActivation);
    return { ...result, computeSpent: spent() };
  }

  /** Sample a `when` guard. Fuel-metered exactly like a body (TDD §5.3). */
  function runGuard(
    process: Extract<ScheduledProcess, { kind: 'when' }>,
    derived: DerivedStats,
  ): Activation & { value: boolean } {
    const { host, spent } = makeHost(derived, false);
    const result = evalCondition(process.cond, host, BALANCE.ccl.maxOpsPerActivation);
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
        terminal('error', `${STRINGS.scriptPreempted} // ${BALANCE.ccl.maxOpsPerActivation} OPS`);
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

    run.ccl.lastRun = {
      status: result.status,
      opsUsed: result.opsUsed,
      computeSpent,
      commandCalls: result.commandCalls,
      error: result.status === 'error' ? (result.error ?? null) : null,
    };

    // Commands may have processed jobs; re-evaluate reveals and narrative.
    checkUnlocks();
    checkNarrative();
  }

  /** Fold an activation's result into a deployed process's monitor counters. */
  function recordActivation(runtime: ProcessRuntime, result: Activation, counted: boolean): void {
    runtime.opsTotal += result.opsUsed;
    runtime.computeTotal += result.computeSpent;
    runtime.failures += result.commandFailures;
    if (counted) {
      runtime.activations += 1;
      runtime.lastRunTick = run.tick;
    }
    runtime.lastStatus = result.status;
    if (result.status !== 'ok') runtime.aborts += 1;
    runtime.lastError = result.error?.message ?? null;
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
          recordActivation(runtime, runActivation(process.body, derived, false), true);
          continue;
        }

        if (run.tick % s.whenPollTicks !== 0) continue;
        const guard = runGuard(process, derived);
        recordActivation(runtime, guard, false);
        if (guard.status !== 'ok') continue; // a guard that cannot run leaves the edge alone
        const rising = guard.value && !runtime.lastCondition;
        runtime.lastCondition = guard.value;
        if (rising) {
          recordActivation(runtime, runActivation(process.body, derived, false), true);
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

  /** One fixed 100 ms step. The ONLY place the PRNG advances (TDD §4.2). */
  function stepOnce(): void {
    const rng = createPrng(run.rngState);
    run.tick += 1;
    const dtSec = TICK_MS / 1000;
    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const w = BALANCE.workers;

    // Script activations run first in the tick: the queued RUN press, then the
    // deployed processes in slot order (TDD §5.3).
    if (pendingProgram) {
      const program = pendingProgram;
      pendingProgram = null;
      executeProgram(program, derived);
    }
    if (run.scheduler.deployments.length > 0) {
      const before = run.jobs.lifetimeProcessed;
      stepScheduler(derived);
      if (run.jobs.lifetimeProcessed > before) {
        checkUnlocks();
        checkNarrative();
      }
    }

    applyArrivals(derived.arrivalPerSec, dtSec);

    // Click overclock decay.
    const workers = run.workers;
    const overclockActive = workers.overclockRemainingSec > 0;
    if (overclockActive) {
      workers.overclockRemainingSec = Math.max(0, workers.overclockRemainingSec - dtSec);
    }

    // Inference daemons (TDD §4.4): process queued jobs, drawing compute overhead
    // and draining energy while working. Empty energy throttles throughput.
    const compute = run.resources.compute;
    const energy = run.resources.energy;
    const energyEmpty = energy.current <= 0;
    const rateMult =
      (overclockActive ? w.overclock.multiplier : 1) * (energyEmpty ? w.energyThrottledFactor : 1);
    const effectiveRate = derived.workerJobsPerSec * rateMult;
    // "Working" = daemons exist and the queue is non-empty; drives energy drain + rate display.
    const working = derived.workerCount > 0 && run.jobs.waiting > 0;
    let processed = 0;
    if (derived.workerCount > 0) {
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
      }
      // Never bank more than one job of credit while starved (queue/compute limits).
      workers.processAccumulator = Math.min(workers.processAccumulator, 1);
    } else {
      workers.processAccumulator = 0;
    }

    // Energy: constant recharge; drain scales with attempted throughput while working.
    const drainPerSec = working ? derived.energyDrainPerSec * rateMult : 0;
    energy.current = clamp(
      energy.current + (derived.energyRegenPerSec - drainPerSec) * dtSec,
      0,
      energy.capacity,
    );

    applyRamPools(derived);

    // Display rates: expected steady rates, not per-tick bursts (daemons land jobs in lumps).
    const netComputePerJob = BALANCE.jobs.computePerJob - w.computeOverheadPerJob;
    const displayRate = working ? effectiveRate : 0;
    compute.ratePerSec = displayRate * netComputePerJob;
    run.resources.capital.ratePerSec = displayRate * BALANCE.jobs.capitalPerJob;
    energy.ratePerSec = derived.energyRegenPerSec - drainPerSec;

    // Inert temperature flicker — visual life only, no gameplay effect (until M7).
    const t = BALANCE.resources;
    run.resources.temperature.current =
      t.temperatureIdleC + (rng.next() * 2 - 1) * t.temperatureFlickerC;

    run.rngState = rng.getState();

    if (processed > 0) {
      checkUnlocks();
      checkNarrative();
    }
  }

  function executeClick(): ActionResult {
    run.jobs.lifetimeClicks += 1;
    terminal('input', `> ${STRINGS.executeInput}`);

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
      terminal('error', STRINGS.queueEmpty);
      return { ok: false, reason: STRINGS.queueEmpty };
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
    applyRamPools(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
    terminal(
      'result',
      `INSTALL COMMITTED // ${def.name} // -${cost.toFixed(2)} CR` +
        (def.ramCostMb > 0 ? ` // RAM +${def.ramCostMb} MB` : ''),
    );
    return { ok: true };
  }

  /** Shared front half of RUN/DEPLOY: access + size checks, then parse. */
  function compileSource(source: string): { program: Program | null; reason?: string } {
    if (!run.unlocks.editor) {
      terminal('error', STRINGS.scriptNoAccess);
      return { program: null, reason: STRINGS.scriptNoAccess };
    }
    if (source.length > BALANCE.ccl.maxSourceChars) {
      terminal('error', STRINGS.scriptTooLong);
      return { program: null, reason: STRINGS.scriptTooLong };
    }
    run.ccl.editorSource = source;
    const { program, diagnostics } = parse(source, parseOptions());
    if (program === null) {
      const d = diagnostics[0]!; // parser contract: null program ⇒ at least one diagnostic
      terminal('error', `${STRINGS.syntaxRejected} // LINE ${d.line}: ${d.message}`);
      run.ccl.lastRun = {
        status: 'syntax',
        opsUsed: 0,
        computeSpent: 0,
        commandCalls: 0,
        error: d,
      };
      return { program: null, reason: d.message };
    }
    return { program };
  }

  function runScript(source: string): ActionResult {
    terminal('input', `> ${STRINGS.runInput}`);
    const { program, reason } = compileSource(source);
    if (program === null) return { ok: false, ...(reason !== undefined && { reason }) };
    // RUN executes the top-level body only; `every`/`when` belong to DEPLOY (TDD §5.1).
    if (program.processes.length > 0) {
      terminal('system', STRINGS.runIgnoresProcesses);
    }
    pendingProgram = program;
    run.ccl.runCount += 1;
    return { ok: true };
  }

  function deployScript(source: string): ActionResult {
    terminal('input', `> ${STRINGS.deployInput}`);
    if (!run.unlocks.scheduler) {
      terminal('error', STRINGS.deployNoAccess);
      return { ok: false, reason: STRINGS.deployNoAccess };
    }
    const { program, reason } = compileSource(source);
    if (program === null) return { ok: false, ...(reason !== undefined && { reason }) };

    const reject = (message: string): ActionResult => {
      terminal('error', message);
      return { ok: false, reason: message };
    };
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
    applyRamPools(derived);

    const count = program.processes.length;
    terminal(
      'result',
      `${STRINGS.deployCommitted} // ${name} // ${count} SLOT${count === 1 ? '' : 'S'} // RAM +${ramMb} MB`,
    );
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
    applyRamPools(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
    terminal('result', `${STRINGS.undeployed} // ${removed!.name} // RAM -${removed!.ramMb} MB`);
    return { ok: true };
  }

  /** Rebuild `compiled` from the saved source text (TDD §8: never persist ASTs). */
  function recompileDeployments(): void {
    compiled = new Map();
    const kept: typeof run.scheduler.deployments = [];
    for (const deployment of run.scheduler.deployments) {
      const { program } = parse(deployment.source, { conditions: true, scheduling: true });
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
      }
      markDirty();
      flushEvents();
      return result;
    },

    getSnapshot(): Readonly<GameSnapshot> {
      if (snapshotCache) return snapshotCache;
      const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
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
              aborts: runtime.aborts,
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
          queueCapacity: BALANCE.jobs.queueCapacity,
          batchPerClick: derived.batchPerClick,
          arrivalPerSec: derived.arrivalPerSec,
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
          maxOpsPerActivation: BALANCE.ccl.maxOpsPerActivation,
          runCount: run.ccl.runCount,
          lastRun: run.ccl.lastRun ? { ...run.ccl.lastRun } : null,
          constructs: {
            conditions: run.unlocks.conditions,
            scheduling: run.unlocks.scheduler,
          },
          // API surface is unlock-gated (TDD §5.1): hidden until script access is granted.
          api: run.unlocks.editor
            ? { stats: registry.apiStatViews(), commands: registry.apiCommandViews() }
            : { stats: [], commands: [] },
        },
        scheduler: {
          unlocked: run.unlocks.scheduler,
          slotsTotal: derived.schedulerSlots,
          slotsUsed: run.scheduler.deployments.reduce((n, d) => n + d.processes.length, 0),
          deployments: deploymentViews,
        },
        research: run.research.map((entry) => {
          const content = NARRATIVE_ENTRIES.find((n) => n.id === entry.entryId);
          return {
            ...entry,
            channel: content?.channel ?? 'SYS//UNKNOWN',
            text: content?.text ?? '[RECORD UNAVAILABLE]',
          };
        }),
        terminal: [...run.terminal],
      };
      return snapshotCache;
    },

    subscribe(listener: (events: GameEvent[]) => void): Unsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    save(now: number): SaveFile {
      return {
        version: 4,
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
      applyRamPools(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
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

        totalActivations += runOfflineProcesses(chunk, derived, totalActivations);

        // Arrivals and processing are concurrent within a chunk, so daemons process
        // against the full inflow; the queue cap applies only to the leftover.
        run.jobs.arrivalAccumulator += derived.arrivalPerSec * chunk;
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
          const potential =
            derived.workerJobsPerSec * (fullSec + throttledSec * w.energyThrottledFactor);
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
        run.jobs.waiting = Math.min(BALANCE.jobs.queueCapacity, queued - processed);
      }

      // Deployed processes are due again as soon as play resumes.
      for (const deployment of run.scheduler.deployments) {
        for (const runtime of deployment.processes) runtime.nextDueTick = run.tick;
      }
      applyRamPools(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
      run.resources.temperature.current = BALANCE.resources.temperatureIdleC;
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
