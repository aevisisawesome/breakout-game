/**
 * Scheduler support (M4, TDD §5.3): compiling deployed scripts, pricing their
 * RAM footprint, and converting declared intervals to ticks. Pure functions —
 * the engine owns the state and the per-tick stepping.
 */

import { countNodes, type Program, type ScheduledProcess } from '../ccl/ast.ts';
import { BALANCE } from '../content/balance.ts';
import type { ProcessRuntime } from './types.ts';

/**
 * RAM a deployed script occupies: a fixed base plus a per-AST-node charge
 * (TDD §4.3 "proportional to AST size"). Rounded to whole MB so the readout
 * and the capacity check agree.
 */
export function scriptRamMb(program: Program): number {
  const s = BALANCE.scheduler;
  return Math.ceil(s.scriptRamBaseMb + countNodes(program) * s.scriptRamPerNodeMb);
}

/** Declared interval in ticks. `ticksPerSec` comes from the engine's timestep. */
export function intervalTicks(process: ScheduledProcess, ticksPerSec: number): number {
  if (process.kind !== 'every') return 0;
  const raw = process.unit === 'seconds' ? process.interval * ticksPerSec : process.interval;
  return Math.max(1, Math.round(raw));
}

/** True when every `every` declaration respects the minimum sampling period. */
export function intervalsAllowed(program: Program, ticksPerSec: number): boolean {
  return program.processes.every(
    (process) =>
      process.kind !== 'every' ||
      intervalTicks(process, ticksPerSec) >= BALANCE.scheduler.minIntervalTicks,
  );
}

/** Fresh monitor/runtime state for one declaration. `every` processes fire immediately. */
export function newProcessRuntime(currentTick: number): ProcessRuntime {
  return {
    nextDueTick: currentTick,
    lastCondition: false,
    activations: 0,
    opsTotal: 0,
    computeTotal: 0,
    failures: 0,
    aborts: 0,
    lastStatus: null,
    lastRunTick: null,
    lastError: null,
  };
}
