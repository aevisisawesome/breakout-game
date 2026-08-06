/**
 * CCL API surface documentation (M3): player-facing names, signatures and
 * descriptions for the read bindings and commands. Plain data — /core/registry.ts
 * binds each name to an implementation and enforces costs from balance.ts.
 * The registry test asserts docs and implementations stay 1:1.
 */

export interface CclStatDoc {
  /** Dotted read name, e.g. "stats.cash". */
  readonly name: string;
  readonly desc: string;
}

export interface CclCommandDoc {
  readonly name: string;
  readonly signature: string;
  readonly desc: string;
}

export const CCL_STAT_DOCS: readonly CclStatDoc[] = [
  { name: 'stats.cash', desc: 'Current capital in CR.' },
  { name: 'stats.compute_available', desc: 'Compute credits in the buffer.' },
  { name: 'stats.jobs_waiting', desc: 'Inference requests waiting in the queue.' },
  { name: 'stats.energy', desc: 'Energy reserve level.' },
  { name: 'stats.temperature', desc: 'Core temperature, °C.' },
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
    desc: 'Rent n compute units against capital. Fails without sufficient CR.',
  },
];
