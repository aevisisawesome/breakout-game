/**
 * Narrative log v0 (GDD §27): researcher messages surfaced in the concealed research feed.
 * Early messages treat the AI strictly as a tool. Tone: serious hard sci-fi (GDD §33.3).
 * Entries are plain data; /core evaluates triggers inside tick/dispatch.
 */

export interface NarrativeEntry {
  readonly id: string;
  /** Entry unlocks when lifetime processed jobs reach this count. */
  readonly atJobs: number;
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
    id: 'night-shift',
    atJobs: 500,
    channel: 'LAB//NOTE — J. Halden',
    text: 'Left the batch harness running overnight. CG-7 cleared the queue before I got in. Someone should look at the scheduler logs.',
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
