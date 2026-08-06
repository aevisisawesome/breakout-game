/**
 * GameEngine — the single facade the UI talks to (TDD §3.1).
 * Fixed 100 ms timestep (10 Hz), seeded PRNG advanced only inside tick(),
 * actions in / events out. Pure TS: no DOM, no timers, no Math.random.
 */

import { BALANCE, type ProgressStep } from '../content/balance.ts';
import { NARRATIVE_ENTRIES } from '../content/narrative.ts';
import { BOOT_LINES, STRINGS } from '../content/strings.ts';
import { createPrng } from './prng.ts';
import type {
  ActionResult,
  GameEngine,
  GameEvent,
  GameSnapshot,
  MetaState,
  PlayerAction,
  ResourcePool,
  RunState,
  SaveFileV1,
  TerminalLine,
  TerminalLineKind,
  Unsubscribe,
} from './types.ts';

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
    unlocks: { capitalReadout: false, systemReadouts: false },
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

/** Value of a step curve at a given progress point (highest step whose atJobs <= progress). */
export function stepValue(steps: readonly ProgressStep[], progress: number): number {
  let value = steps[0]?.value ?? 0;
  for (const step of steps) {
    if (progress >= step.atJobs) value = step.value;
  }
  return value;
}

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
  }

  /** One fixed 100 ms step. The ONLY place the PRNG advances (TDD §4.2). */
  function stepOnce(): void {
    const rng = createPrng(run.rngState);
    run.tick += 1;

    // Job arrivals: per-second rate stepped by lifetime progress.
    const arrivalPerSec = stepValue(BALANCE.jobs.arrivalPerSec, run.jobs.lifetimeProcessed);
    run.jobs.arrivalAccumulator += arrivalPerSec / TICKS_PER_SEC;
    while (run.jobs.arrivalAccumulator >= 1) {
      run.jobs.arrivalAccumulator -= 1;
      if (run.jobs.waiting < BALANCE.jobs.queueCapacity) {
        run.jobs.waiting += 1;
      }
    }

    // Inert temperature flicker — visual life only, no gameplay effect (M1 placeholder).
    const t = BALANCE.resources;
    run.resources.temperature.current =
      t.temperatureIdleC + (rng.next() * 2 - 1) * t.temperatureFlickerC;

    run.rngState = rng.getState();
  }

  function executeClick(): ActionResult {
    run.jobs.lifetimeClicks += 1;
    terminal('input', `> ${STRINGS.executeInput}`);

    if (run.jobs.waiting < 1) {
      terminal('error', STRINGS.queueEmpty);
      return { ok: false, reason: STRINGS.queueEmpty };
    }

    const batch = stepValue(BALANCE.jobs.batchPerClick, run.jobs.lifetimeProcessed);
    const processed = Math.min(batch, run.jobs.waiting);
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
      }
      markDirty();
      flushEvents();
      return result;
    },

    getSnapshot(): Readonly<GameSnapshot> {
      if (snapshotCache) return snapshotCache;
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
          batchPerClick: stepValue(BALANCE.jobs.batchPerClick, run.jobs.lifetimeProcessed),
          arrivalPerSec: stepValue(BALANCE.jobs.arrivalPerSec, run.jobs.lifetimeProcessed),
          lifetimeProcessed: run.jobs.lifetimeProcessed,
        },
        unlocks: { ...run.unlocks },
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

    save(now: number): SaveFileV1 {
      return {
        version: 1,
        savedAt: now,
        meta: structuredClone(meta),
        run: structuredClone(run),
      };
    },

    load(save: SaveFileV1): void {
      meta = structuredClone(save.meta);
      run = structuredClone(save.run);
      accumulatorMs = 0;
      pushTerminal(run, 'system', STRINGS.saveLoaded);
      markDirty();
      emit({ type: 'STATE_LOADED' });
      flushEvents();
    },
  };
}
