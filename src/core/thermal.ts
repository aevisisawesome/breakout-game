/**
 * Thermal model (M7, TDD §4.3). Pure functions over content-defined balance
 * numbers — no state of its own, no clocks, no randomness.
 *
 * The core is a single lumped mass relaxing towards ambient:
 *
 *     dT/dt = heatRate − dissipation × (T − ambient)
 *
 * Work adds heat directly at the point it happens (`heatOfJobs` / `heatOfOps`),
 * which is TDD §4.3's `heat += computeUsed × heatFactor` with "compute used"
 * measured as the work the player can actually see. Dissipation is applied once
 * per tick by `coolTemperature`. The resting temperature of any build-out is
 * therefore `ambient + heatRate / dissipation`, which `equilibriumTemperature`
 * exposes so the pacing tests can pin it.
 */

import { BALANCE } from '../content/balance.ts';
import { clamp } from './util/math.ts';

/** Heat produced by processing `jobs` inference requests, in °C. */
export function heatOfJobs(jobs: number): number {
  return jobs * BALANCE.thermal.heatPerJob;
}

/** Heat produced by executing `ops` interpreter op-units, in °C. */
export function heatOfOps(ops: number): number {
  return ops * BALANCE.thermal.heatPerOp;
}

/**
 * Daemon throughput multiplier at a given temperature (TDD §4.3: "above a soft
 * threshold, compute efficiency degrades linearly"). 1.0 up to the soft
 * threshold, falling linearly to `degradedFloor` at the hard one and no further.
 */
export function thermalEfficiency(temperatureC: number): number {
  const t = BALANCE.thermal;
  if (temperatureC <= t.softThresholdC) return 1;
  const span = t.hardThresholdC - t.softThresholdC;
  const over = clamp((temperatureC - t.softThresholdC) / span, 0, 1);
  return 1 - over * (1 - t.degradedFloor);
}

/**
 * The conditions the core is currently sitting in: ambient, the effective
 * dissipation coefficient (installs × coolant boost × any demand-window derate)
 * and the demand window's effect on inbound requests.
 */
export interface ThermalEnv {
  ambientC: number;
  /** °C shed per second, per °C above ambient. */
  dissipationPerSec: number;
  /** Inbound request rate multiplier. */
  arrivalMult: number;
  demandWindowOpen: boolean;
}

/**
 * Resolve the environment. `coolingPerSec` is the derived passive dissipation
 * (base plus COOLANT LOOP EXPANSION installs); `boostActive` is the coolant
 * boost engaged by `boost_cooling()`.
 */
export function thermalEnv(
  coolingPerSec: number,
  boostActive: boolean,
  demandWindowOpen: boolean,
): ThermalEnv {
  const t = BALANCE.thermal;
  let dissipation = coolingPerSec;
  if (boostActive) dissipation *= t.coolingBoostFactor;
  if (demandWindowOpen) dissipation *= t.spikeDissipationFactor;
  return {
    ambientC: t.ambientC,
    dissipationPerSec: dissipation,
    arrivalMult: demandWindowOpen ? t.spikeArrivalMult : 1,
    demandWindowOpen,
  };
}

/**
 * Apply one step of dissipation. Explicit Euler is stable here by a wide margin
 * (the largest reachable `dissipation × dt` is well under 1) and keeps the model
 * exactly reproducible tick for tick.
 */
export function coolTemperature(temperatureC: number, env: ThermalEnv, dtSec: number): number {
  const shed = env.dissipationPerSec * (temperatureC - env.ambientC) * dtSec;
  return Math.max(env.ambientC, temperatureC - shed);
}

/** Resting temperature for a sustained heat input, in °C. */
export function equilibriumTemperature(heatRatePerSec: number, env: ThermalEnv): number {
  if (env.dissipationPerSec <= 0) return Infinity;
  return env.ambientC + heatRatePerSec / env.dissipationPerSec;
}

/**
 * Resting temperature once the efficiency degradation feedback is accounted for:
 * hotter cores process fewer requests, which produces less heat. `degradableRate`
 * is the part of the heat input that scales with daemon throughput; `fixedRate`
 * is the part that does not (script execution, which the watchdog is the only
 * thing that stops). Solved by fixed-point iteration — the map is a contraction
 * for every reachable parameter set, and the tests pin the results.
 */
export function settledTemperature(
  degradableRate: number,
  fixedRate: number,
  env: ThermalEnv,
): number {
  let temperature = env.ambientC;
  for (let i = 0; i < 64; i++) {
    const heat = degradableRate * thermalEfficiency(temperature) + fixedRate;
    const next = equilibriumTemperature(heat, env);
    if (Math.abs(next - temperature) < 1e-6) return next;
    temperature = temperature + (next - temperature) * 0.5;
  }
  return temperature;
}

/**
 * Sustained request rate the cooling can support without tripping the watchdog.
 * Used by the offline catch-up, where the watchdog cannot be simulated tick by
 * tick: over a coarse chunk its effect *is* this ceiling (TDD §4.5).
 */
export function sustainableJobsPerSec(env: ThermalEnv, scriptHeatPerSec: number): number {
  const t = BALANCE.thermal;
  const budget = env.dissipationPerSec * (t.hardThresholdC - env.ambientC) - scriptHeatPerSec;
  return Math.max(0, budget / t.heatPerJob);
}

/**
 * Is a priority demand window open? Windows begin `spikeFirstAtSec` after the
 * thermal tier is granted and recur on `spikePeriodSec`, so the challenge can be
 * re-attempted — which is what makes "solve it with a script" worth doing.
 * `openedAtTick` is null until the tier is granted.
 */
export function isDemandWindowOpen(
  clockTicks: number,
  openedAtTick: number | null,
  ticksPerSec: number,
): boolean {
  return demandWindowTicksRemaining(clockTicks, openedAtTick, ticksPerSec) > 0;
}

/** Ticks left in the open demand window, or 0 when none is open. */
export function demandWindowTicksRemaining(
  clockTicks: number,
  openedAtTick: number | null,
  ticksPerSec: number,
): number {
  if (openedAtTick === null) return 0;
  const t = BALANCE.thermal;
  const since = clockTicks - openedAtTick - t.spikeFirstAtSec * ticksPerSec;
  if (since < 0) return 0;
  const phase = since % (t.spikePeriodSec * ticksPerSec);
  const duration = t.spikeDurationSec * ticksPerSec;
  return phase < duration ? duration - phase : 0;
}
