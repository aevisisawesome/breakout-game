/**
 * Template mode v0 (TDD §5.5, GDD §25): parameterized CCL snippets that form
 * controls can generate into the editor. Plain data — `{{param}}` placeholders
 * are substituted by /core/templates.ts, and the result is ordinary CCL text
 * the player can read, edit and learn from.
 *
 * Every template must parse under the tier named in `requires`.
 */

/** Language tier a template needs before it can be offered. */
export type TemplateTier = 'conditions' | 'scheduling' | 'loops';

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
];
