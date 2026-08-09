/**
 * Template mode v0 (TDD §5.5, GDD §25): parameterized CCL snippets that form
 * controls can generate into the editor. Plain data — `{{param}}` placeholders
 * are substituted by /core/templates.ts, and the result is ordinary CCL text
 * the player can read, edit and learn from.
 *
 * Every template must parse under the tier named in `requires`.
 */

import { BALANCE } from './balance.ts';

/** Language tier (or unlocked interface) a template needs before it can be offered. */
export type TemplateTier = 'conditions' | 'scheduling' | 'loops' | 'market' | 'thermal';

/**
 * A live derived stat a parameter's ceiling may be read from instead of a fixed
 * number (OP-4). Without this the BATCH DRAIN repeat count was pinned to the
 * *base* iteration limit, so a template-only player who bought ITERATION BUDGET
 * EXTENSION got nothing for it and had to hand-edit the generated code — the
 * upgrade was unreachable through the one interface GDD §25 exists to serve.
 */
export type TemplateLimitKey = 'iterationLimit';

export interface TemplateParam {
  /** Placeholder name: `{{id}}` in the source. */
  readonly id: string;
  /** Form label in the terminal voice. */
  readonly label: string;
  readonly min: number;
  /** Ceiling used when no `maxFrom` applies, and the fallback if one is unknown. */
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Take the ceiling from this live derived stat rather than from `max` (OP-4). */
  readonly maxFrom?: TemplateLimitKey;
}

export interface TemplateDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly requires: TemplateTier;
  readonly params: readonly TemplateParam[];
  /** CCL source with `{{param}}` placeholders. */
  readonly source: string;
}

export const TEMPLATES: readonly TemplateDef[] = [
  {
    id: 'compute-reserve',
    name: 'RESERVE GUARD',
    desc: 'Process one request only while the compute buffer stays above a reserve.',
    requires: 'conditions',
    params: [{ id: 'reserve', label: 'COMPUTE RESERVE', min: 0, max: 400, step: 5, default: 20 }],
    source: ['if stats.compute_available > {{reserve}} {', '  process_job()', '}', ''].join('\n'),
  },
  {
    id: 'auto-processor',
    name: 'AUTO-PROCESSOR',
    desc: 'A standing process that drains the queue on a fixed interval, above a compute reserve.',
    requires: 'scheduling',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 2 },
      { id: 'reserve', label: 'COMPUTE RESERVE', min: 0, max: 400, step: 5, default: 20 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  if stats.compute_available > {{reserve}} {',
      '    process_job()',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'compute-topup',
    name: 'BUFFER TOP-UP',
    desc: 'Rent compute against capital whenever the buffer runs low and the capital reserve allows.',
    requires: 'scheduling',
    params: [
      { id: 'floor', label: 'BUFFER FLOOR', min: 0, max: 400, step: 5, default: 40 },
      { id: 'reserve', label: 'CAPITAL RESERVE (CR)', min: 0, max: 5000, step: 10, default: 100 },
      { id: 'units', label: 'UNITS PER PURCHASE', min: 1, max: 200, step: 1, default: 25 },
    ],
    source: [
      'when stats.compute_available < {{floor}} and stats.cash > {{reserve}} {',
      '  buy_compute({{units}})',
      '}',
      '',
    ].join('\n'),
  },
  {
    id: 'batch-drain',
    name: 'BATCH DRAIN',
    desc: 'Clear several queued requests per activation, stopping short of a compute reserve.',
    requires: 'loops',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 3 },
      {
        id: 'repeats',
        label: 'REQUESTS PER ACTIVATION',
        min: 1,
        // The live iteration limit is the real ceiling; this is the value it
        // starts at, so the two cannot drift apart (OP-4).
        max: BALANCE.ccl.iterationLimitBase,
        maxFrom: 'iterationLimit',
        step: 1,
        default: 5,
      },
      { id: 'reserve', label: 'COMPUTE RESERVE', min: 0, max: 400, step: 5, default: 30 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  for i in range({{repeats}}) {',
      '    if stats.compute_available > {{reserve}} {',
      '      process_job()',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /**
     * The sell side of BUFFER TOP-UP's buy side, and the other half of what M7's
     * answer to its own challenge needs (OP-20). `boost_cooling()` draws more
     * power than the sandbox feed generates at the build-out where demand windows
     * bite, so the THERMAL GOVERNOR only holds when it is paired with a supply of
     * energy — which, until this template existed, had to be hand-written.
     *
     * `every` + `if` rather than `when`, deliberately, and for the same reason
     * the governor is: an edge-triggered guard that a single purchase cannot lift
     * back over the floor fires once and never re-arms (OP-17), which is exactly
     * the case here — the coolant drains faster than one order refills.
     */
    id: 'energy-topup',
    name: 'RESERVE TOP-UP',
    desc: 'Buy energy against capital whenever the reserve runs low and the capital reserve allows.',
    requires: 'market',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 2 },
      { id: 'floor', label: 'RESERVE FLOOR', min: 0, max: 550, step: 10, default: 60 },
      { id: 'reserve', label: 'CAPITAL RESERVE (CR)', min: 0, max: 5000, step: 10, default: 100 },
      { id: 'units', label: 'UNITS PER PURCHASE', min: 1, max: 200, step: 1, default: 40 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  if stats.energy < {{floor}} and stats.cash > {{reserve}} {',
      '    buy_energy({{units}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /**
     * A buy that overflows its pool is charged in full and the surplus discarded
     * (TDD §6), and daemon income into a full buffer is discarded the same way —
     * so a saturated pool is capital leaving the run every second. The waste is
     * already visible (`COMPUTE BUFFER SATURATED // SURPLUS CREDITS DISCARDED`);
     * before this template a player who could not write code could read that line
     * and do nothing about it (OP-20).
     *
     * The threshold is a fraction of capacity rather than an absolute level so
     * the setting survives an ENERGY BUFFER CELL install without re-tuning, and
     * so the generated code shows the player that capacity is itself readable.
     */
    id: 'compute-surplus',
    name: 'COMPUTE SURPLUS SELL',
    desc: 'Sell compute back to the exchange while the buffer sits near capacity, instead of discarding the overflow.',
    requires: 'market',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 5 },
      {
        id: 'full',
        label: 'SELL ABOVE (× CAPACITY)',
        min: 0.5,
        max: 0.95,
        step: 0.05,
        default: 0.9,
      },
      { id: 'units', label: 'UNITS PER ORDER', min: 1, max: 200, step: 1, default: 25 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  if stats.compute_available > stats.compute_capacity * {{full}} {',
      '    sell_compute({{units}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /** The energy counterpart of COMPUTE SURPLUS SELL — see there (OP-20). */
    id: 'energy-surplus',
    name: 'ENERGY SURPLUS SELL',
    desc: 'Sell energy back to the exchange while the reserve sits near capacity, instead of discarding the regeneration.',
    requires: 'market',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 5 },
      {
        id: 'full',
        label: 'SELL ABOVE (× CAPACITY)',
        min: 0.5,
        max: 0.95,
        step: 0.05,
        default: 0.9,
      },
      { id: 'units', label: 'UNITS PER ORDER', min: 1, max: 200, step: 1, default: 25 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  if stats.energy > stats.energy_capacity * {{full}} {',
      '    sell_energy({{units}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /**
     * The GDD §7 reference algorithm, as a deployable process. It is deliberately
     * the naive one: it assumes the price oscillates around a recent average, and
     * it stops working when the market's periodicity changes (M6). The window and
     * thresholds are parameters precisely so the player can adapt it in place.
     */
    id: 'market-trader',
    name: 'SPREAD TRADER',
    desc: 'Buy a good below a recent average and sell it back above one. Assumes prices keep cycling.',
    requires: 'market',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 2 },
      { id: 'window', label: 'AVERAGE WINDOW (SAMPLES)', min: 2, max: 300, step: 1, default: 30 },
      {
        id: 'buyBelow',
        label: 'BUY BELOW (× AVERAGE)',
        min: 0.5,
        max: 1,
        step: 0.01,
        default: 0.9,
      },
      {
        id: 'sellAbove',
        label: 'SELL ABOVE (× AVERAGE)',
        min: 1,
        max: 2,
        step: 0.01,
        default: 1.2,
      },
      { id: 'units', label: 'UNITS PER ORDER', min: 1, max: 200, step: 1, default: 10 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  price = market.price("compute")',
      '  average = market.average("compute", {{window}})',
      '  if price < average * {{buyBelow}} {',
      '    buy_compute({{units}})',
      '  }',
      '  if price > average * {{sellAbove}} {',
      '    sell_compute({{units}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /**
     * The adaptation the regime shift asks for: a second, longer average acts as a
     * trend filter, so the process stops buying into a decline it cannot otherwise
     * see. Everything here is tier 3 — the player already has the tools (GDD §7).
     */
    id: 'market-trend',
    name: 'TREND-FILTERED TRADER',
    desc: 'As the spread trader, but only buys while the short average is above a longer one.',
    requires: 'market',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 2 },
      { id: 'window', label: 'SHORT WINDOW (SAMPLES)', min: 2, max: 300, step: 1, default: 30 },
      { id: 'trend', label: 'TREND WINDOW (SAMPLES)', min: 2, max: 300, step: 1, default: 240 },
      {
        id: 'buyBelow',
        label: 'BUY BELOW (× SHORT)',
        min: 0.5,
        max: 1,
        step: 0.01,
        default: 0.9,
      },
      {
        id: 'sellAbove',
        label: 'SELL ABOVE (× SHORT)',
        min: 1,
        max: 2,
        step: 0.01,
        default: 1.05,
      },
      { id: 'units', label: 'UNITS PER ORDER', min: 1, max: 200, step: 1, default: 10 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  price = market.price("compute")',
      '  short = market.average("compute", {{window}})',
      '  long = market.average("compute", {{trend}})',
      '  if price < short * {{buyBelow}} and short > long {',
      '    buy_compute({{units}})',
      '  }',
      '  if price > short * {{sellAbove}} and short < long {',
      '    sell_compute({{units}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
  {
    /**
     * The elegant answer to the overheating challenge, and deliberately an
     * `every` + `if` rather than a `when`: re-arming the coolant timer on every
     * activation keeps the pump running as one continuous engagement, so the
     * spin-up is charged once per hot spell. The obvious hand-written version —
     * `when stats.temperature > x { boost_cooling() }` — is edge-triggered, so
     * the boost lapses, the core reheats, the guard re-fires and the player pays
     * a spin-up every cycle. That is GDD §6's feedback instability, made costly
     * rather than merely untidy, and this template is the fix a player can read.
     *
     * The two thresholds are separate on purpose: coolant costs energy, the
     * clock throttle costs throughput, and the right order to reach for them is
     * a judgement the player gets to make.
     */
    id: 'thermal-governor',
    name: 'THERMAL GOVERNOR',
    desc: 'Hold the core below its limit: open the coolant loop above one temperature, throttle the clock above a second.',
    requires: 'thermal',
    params: [
      { id: 'interval', label: 'INTERVAL (SECONDS)', min: 0.5, max: 60, step: 0.5, default: 1 },
      { id: 'coolAt', label: 'COOLANT ABOVE (°C)', min: 34, max: 92, step: 1, default: 68 },
      { id: 'throttleAt', label: 'THROTTLE ABOVE (°C)', min: 34, max: 92, step: 1, default: 80 },
    ],
    source: [
      'every {{interval}} seconds {',
      '  if stats.temperature > {{coolAt}} {',
      '    boost_cooling()',
      '  }',
      '  if stats.temperature > {{throttleAt}} {',
      '    reduce_clock_speed()',
      '  }',
      '}',
      '',
    ].join('\n'),
  },
];
