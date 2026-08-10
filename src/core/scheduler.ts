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

/**
 * Normalize an operator-typed process designation into the system voice
 * (M7.5 WP4b, OP-12). GDD §33.3 is a promise about every player-facing string,
 * and a name the player types is player-facing — so rather than refusing input
 * that is not in voice, the input is *put* in voice: upper-cased, reduced to the
 * characters the terminal already uses, collapsed and cut to a length that fits
 * beside the ordinal. Returns null when nothing usable is left, which is also
 * how the player clears a designation (by submitting an empty field).
 */
export function sanitizeProcessLabel(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BALANCE.scheduler.processLabelMaxChars)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Fresh monitor/runtime state for one declaration. `every` processes fire immediately. */
export function newProcessRuntime(currentTick: number): ProcessRuntime {
  return {
    nextDueTick: currentTick,
    lastCondition: false,
    activations: 0,
    samples: 0,
    opsTotal: 0,
    computeTotal: 0,
    calls: 0,
    failures: 0,
    abortsBudget: 0,
    abortsFuel: 0,
    abortsFault: 0,
    lastStatus: null,
    lastRunTick: null,
    lastError: null,
    lastErrorLine: null,
  };
}
