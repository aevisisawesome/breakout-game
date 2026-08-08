/**
 * Plain-language failure reports (GDD §6 "important accessibility feature").
 * Templates only — /core/diagnostics.ts decides which one applies and fills the
 * placeholders. The voice is deliberately split: a terminal-voice headline over
 * ordinary sentences, because a non-programmer has to be able to read the fix.
 *
 * Placeholders are `{name}` and are substituted verbatim by /core.
 */

/** Which report applies. Order of preference is decided in /core, not here. */
export type DiagnosisId = 'fault' | 'budget' | 'fuel' | 'rejections' | 'silent';

export interface DiagnosisText {
  /** Terminal-voice headline. */
  readonly headline: string;
  /** What the numbers say happened. */
  readonly finding: string;
  /** Where to look. Never states the fix outright — GDD §6: help, don't solve. */
  readonly suggestion: string;
}

export const DIAGNOSES: Readonly<Record<DiagnosisId, DiagnosisText>> = {
  fault: {
    headline: 'FAULTED',
    finding:
      'The last activation stopped on an error and did no further work: {message} (line {line}).',
    suggestion:
      'The process keeps activating and keeps stopping at the same place. Fix that line, then redeploy.',
  },
  budget: {
    headline: 'PREEMPTED',
    finding:
      '{aborts} of {activations} activations ran out of the {budget}-op execution budget before finishing, spending {computeTotal} compute on work that was thrown away.',
    suggestion:
      'One activation is trying to do more than its budget allows. Look at how many repeats it asks for, or how much it does per repeat — or raise the budget with an EXECUTION BUDGET EXTENSION.',
  },
  fuel: {
    headline: 'STARVED',
    finding:
      '{aborts} of {activations} activations halted because the compute buffer was empty at the time they ran.',
    suggestion:
      'The process is competing for compute with the daemons and with everything else deployed. Consider running it less often, or guarding it so it only acts while the buffer is above a reserve.',
  },
  rejections: {
    headline: 'WASTEFUL',
    finding:
      '{failures} of {calls} command requests were rejected and did nothing, across {activations} activations.',
    suggestion:
      'A rejected request still costs compute. Check what each command needs before calling it — a condition around the call turns a wasted request into a skipped one.',
  },
  silent: {
    headline: 'IDLE',
    finding: 'The guard has been sampled {samples} times and has never once been true.',
    suggestion:
      'Sampling costs compute whether or not the condition fires. Compare the guard against the live readouts — a threshold on the wrong side of the value never triggers.',
  },
};
