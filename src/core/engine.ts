/**
 * GameEngine — the single facade the UI talks to (TDD §3.1).
 * Fixed 100 ms timestep (10 Hz), seeded PRNG advanced only inside tick(),
 * actions in / events out. Pure TS: no DOM, no timers, no Math.random.
 */

import { BALANCE } from '../content/balance.ts';
import { NARRATIVE_ENTRIES } from '../content/narrative.ts';
import { BOOT_LINES, STRINGS } from '../content/strings.ts';
import { UPGRADES } from '../content/upgrades.ts';
import type { Program } from '../ccl/ast.ts';
import { runProgram, type CclHost } from '../ccl/interpreter.ts';
import { parse } from '../ccl/parser.ts';
import { computeDerived, upgradeCost, type DerivedStats } from './derived.ts';
import { createPrng } from './prng.ts';
import * as registry from './registry.ts';
import { clamp } from './util/math.ts';
import type {
  ActionResult,
  GameEngine,
  GameEvent,
  GameSnapshot,
  MetaState,
  PlayerAction,
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
    unlocks: { capitalReadout: false, systemReadouts: false, editor: false },
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

  /** Unlock any narrative entries whose job threshold has been reached. */
  function checkNarrative(): void {
    for (const entry of NARRATIVE_ENTRIES) {
      if (run.jobs.lifetimeProcessed < entry.atJobs) continue;
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

  /** Reflect install footprints/capacity into the RAM pool (M2: RAM measures installs). */
  function applyRamPools(derived: DerivedStats): void {
    run.resources.ram.current = derived.ramUsedMb;
    run.resources.ram.capacity = derived.ramCapacityMb;
  }

  /**
   * Execute a queued script activation (TDD §5.2): fuel drawn from the compute
   * pool per op-unit, command costs on top, hard per-activation op budget.
   * Runs inside tick(), synchronously — bounded, deterministic, frame-safe.
   */
  function executeProgram(program: Program, derived: DerivedStats): void {
    const compute = run.resources.compute;
    const perOp = BALANCE.ccl.computePerOp;
    let computeSpent = 0;

    const ctx: registry.CommandCtx = {
      run,
      derived,
      emit: terminal,
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

    const result = runProgram(program, host, BALANCE.ccl.maxOpsPerActivation);

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

  /** One fixed 100 ms step. The ONLY place the PRNG advances (TDD §4.2). */
  function stepOnce(): void {
    const rng = createPrng(run.rngState);
    run.tick += 1;
    const dtSec = TICK_MS / 1000;
    const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);
    const w = BALANCE.workers;

    // Queued script activation runs first in the tick (future scheduler slot order, TDD §5.3).
    if (pendingProgram) {
      const program = pendingProgram;
      pendingProgram = null;
      executeProgram(program, derived);
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
    if (def.ramCostMb > 0 && derived.ramUsedMb + def.ramCostMb > derived.ramCapacityMb) {
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

  function runScript(source: string): ActionResult {
    if (!run.unlocks.editor) {
      terminal('error', STRINGS.scriptNoAccess);
      return { ok: false, reason: STRINGS.scriptNoAccess };
    }
    if (source.length > BALANCE.ccl.maxSourceChars) {
      terminal('error', STRINGS.scriptTooLong);
      return { ok: false, reason: STRINGS.scriptTooLong };
    }
    run.ccl.editorSource = source;
    terminal('input', `> ${STRINGS.runInput}`);
    const { program, diagnostics } = parse(source);
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
      return { ok: false, reason: d.message };
    }
    pendingProgram = program;
    run.ccl.runCount += 1;
    return { ok: true };
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
          ramOk: def.ramCostMb === 0 || derived.ramUsedMb + def.ramCostMb <= derived.ramCapacityMb,
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
          // API surface is unlock-gated (TDD §5.1): hidden until script access is granted.
          api: run.unlocks.editor
            ? { stats: registry.apiStatViews(), commands: registry.apiCommandViews() }
            : { stats: [], commands: [] },
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
        version: 3,
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

      // Coarse summary chunks (TDD §4.5): average rates, no overclock, no PRNG draws.
      while (remaining > 0) {
        const chunk = Math.min(remaining, s.offlineChunkSec);
        remaining -= chunk;
        const derived = computeDerived(run.upgrades, run.jobs.lifetimeProcessed);

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

      applyRamPools(computeDerived(run.upgrades, run.jobs.lifetimeProcessed));
      run.resources.temperature.current = BALANCE.resources.temperatureIdleC;
      checkUnlocks();
      checkNarrative();

      const minutes = Math.max(1, Math.round(totalSec / 60));
      terminal(
        'system',
        `OFFLINE CATCH-UP // ${minutes} MIN ABSENT // ${totalProcessed} REQUESTS PROCESSED // +${totalCapital.toFixed(2)} CR`,
      );
      markDirty();
      flushEvents();
    },
  };
}
