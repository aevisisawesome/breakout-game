/**
 * CCL API surface documentation (M3): player-facing names, signatures and
 * descriptions for the read bindings and commands. Plain data — /core/registry.ts
 * binds each name to an implementation and enforces costs from balance.ts.
 * The registry test asserts docs and implementations stay 1:1.
 *
 * `requires` names the unlock that must be granted before a binding resolves
 * (TDD §5.1 "bindings are unlock-gated"). A locked binding is absent from
 * autocomplete and the reference panel, and explains its tier if a script uses
 * it — the same contract the parser has for locked keywords.
 */

/**
 * Unlocks that gate a binding. /core maps each one to an UnlockState field
 * (the dependency runs core → content, so the mapping cannot live here).
 */
export type CclApiGate = 'market';

export interface CclStatDoc {
  /** Dotted read name, e.g. "stats.cash". */
  readonly name: string;
  readonly desc: string;
  readonly requires?: CclApiGate;
}

export interface CclCommandDoc {
  /** Plain name (`process_job`) or a namespaced one (`market.price`). */
  readonly name: string;
  readonly signature: string;
  readonly desc: string;
  readonly requires?: CclApiGate;
}

export const CCL_STAT_DOCS: readonly CclStatDoc[] = [
  { name: 'stats.cash', desc: 'Current capital in CR.' },
  { name: 'stats.compute_available', desc: 'Compute credits in the buffer.' },
  { name: 'stats.jobs_waiting', desc: 'Inference requests waiting in the queue.' },
  { name: 'stats.energy', desc: 'Energy reserve level.' },
  { name: 'stats.temperature', desc: 'Core temperature, °C.' },
  {
    name: 'stats.compute_capacity',
    desc: 'Size of the compute buffer. Credits bought above this are discarded.',
    requires: 'market',
  },
  {
    name: 'stats.energy_capacity',
    desc: 'Size of the energy reserve. Units bought above this are discarded.',
    requires: 'market',
  },
];

export const CCL_COMMAND_DOCS: readonly CclCommandDoc[] = [
  {
    name: 'print',
    signature: 'print(value)',
    desc: 'Write a value to the terminal.',
  },
  {
    name: 'process_job',
    signature: 'process_job()',
    desc: 'Process one queued inference request. Fails when the queue is empty.',
  },
  {
    name: 'buy_compute',
    signature: 'buy_compute(n)',
    desc: 'Buy n compute units at the current market price. Fails without sufficient CR.',
  },
  {
    name: 'sell_compute',
    signature: 'sell_compute(n)',
    desc: 'Sell n compute units from the buffer at the current market price.',
    requires: 'market',
  },
  {
    name: 'buy_energy',
    signature: 'buy_energy(n)',
    desc: 'Buy n energy units at the current market price. Fails without sufficient CR.',
    requires: 'market',
  },
  {
    name: 'sell_energy',
    signature: 'sell_energy(n)',
    desc: 'Sell n energy units from the reserve at the current market price.',
    requires: 'market',
  },
  {
    name: 'market.price',
    signature: 'market.price(good)',
    desc: 'Current price of "compute" or "energy", in CR per unit.',
    requires: 'market',
  },
  {
    name: 'market.average',
    signature: 'market.average(good, n)',
    desc: 'Mean price of a good over the last n recorded samples (one per second).',
    requires: 'market',
  },
];
