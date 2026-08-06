/**
 * CCL API registry (TDD §5.1): binds the documented read/command names from
 * /content/cclApi.ts to implementations over run state. Drives the interpreter
 * host, editor autocomplete and the in-game reference panel. Command compute
 * costs come from /content/balance.ts (TDD §11 — no balance literals here).
 */

import { BALANCE } from '../content/balance.ts';
import { CCL_COMMAND_DOCS, CCL_STAT_DOCS } from '../content/cclApi.ts';
import { STRINGS } from '../content/strings.ts';
import { formatCclValue, type CclCommandOutcome, type CclValue } from '../ccl/interpreter.ts';
import type { DerivedStats } from './derived.ts';
import type { CclApiCommandView, CclApiStatView, RunState, TerminalLineKind } from './types.ts';

/** Balance-defined per-invocation compute costs, widened for by-name lookup. */
const COMMAND_COSTS: Readonly<Record<string, number>> = BALANCE.ccl.commandCosts;

/** Execution context handed to command implementations by the engine. */
export interface CommandCtx {
  run: RunState;
  derived: DerivedStats;
  emit(kind: TerminalLineKind, text: string): void;
  /** Draw compute for a command cost; false (and no draw) when unaffordable. */
  chargeCompute(amount: number): boolean;
}

// ---------------------------------------------------------------------------
// Read bindings

const STAT_READS: Record<string, (ctx: CommandCtx) => CclValue> = {
  'stats.cash': (ctx) => ctx.run.resources.capital.current,
  'stats.compute_available': (ctx) => ctx.run.resources.compute.current,
  'stats.jobs_waiting': (ctx) => ctx.run.jobs.waiting,
  'stats.energy': (ctx) => ctx.run.resources.energy.current,
  'stats.temperature': (ctx) => ctx.run.resources.temperature.current,
};

export function readStat(ctx: CommandCtx, namespace: string, field: string): CclValue | undefined {
  return STAT_READS[`${namespace}.${field}`]?.(ctx);
}

export function statNames(): readonly string[] {
  return CCL_STAT_DOCS.map((doc) => doc.name);
}

// ---------------------------------------------------------------------------
// Commands

interface CommandImpl {
  /** Returns a plain-language misuse message for bad arguments, else null. */
  validate(args: readonly CclValue[]): string | null;
  /** Runs after validation and cost charging. */
  exec(ctx: CommandCtx, args: readonly CclValue[]): CclCommandOutcome;
}

const COMMAND_IMPLS: Record<string, CommandImpl> = {
  print: {
    validate: (args) => (args.length === 1 ? null : 'print(...) takes exactly one value.'),
    exec(ctx, args) {
      ctx.emit('result', `:: ${formatCclValue(args[0] ?? null)}`);
      return { kind: 'ok', value: null };
    },
  },

  process_job: {
    validate: (args) => (args.length === 0 ? null : 'process_job() takes no values.'),
    exec(ctx) {
      const { run } = ctx;
      if (run.jobs.waiting < 1) {
        ctx.emit('error', `PROCESS_JOB REJECTED // ${STRINGS.cmdQueueEmpty}`);
        return { kind: 'failed' };
      }
      run.jobs.waiting -= 1;
      run.jobs.lifetimeProcessed += 1;
      const compute = run.resources.compute;
      compute.current = Math.min(compute.capacity, compute.current + BALANCE.jobs.computePerJob);
      run.resources.capital.current += BALANCE.jobs.capitalPerJob;
      return { kind: 'ok', value: true };
    },
  },

  buy_compute: {
    validate(args) {
      if (args.length !== 1)
        return 'buy_compute(n) takes exactly one value: how many units to rent.';
      const n = args[0];
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
        return 'buy_compute(n) needs a positive number of compute units.';
      }
      return null;
    },
    exec(ctx, args) {
      const { run } = ctx;
      const n = args[0] as number;
      const cost = n * BALANCE.ccl.computePricePerUnit;
      if (run.resources.capital.current < cost) {
        ctx.emit('error', `BUY_COMPUTE REJECTED // ${STRINGS.cmdNoCapital}`);
        return { kind: 'failed' };
      }
      run.resources.capital.current -= cost;
      const compute = run.resources.compute;
      const saturated = compute.current + n > compute.capacity;
      compute.current = Math.min(compute.capacity, compute.current + n);
      if (saturated) {
        ctx.emit('system', STRINGS.computeSaturated);
      }
      return { kind: 'ok', value: true };
    },
  },
};

export function callCommand(
  ctx: CommandCtx,
  name: string,
  args: readonly CclValue[],
): CclCommandOutcome | undefined {
  const impl = COMMAND_IMPLS[name];
  if (!impl) return undefined;
  const misuse = impl.validate(args);
  if (misuse !== null) return { kind: 'misuse', message: misuse };
  const cost = COMMAND_COSTS[name] ?? 0;
  if (cost > 0 && !ctx.chargeCompute(cost)) {
    ctx.emit('error', `${name.toUpperCase()} REJECTED // ${STRINGS.cmdNoCompute}`);
    return { kind: 'failed' };
  }
  return impl.exec(ctx, args);
}

export function commandNames(): readonly string[] {
  return CCL_COMMAND_DOCS.map((doc) => doc.name);
}

// ---------------------------------------------------------------------------
// Display surface (snapshot: reference panel + autocomplete)

export function apiStatViews(): readonly CclApiStatView[] {
  return CCL_STAT_DOCS.map((doc) => ({ name: doc.name, desc: doc.desc }));
}

export function apiCommandViews(): readonly CclApiCommandView[] {
  return CCL_COMMAND_DOCS.map((doc) => ({
    name: doc.name,
    signature: doc.signature,
    desc: doc.desc,
    computeCost: COMMAND_COSTS[doc.name] ?? 0,
  }));
}

/** Implementation coverage, for the registry test: every doc has an impl and vice versa. */
export function implementedStatNames(): readonly string[] {
  return Object.keys(STAT_READS);
}

export function implementedCommandNames(): readonly string[] {
  return Object.keys(COMMAND_IMPLS);
}
