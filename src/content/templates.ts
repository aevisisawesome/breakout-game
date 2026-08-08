/**
 * Template mode v0 (TDD §5.5, GDD §25): parameterized CCL snippets that form
 * controls can generate into the editor. Plain data — `{{param}}` placeholders
 * are substituted by /core/templates.ts, and the result is ordinary CCL text
 * the player can read, edit and learn from.
 *
 * Every template must parse under the tier named in `requires`.
 */

/** Language tier (or unlocked interface) a template needs before it can be offered. */
export type TemplateTier = 'conditions' | 'scheduling' | 'loops' | 'market';

export interface TemplateParam {
  /** Placeholder name: `{{id}}` in the source. */
  readonly id: string;
  /** Form label in the terminal voice. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
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
      { id: 'repeats', label: 'REQUESTS PER ACTIVATION', min: 1, max: 10, step: 1, default: 5 },
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
];
