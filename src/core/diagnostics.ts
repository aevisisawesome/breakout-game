/**
 * Plain-language failure reports (M5, GDD §6 / TDD §5.4). Turns a process's
 * counters into one report saying what happened and where to look. The wording
 * lives in /content/diagnosis.ts and the thresholds in /content/balance.ts —
 * this file only decides which report applies and fills the placeholders.
 */

import { BALANCE } from '../content/balance.ts';
import { DIAGNOSES, type DiagnosisId } from '../content/diagnosis.ts';
import type { DiagnosisView } from './types.ts';

/** Everything a diagnosis is allowed to look at. */
export interface DiagnosisInput {
  kind: 'every' | 'when' | 'run';
  activations: number;
  /** Guard samples taken (`when` only). */
  samples: number;
  computeTotal: number;
  calls: number;
  failures: number;
  abortsBudget: number;
  abortsFuel: number;
  abortsFault: number;
  lastError: string | null;
  lastErrorLine: number | null;
  /** Op budget in force, quoted in the preemption report. */
  opBudget: number;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

function report(id: DiagnosisId, values: Readonly<Record<string, string>>): DiagnosisView {
  const text = DIAGNOSES[id];
  return {
    id,
    headline: text.headline,
    finding: fill(text.finding, values),
    suggestion: text.suggestion,
  };
}

/** Round for display without dragging a formatter into /core. */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The single most useful report for this process, or null when nothing is wrong.
 * Order is by how much it costs the player: a fault does no work at all, then
 * preemption (work started and thrown away), then starvation, then rejected
 * commands, then a guard that has never once fired.
 */
export function diagnose(input: DiagnosisInput): DiagnosisView | null {
  const t = BALANCE.telemetry;
  const { activations, abortsBudget, abortsFuel, abortsFault } = input;
  // Every fuel-metered attempt the process has made: body activations plus, for a
  // `when` process, its guard samples. Aborts are a subset of these, not extra —
  // an aborted activation is still counted in `activations`.
  const attempts = activations + input.samples;

  if (abortsFault > 0 && input.lastError !== null) {
    return report('fault', {
      message: input.lastError,
      line: input.lastErrorLine === null ? '?' : String(input.lastErrorLine),
    });
  }

  const enoughRuns = attempts >= t.minActivationsForDiagnosis;
  if (enoughRuns && abortsBudget / attempts > t.abortRatioWarn) {
    return report('budget', {
      aborts: String(abortsBudget),
      activations: String(attempts),
      budget: String(input.opBudget),
      computeTotal: num(input.computeTotal),
    });
  }
  if (enoughRuns && abortsFuel / attempts > t.abortRatioWarn) {
    return report('fuel', { aborts: String(abortsFuel), activations: String(attempts) });
  }
  if (input.calls > 0 && input.failures / input.calls > t.failureRatioWarn) {
    return report('rejections', {
      failures: String(input.failures),
      calls: String(input.calls),
      activations: String(activations),
    });
  }
  if (input.kind === 'when' && activations === 0 && input.samples >= t.minActivationsForDiagnosis) {
    return report('silent', { samples: String(input.samples) });
  }
  return null;
}
