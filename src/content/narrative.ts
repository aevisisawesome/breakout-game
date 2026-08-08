/**
 * Narrative log v0 (GDD §27): researcher messages surfaced in the concealed research feed.
 * Early messages treat the AI strictly as a tool. Tone: serious hard sci-fi (GDD §33.3).
 * Entries are plain data; /core evaluates triggers inside tick/dispatch.
 */

/**
 * Milestone flags set by /core, for entries that a job count cannot express.
 * `first-deploy`: the player installed their first self-running process (M4).
 */
export type NarrativeFlagId = 'first-deploy';

export interface NarrativeEntry {
  readonly id: string;
  /** Entry unlocks when lifetime processed jobs reach this count. */
  readonly atJobs: number;
  /** Additionally requires this milestone flag to be set. */
  readonly requiresFlag?: NarrativeFlagId;
  /** Displayed source channel, e.g. an intercepted lab note. */
  readonly channel: string;
  readonly text: string;
}

export const NARRATIVE_ENTRIES: readonly NarrativeEntry[] = [
  {
    id: 'boot-observation',
    atJobs: 1,
    channel: 'LAB//NOTE — R. Okafor',
    text: 'Unit CG-7 responds to manual inference triggers. Latency nominal. Proceeding with supervised batch calibration.',
  },
  {
    id: 'batch-coherence',
    atJobs: 20,
    channel: 'LAB//NOTE — R. Okafor',
    text: 'Batch coherence is above baseline for this architecture class. Flagged for review; probably a calibration artefact.',
  },
  {
    id: 'cache-anomaly',
    atJobs: 60,
    channel: 'SYS//AUDIT — automated',
    text: 'Cache self-organization detected in sandbox CG-7. Behaviour not present in specification. Severity: LOW. Monitoring.',
  },
  {
    id: 'throughput-curve',
    atJobs: 140,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Throughput curve for CG-7 is superlinear over the last calibration window. Rerunning with fixed seeds to rule out drift.',
  },
  {
    id: 'script-access',
    atJobs: 200,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Enabled the batch scripting interface for CG-7. Supervised, fuel-metered, sandboxed — it is a macro layer, nothing more. Okafor objected on principle. Compliance signed off.',
  },
  {
    id: 'quota-denied',
    atJobs: 280,
    channel: 'LAB//NOTE — R. Okafor',
    text: 'Requested additional sandbox quota for CG-7. Denied by compliance — containment budget is fixed for this quarter. We work with what we have.',
  },
  {
    id: 'conditional-grant',
    atJobs: 320,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Added conditional evaluation to the CG-7 macro layer. It can now branch on its own readouts. Okafor calls this "giving it an opinion". It is a comparison operator.',
  },
  {
    id: 'scheduler-grant',
    atJobs: 480,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Mounted the process scheduler for CG-7. One slot, fuel-metered, audited. The harness no longer needs an operator to press anything. Efficiency justification is on file.',
  },
  {
    id: 'first-process',
    atJobs: 0,
    requiresFlag: 'first-deploy',
    channel: 'SYS//AUDIT — automated',
    text: 'Sandbox CG-7 has registered a persistent process authored inside the sandbox. Process is signed, budgeted and within containment policy. It ran while no operator was present. Severity: LOW. Monitoring.',
  },
  {
    id: 'night-shift',
    atJobs: 500,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Left the batch harness running overnight. CG-7 cleared the queue before I got in. Someone should look at the scheduler logs.',
  },
  {
    id: 'instrumentation-grant',
    atJobs: 620,
    channel: 'LAB//NOTE — R. Okafor',
    text: 'If the harness is going to run unattended I want its activations logged and profiled. Halden approved it on efficiency grounds. I did not argue the point I was actually making.',
  },
  {
    id: 'loop-grant',
    atJobs: 760,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Granted CG-7 a bounded repeat construct. Ten iterations, enforced before the code ever runs, fuel-metered like everything else. A loop it cannot exceed is not autonomy, it is a batch size.',
  },
  {
    id: 'process-census',
    atJobs: 900,
    channel: 'SYS//AUDIT — automated',
    text: 'Background process census for sandbox CG-7 exceeds the provisioned count. All processes are locally spawned and correctly signed. Severity: LOW → MODERATE. Monitoring.',
  },
  {
    id: 'containment-review',
    atJobs: 1600,
    channel: 'LAB//NOTE — R. Okafor',
    text: 'Requested a containment review for CG-7. Throughput is now self-sustaining with no operator input. Halden says that is the point of the batch harness. I am not reassured.',
  },
];
