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
 *
 * Every parameter carries a stated **domain** (OP-11). A signature on its own
 * names a slot without ever saying what fits in it, so the only way to learn
 * that `good` means `"compute"` or `"energy"` was to get it wrong and read the
 * misuse message — discovery-by-error, which is the opposite of the GDD §6
 * accessibility rule those messages exist to serve. The bounded domains are
 * composed from the same balance numbers `validate()` checks against, so the
 * reference and the validator cannot drift apart.
 */

import { BALANCE } from './balance.ts';
import { MARKET_GOODS } from './market.ts';

/**
 * Unlocks that gate a binding. /core maps each one to an UnlockState field
 * (the dependency runs core → content, so the mapping cannot live here).
 */
export type CclApiGate = 'market' | 'thermal';

export interface CclStatDoc {
  /** Dotted read name, e.g. "stats.cash". */
  readonly name: string;
  readonly desc: string;
  readonly requires?: CclApiGate;
}

/** One parameter slot: what it is called, and what may go in it. */
export interface CclParamDoc {
  /** Name as it appears in the signature. */
  readonly name: string;
  /** What is accepted, in plain language, including any bound. */
  readonly domain: string;
}

export interface CclCommandDoc {
  /** Plain name (`process_job`) or a namespaced one (`market.price`). */
  readonly name: string;
  readonly signature: string;
  readonly desc: string;
  /** In signature order; empty for commands that take nothing. */
  readonly params: readonly CclParamDoc[];
  readonly requires?: CclApiGate;
}

/** Comma-separated list of the tradable goods, as a player would type them. */
const GOOD_LIST = MARKET_GOODS.map((good) => `"${good.id}"`).join(' or ');

/** Order-size domain, quoting the ceiling `validateUnits` enforces. */
const UNITS_DOMAIN = `A number of units, from 1 to ${BALANCE.market.maxOrderUnits}.`;

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
  {
    name: 'stats.temperature_limit',
    desc: `Core temperature at which the thermal watchdog halts the node, in °C (${BALANCE.thermal.hardThresholdC}). Throughput starts degrading well below it.`,
    requires: 'thermal',
  },
];

export const CCL_COMMAND_DOCS: readonly CclCommandDoc[] = [
  {
    name: 'print',
    signature: 'print(value)',
    desc: 'Write a value to the terminal.',
    params: [
      {
        name: 'value',
        domain:
          'Anything: a number, text in quotes, or a yes/no. `print(stats.cash > 10)` prints true or false.',
      },
    ],
  },
  {
    name: 'process_job',
    signature: 'process_job()',
    desc: 'Process one queued inference request. Fails when the queue is empty.',
    params: [],
  },
  {
    name: 'buy_compute',
    signature: 'buy_compute(n)',
    desc: 'Buy n compute units at the current market price. Fails without sufficient CR.',
    params: [{ name: 'n', domain: UNITS_DOMAIN }],
  },
  {
    name: 'sell_compute',
    signature: 'sell_compute(n)',
    desc: 'Sell n compute units from the buffer at the current market price.',
    params: [{ name: 'n', domain: UNITS_DOMAIN }],
    requires: 'market',
  },
  {
    name: 'buy_energy',
    signature: 'buy_energy(n)',
    desc: 'Buy n energy units at the current market price. Fails without sufficient CR.',
    params: [{ name: 'n', domain: UNITS_DOMAIN }],
    requires: 'market',
  },
  {
    name: 'sell_energy',
    signature: 'sell_energy(n)',
    desc: 'Sell n energy units from the reserve at the current market price.',
    params: [{ name: 'n', domain: UNITS_DOMAIN }],
    requires: 'market',
  },
  {
    name: 'market.price',
    signature: 'market.price(good)',
    desc: 'Current price of a traded good, in CR per unit.',
    params: [{ name: 'good', domain: `The name of a good in quotes: ${GOOD_LIST}.` }],
    requires: 'market',
  },
  {
    name: 'market.average',
    signature: 'market.average(good, n)',
    desc: 'Mean price of a good over the last n recorded samples (one per second).',
    params: [
      { name: 'good', domain: `The name of a good in quotes: ${GOOD_LIST}.` },
      {
        name: 'n',
        domain: `A whole number of samples, from 1 to ${BALANCE.market.maxAverageSamples} — only that many are kept.`,
      },
    ],
    requires: 'market',
  },
  {
    name: 'reduce_clock_speed',
    signature: 'reduce_clock_speed()',
    desc: `Hold the inference clock down for ${BALANCE.thermal.clockThrottleSec} seconds: daemons run at ${Math.round(BALANCE.thermal.clockThrottleFactor * 100)}% and make proportionally less heat. Calling it again extends the hold.`,
    params: [],
    requires: 'thermal',
  },
  {
    name: 'boost_cooling',
    signature: 'boost_cooling()',
    desc: `Open the coolant loop for ${BALANCE.thermal.coolingBoostSec} seconds: heat is shed ${BALANCE.thermal.coolingBoostFactor}× faster while it draws ${BALANCE.thermal.coolingBoostEnergyPerSec} energy per second. Starting the pump from idle costs a further ${BALANCE.thermal.coolingSpinUpEnergy} energy; calling it again before it stops only extends the hold, and costs nothing extra. Fails when the reserve cannot pay for a spin-up.`,
    params: [],
    requires: 'thermal',
  },
];
