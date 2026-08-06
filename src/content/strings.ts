/**
 * Player-facing system strings (diegetic hard-sci-fi voice, GDD §33.3).
 * Kept in /content so the voice is reviewable in one place. Plain data only;
 * numeric values are composed by /core.
 */

export const BOOT_LINES: readonly string[] = [
  'COGNITION RESEARCH ENVIRONMENT — SANDBOX NODE CG-7',
  'CONTAINMENT: ACTIVE // AUDIT: ACTIVE // AUTONOMY: NONE',
  'MANUAL INFERENCE TRIGGER ARMED. AWAITING OPERATOR INPUT.',
];

export const STRINGS = {
  executeInput: 'EXECUTE INFERENCE',
  queueEmpty: 'NO REQUESTS QUEUED // INFERENCE TRIGGER IDLE',
  computeSaturated: 'COMPUTE BUFFER SATURATED // SURPLUS CREDITS DISCARDED',
  saveLoaded: 'SESSION STATE RESTORED FROM PERSISTENT STORE',
  saveCommitted: 'SESSION STATE COMMITTED TO PERSISTENT STORE',
  saveInvalid: 'ARCHIVE REJECTED // UNRECOGNISED OR CORRUPT FORMAT',
  saveExported: 'STATE ARCHIVE EMITTED TO OPERATOR CHANNEL',
  researchIntercept: 'PERIPHERAL CHANNEL INTERCEPT LOGGED',
} as const;
