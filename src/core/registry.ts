/**
 * CCL API registry (TDD §5.1): binds the documented read/command names from
 * /content/cclApi.ts to implementations over run state. Drives the interpreter
 * host, editor autocomplete and the in-game reference panel. Command compute
 * costs come from /content/balance.ts (TDD §11 — no balance literals here).
 *
 * Bindings are unlock-gated: a doc's `requires` names an unlock, and a locked
 * binding is hidden from the surface and explains its tier when a script uses
 * it (M6). Namespaced calls such as `market.price` live in the same command
 * table, keyed by their dotted name.
 */

import { BALANCE } from '../content/balance.ts';
import { CCL_COMMAND_DOCS, CCL_STAT_DOCS, type CclApiGate } from '../content/cclApi.ts';
import type { MarketGoodId } from '../content/market.ts';
import { STRINGS } from '../content/strings.ts';
import { formatCclValue, type CclCommandOutcome, type CclValue } from '../ccl/interpreter.ts';
import type { DerivedStats } from './derived.ts';
import { averagePrice, MARKET_GOOD_IDS, quoteBuy, quoteSell, settlementPrice } from './market.ts';
import type {
  CclApiCommandView,
  CclApiStatView,
  MarketState,
  RunState,
  TerminalLineKind,
  UnlockState,
} from './types.ts';

/** Balance-defined per-invocation compute costs, widened for by-name lookup. */
const COMMAND_COSTS: Readonly<Record<string, number>> = BALANCE.ccl.commandCosts;

/** Which UnlockState field each content-declared gate maps to (core → content, §3). */
const GATE_UNLOCKS: Readonly<Record<CclApiGate, keyof UnlockState>> = { market: 'market' };

function gateOpen(unlocks: UnlockState, gate: CclApiGate | undefined): boolean {
  return gate === undefined || unlocks[GATE_UNLOCKS[gate]];
}

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
  'stats.compute_capacity': (ctx) => ctx.run.resources.compute.capacity,
  'stats.energy_capacity': (ctx) => ctx.run.resources.energy.capacity,
};

/** Gate for a documented name, or undefined when it is ungated (or undocumented). */
function gateOf(name: string): CclApiGate | undefined {
  return (
    CCL_STAT_DOCS.find((doc) => doc.name === name)?.requires ??
    CCL_COMMAND_DOCS.find((doc) => doc.name === name)?.requires
  );
}

export function readStat(ctx: CommandCtx, namespace: string, field: string): CclValue | undefined {
  const name = `${namespace}.${field}`;
  if (!gateOpen(ctx.run.unlocks, gateOf(name))) return undefined;
  return STAT_READS[name]?.(ctx);
}

export function statNames(unlocks: UnlockState): readonly string[] {
  return CCL_STAT_DOCS.filter((doc) => gateOpen(unlocks, doc.requires)).map((doc) => doc.name);
}

/**
 * Diegetic message for a documented binding the player has not unlocked yet,
 * or null when the name is simply unknown. The interpreter uses this so a
 * locked name explains its tier instead of reading as a typo.
 */
export function lockedBinding(unlocks: UnlockState, name: string): string | null {
  const gate = gateOf(name);
  if (gate === undefined || gateOpen(unlocks, gate)) return null;
  return STRINGS.bindingLocked.replace('{name}', name);
}

// ---------------------------------------------------------------------------
// Commands

interface CommandImpl {
  /** Returns a plain-language misuse message for bad arguments, else null. */
  validate(args: readonly CclValue[]): string | null;
  /** Runs after validation and cost charging. */
  exec(ctx: CommandCtx, args: readonly CclValue[]): CclCommandOutcome;
}

/** Shared argument checks for the trade commands. */
function validateUnits(name: string, args: readonly CclValue[]): string | null {
  if (args.length !== 1) return `${name}(n) takes exactly one value: how many units.`;
  const n = args[0];
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    return `${name}(n) needs a positive number of units.`;
  }
  if (n > BALANCE.market.maxOrderUnits) {
    return `${name}(n) cannot order more than ${BALANCE.market.maxOrderUnits} units at once.`;
  }
  return null;
}

function validateGood(name: string, value: CclValue): string | null {
  if (typeof value !== 'string') {
    return `${name} needs the name of a good in quotes, like "compute".`;
  }
  if (!(MARKET_GOOD_IDS as readonly string[]).includes(value)) {
    return `"${value}" is not traded here. Known goods: ${MARKET_GOOD_IDS.join(', ')}.`;
  }
  return null;
}

/** The market exists only once the exchange is mounted; null before that. */
function marketOf(ctx: CommandCtx): MarketState | null {
  return ctx.run.market;
}

/** Record a filled order against the market's lifetime totals, when there is one. */
function recordTrade(market: MarketState | null, spent: number, earned: number): void {
  if (market === null) return;
  market.spent += spent;
  market.earned += earned;
  market.trades += 1;
}

/**
 * One side of a trade against a resource pool. Buys that overflow the pool are
 * charged in full and the surplus is discarded — the same rule manual clicks
 * have always had, and the failure the market is meant to teach.
 */
function tradePool(
  ctx: CommandCtx,
  id: MarketGoodId,
  side: 'buy' | 'sell',
  units: number,
  poolKey: 'compute' | 'energy',
  saturatedMessage: string,
): CclCommandOutcome {
  const market = marketOf(ctx);
  const price = settlementPrice(market, id);
  const pool = ctx.run.resources[poolKey];
  const capital = ctx.run.resources.capital;
  const label = side === 'buy' ? `BUY_${id.toUpperCase()}` : `SELL_${id.toUpperCase()}`;

  if (side === 'buy') {
    const quote = quoteBuy(price, units);
    if (capital.current < quote.total) {
      ctx.emit('error', `${label} REJECTED // ${STRINGS.cmdNoCapital}`);
      return { kind: 'failed' };
    }
    capital.current -= quote.total;
    recordTrade(market, quote.total, 0);
    const saturated = pool.current + units > pool.capacity;
    pool.current = Math.min(pool.capacity, pool.current + units);
    if (saturated) ctx.emit('system', saturatedMessage);
    return { kind: 'ok', value: true };
  }

  if (pool.current < units) {
    ctx.emit('error', `${label} REJECTED // ${STRINGS.cmdNoStock}`);
    return { kind: 'failed' };
  }
  const quote = quoteSell(price, units);
  pool.current -= units;
  capital.current += quote.total;
  recordTrade(market, 0, quote.total);
  return { kind: 'ok', value: true };
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
    validate: (args) => validateUnits('buy_compute', args),
    exec: (ctx, args) =>
      tradePool(ctx, 'compute', 'buy', args[0] as number, 'compute', STRINGS.computeSaturated),
  },

  sell_compute: {
    validate: (args) => validateUnits('sell_compute', args),
    exec: (ctx, args) =>
      tradePool(ctx, 'compute', 'sell', args[0] as number, 'compute', STRINGS.computeSaturated),
  },

  buy_energy: {
    validate: (args) => validateUnits('buy_energy', args),
    exec: (ctx, args) =>
      tradePool(ctx, 'energy', 'buy', args[0] as number, 'energy', STRINGS.energySaturated),
  },

  sell_energy: {
    validate: (args) => validateUnits('sell_energy', args),
    exec: (ctx, args) =>
      tradePool(ctx, 'energy', 'sell', args[0] as number, 'energy', STRINGS.energySaturated),
  },

  'market.price': {
    validate(args) {
      if (args.length !== 1) return 'market.price(good) takes exactly one value, like "compute".';
      return validateGood('market.price(good)', args[0] ?? null);
    },
    exec(ctx, args) {
      const market = marketOf(ctx);
      if (market === null) return { kind: 'failed' };
      return { kind: 'ok', value: market.price[args[0] as MarketGoodId] ?? 0 };
    },
  },

  'market.average': {
    validate(args) {
      if (args.length !== 2) {
        return 'market.average(good, n) takes two values: the good, and how many samples.';
      }
      const good = validateGood('market.average(good, n)', args[0] ?? null);
      if (good !== null) return good;
      const n = args[1];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) {
        return 'market.average(good, n) needs a whole number of samples, at least 1.';
      }
      if (n > BALANCE.market.maxAverageSamples) {
        return `Only the last ${BALANCE.market.maxAverageSamples} price samples are kept.`;
      }
      return null;
    },
    exec(ctx, args) {
      const market = marketOf(ctx);
      if (market === null) return { kind: 'failed' };
      return {
        kind: 'ok',
        value: averagePrice(market, args[0] as MarketGoodId, args[1] as number),
      };
    },
  },
};

export function callCommand(
  ctx: CommandCtx,
  name: string,
  args: readonly CclValue[],
): CclCommandOutcome | undefined {
  const impl = COMMAND_IMPLS[name];
  if (!impl || !gateOpen(ctx.run.unlocks, gateOf(name))) return undefined;
  const misuse = impl.validate(args);
  if (misuse !== null) return { kind: 'misuse', message: misuse };
  const cost = COMMAND_COSTS[name] ?? 0;
  if (cost > 0 && !ctx.chargeCompute(cost)) {
    ctx.emit('error', `${name.toUpperCase()} REJECTED // ${STRINGS.cmdNoCompute}`);
    return { kind: 'failed' };
  }
  return impl.exec(ctx, args);
}

export function commandNames(unlocks: UnlockState): readonly string[] {
  return CCL_COMMAND_DOCS.filter((doc) => gateOpen(unlocks, doc.requires)).map((doc) => doc.name);
}

// ---------------------------------------------------------------------------
// Display surface (snapshot: reference panel + autocomplete)

export function apiStatViews(unlocks: UnlockState): readonly CclApiStatView[] {
  return CCL_STAT_DOCS.filter((doc) => gateOpen(unlocks, doc.requires)).map((doc) => ({
    name: doc.name,
    desc: doc.desc,
  }));
}

export function apiCommandViews(unlocks: UnlockState): readonly CclApiCommandView[] {
  return CCL_COMMAND_DOCS.filter((doc) => gateOpen(unlocks, doc.requires)).map((doc) => ({
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
