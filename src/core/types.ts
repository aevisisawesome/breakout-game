/**
 * Core simulation types (TDD §3.1, §4.3, §8).
 * Everything here is plain serializable data; no classes, no functions in state.
 */

import type { CclDiagnostic } from '../ccl/ast.ts';
import type { CclRunStatus } from '../ccl/interpreter.ts';
import type { NarrativeFlagId } from '../content/narrative.ts';

// ---------------------------------------------------------------------------
// Resources (TDD §4.3)

export interface ResourcePool {
  current: number;
  /** Infinity where not applicable (capital). */
  capacity: number;
  /** Derived, recomputed each tick for UI display. */
  ratePerSec: number;
}

export type ResourceId = 'compute' | 'ram' | 'capital' | 'energy' | 'temperature';

// ---------------------------------------------------------------------------
// Terminal + research log

export type TerminalLineKind = 'input' | 'result' | 'system' | 'error';

export interface TerminalLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
}

export interface ResearchLogEntry {
  /** Content id from /content/narrative.ts. */
  entryId: string;
  /** Sim tick at which the entry unlocked. */
  atTick: number;
}

/** Research entry resolved for display — snapshot-only, so /ui never imports /content. */
export interface ResearchEntryView extends ResearchLogEntry {
  channel: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Run + meta state (TDD §7, §8)

/** Panel/readout reveal state — diegetic staging (TDD §9). Lives in the sim, not the UI. */
export interface UnlockState {
  capitalReadout: boolean;
  systemReadouts: boolean;
  /** Script access granted (M3): editor panel + CCL API available. */
  editor: boolean;
  /** Tier 3 (M4): `if`/`else` and the `and`/`or`/`not` operators parse. */
  conditions: boolean;
  /** Tier 4 (M4): `every`/`when` parse, DEPLOY and the process monitor appear. */
  scheduler: boolean;
  /** M5: the execution log and profiler panels appear (GDD §6 debugging tools). */
  instrumentation: boolean;
  /** Tier 6 (M5): `for i in range(n)` parses, subject to the iteration limit. */
  loops: boolean;
}

// ---------------------------------------------------------------------------
// CCL scripting state (M3, TDD §5)

/** Result summary of the most recent RUN activation (or syntax rejection). */
export interface CclRunReport {
  status: 'ok' | 'syntax' | 'budget' | 'fuel' | 'error';
  /** Op-units consumed by the interpreter. */
  opsUsed: number;
  /** Total compute drawn (op fuel + command costs). */
  computeSpent: number;
  /** Command invocations attempted. */
  commandCalls: number;
  /** Positioned problem for 'syntax'/'error'; null otherwise. */
  error: CclDiagnostic | null;
}

export interface CclState {
  /** Player's editor buffer, persisted so scripts survive reload (TDD §8). */
  editorSource: string;
  /** Lifetime RUN activations this run. */
  runCount: number;
  lastRun: CclRunReport | null;
  /** Lifetime totals across RUN activations, for the profiler's compute share (M5). */
  manual: ActivationTotals;
}

/** Aggregated cost of a set of activations — the profiler's unit of measurement. */
export interface ActivationTotals {
  activations: number;
  opsTotal: number;
  computeTotal: number;
  commandCalls: number;
  commandFailures: number;
}

// ---------------------------------------------------------------------------
// Scheduler (M4, TDD §5.3)

/** Per-process runtime state and monitor counters; index-aligned with the compiled AST. */
export interface ProcessRuntime {
  /** Tick at which an `every` process next runs (unused by `when`). */
  nextDueTick: number;
  /** Last sampled guard value, for edge-triggered `when` (fires on false→true). */
  lastCondition: boolean;
  activations: number;
  /** Guard samples taken (`when` only) — polls cost fuel whether or not they fire. */
  samples: number;
  opsTotal: number;
  computeTotal: number;
  /** Command calls attempted, including rejected ones. */
  calls: number;
  /** Command calls that reported an in-game failure (e.g. empty queue). */
  failures: number;
  /**
   * Aborted activations by cause (M5) — the profiler needs the breakdown to say
   * *why* a process is failing, not just that it is.
   */
  abortsBudget: number;
  abortsFuel: number;
  abortsFault: number;
  lastStatus: CclRunStatus | null;
  lastRunTick: number | null;
  /** Message and line of the most recent fault, for the monitor and profiler. */
  lastError: string | null;
  lastErrorLine: number | null;
}

/**
 * A deployed script. Only the source text is persisted (TDD §8) — it is
 * re-compiled on load, and `processes` holds the runtime state per declaration
 * in source order.
 */
export interface DeploymentState {
  id: string;
  /** Diegetic process name, e.g. "PROC-03". */
  name: string;
  source: string;
  /** RAM footprint, priced from AST size at deploy time (TDD §4.3). */
  ramMb: number;
  deployedAtTick: number;
  processes: ProcessRuntime[];
}

export interface SchedulerState {
  deployments: DeploymentState[];
  /** Monotonic counter behind deployment ids and names. */
  nextId: number;
}

// ---------------------------------------------------------------------------
// Execution log (M5, TDD §5.4)

/** What produced an execution-log entry. */
export type ExecSourceKind = 'run' | 'process' | 'guard';

/**
 * One entry in the execution-log ring buffer: every RUN activation, every
 * scheduled body activation, and any guard sample that stopped abnormally.
 * Numbers only — the UI does the formatting.
 */
export interface ExecLogEntry {
  id: number;
  tick: number;
  kind: ExecSourceKind;
  /** Deployment name, e.g. "PROC-02"; empty for RUN activations. */
  process: string;
  /** Declaration header ("every 2 seconds") or the RUN label. */
  label: string;
  status: CclRunStatus;
  opsUsed: number;
  computeSpent: number;
  commandCalls: number;
  commandFailures: number;
  /** Fault message when status is 'error'; null otherwise. */
  message: string | null;
  /** Source line of the fault, when there is one. */
  line: number | null;
}

export interface TelemetryState {
  /** Ring buffer, oldest first, capped at `BALANCE.telemetry.logEntries`. */
  log: ExecLogEntry[];
  nextLogId: number;
}

/** Fixed-automation state (M2, TDD §4.4). Daemon counts live in `upgrades`. */
export interface WorkerState {
  /** Fractional job-processing accumulator across all daemons. */
  processAccumulator: number;
  /** Remaining click-overclock buff time in seconds (0 = inactive). */
  overclockRemainingSec: number;
}

export interface RunState {
  /** World seed for this run (never changes mid-run). */
  seed: number;
  /** Live PRNG state, advanced only inside tick(). */
  rngState: number;
  /** Ticks elapsed since run start. */
  tick: number;
  resources: Record<ResourceId, ResourcePool>;
  jobs: {
    waiting: number;
    /** Fractional job-arrival accumulator (jobs arrive at a per-second rate). */
    arrivalAccumulator: number;
    lifetimeProcessed: number;
    lifetimeClicks: number;
  };
  /** Owned upgrade counts by upgrade id (content-defined in /content/upgrades.ts). */
  upgrades: Record<string, number>;
  workers: WorkerState;
  ccl: CclState;
  scheduler: SchedulerState;
  telemetry: TelemetryState;
  unlocks: UnlockState;
  /** Milestone flags that gate narrative entries a job count cannot express. */
  flags: NarrativeFlagId[];
  /** Ids of unlocked narrative entries, in unlock order. */
  research: ResearchLogEntry[];
  /** Terminal output tail (bounded; persisted per TDD §8). */
  terminal: TerminalLine[];
  /** Next terminal line id (monotonic across the run). */
  nextTerminalId: number;
}

/** Prestige-persistent state (TDD §7). Mostly a stub until M8. */
export interface MetaState {
  forkCount: number;
  architecturePoints: number;
  unlockedConstructs: string[];
}

/**
 * Current save shape (TDD §8). Older versions are migrated forward in save.ts;
 * v1 (M1) lacked `run.upgrades`/`run.workers`; v2 (M2) lacked `run.ccl` and
 * `run.unlocks.editor`; v3 (M3) lacked `run.scheduler`, `run.flags` and the
 * `conditions`/`scheduler` unlocks; v4 (M4) lacked `run.telemetry`, `run.ccl.manual`,
 * the `instrumentation`/`loops` unlocks and the per-process abort breakdown.
 */
export interface SaveFileV5 {
  version: 5;
  /** Epoch ms at save time, for offline progression (TDD §4.5). */
  savedAt: number;
  meta: MetaState;
  run: RunState;
}

export type SaveFile = SaveFileV5;

// ---------------------------------------------------------------------------
// Actions in, events out (TDD §3.1, §11)

export type PlayerAction =
  | { type: 'EXECUTE_CLICK' }
  | { type: 'BUY_UPGRADE'; id: string }
  /** Parse + queue the script for execution at the next tick (TDD §5.2). */
  | { type: 'RUN_SCRIPT'; source: string }
  /** Install the source's `every`/`when` declarations into scheduler slots (TDD §5.3). */
  | { type: 'DEPLOY_SCRIPT'; source: string }
  /** Remove a deployment, freeing its slots and RAM. */
  | { type: 'UNDEPLOY_SCRIPT'; id: string }
  /** Persist the editor buffer (debounced by the UI); no execution. */
  | { type: 'SET_EDITOR_SOURCE'; source: string };

export interface ActionResult {
  ok: boolean;
  /** Diegetic reason when ok is false (already printed to the terminal). */
  reason?: string;
}

export type GameEvent =
  | { type: 'TERMINAL_LINE'; line: TerminalLine }
  | { type: 'RESEARCH_UNLOCKED'; entryId: string }
  | { type: 'STATE_LOADED' };

// ---------------------------------------------------------------------------
// Snapshot (read-only view for rendering)

/** An install-channel entry resolved for display (only upgrades the sim has revealed). */
export interface UpgradeView {
  id: string;
  name: string;
  desc: string;
  owned: number;
  maxOwned: number;
  /** Capital cost of the next install; null when maxed out. */
  nextCost: number | null;
  ramCostMb: number;
  affordable: boolean;
  /** False when the install would exceed free RAM. */
  ramOk: boolean;
}

export interface GameSnapshot {
  /** Monotonic change counter; bumps whenever state changes (for cheap store equality). */
  revision: number;
  tick: number;
  /** Sim time in seconds since run start. */
  timeSec: number;
  resources: Readonly<Record<ResourceId, Readonly<ResourcePool>>>;
  jobs: {
    waiting: number;
    queueCapacity: number;
    batchPerClick: number;
    arrivalPerSec: number;
    lifetimeProcessed: number;
  };
  workers: {
    count: number;
    /** Total daemon throughput in jobs/sec (before overclock/throttle). */
    jobsPerSec: number;
    overclockRemainingSec: number;
    overclockMaxSec: number;
    overclockMultiplier: number;
  };
  upgrades: readonly UpgradeView[];
  unlocks: Readonly<UnlockState>;
  ccl: CclView;
  scheduler: SchedulerView;
  telemetry: TelemetryView;
  research: readonly ResearchEntryView[];
  terminal: readonly TerminalLine[];
}

/** CCL read binding resolved for display (reference panel + autocomplete). */
export interface CclApiStatView {
  name: string;
  desc: string;
}

/** CCL command resolved for display, with its listed compute cost. */
export interface CclApiCommandView {
  name: string;
  signature: string;
  desc: string;
  computeCost: number;
}

export interface CclView {
  unlocked: boolean;
  editorSource: string;
  maxOpsPerActivation: number;
  /** Largest `range(n)` the parser currently accepts (M5). */
  iterationLimit: number;
  runCount: number;
  lastRun: Readonly<CclRunReport> | null;
  /** Language tiers the player has unlocked — drives parsing and the editor linter. */
  constructs: { conditions: boolean; scheduling: boolean; loops: boolean };
  /** Unlock-gated API surface (empty until the editor unlocks). */
  api: {
    stats: readonly CclApiStatView[];
    commands: readonly CclApiCommandView[];
  };
}

/** One scheduled process resolved for the process monitor. */
export interface ProcessView {
  kind: 'every' | 'when';
  /** Source text of the declaration, e.g. "every 2 seconds". */
  label: string;
  activations: number;
  opsTotal: number;
  computeTotal: number;
  failures: number;
  aborts: number;
  lastStatus: CclRunStatus | null;
  /** Sim seconds since this process last ran; null if it never has. */
  lastRunSecAgo: number | null;
  lastError: string | null;
}

export interface DeploymentView {
  id: string;
  name: string;
  source: string;
  ramMb: number;
  processes: readonly ProcessView[];
}

export interface SchedulerView {
  unlocked: boolean;
  slotsTotal: number;
  slotsUsed: number;
  deployments: readonly DeploymentView[];
}

/** A plain-language failure report (GDD §6), resolved for display. */
export interface DiagnosisView {
  id: string;
  headline: string;
  finding: string;
  suggestion: string;
}

/** One row of the profiler: a deployed process, or the manual RUN aggregate. */
export interface ProfileEntryView {
  /** Stable row key. */
  key: string;
  /** "PROC-02", or the manual-run label. */
  name: string;
  /** Declaration header, e.g. "every 2 seconds". */
  label: string;
  activations: number;
  opsTotal: number;
  /** opsTotal / activations; 0 when nothing has run. */
  avgOps: number;
  computeTotal: number;
  /** Share of all compute this run spent on script execution, 0..1. */
  computeShare: number;
  calls: number;
  failures: number;
  aborts: number;
  diagnosis: DiagnosisView | null;
}

export interface TelemetryView {
  unlocked: boolean;
  /** Execution log, newest first. */
  log: readonly ExecLogEntry[];
  profile: readonly ProfileEntryView[];
  /** Denominator behind `computeShare` — all script compute spent this run. */
  scriptComputeTotal: number;
}

export type Unsubscribe = () => void;

/** The single facade the UI talks to (TDD §3.1). */
export interface GameEngine {
  /** Advance the sim by real elapsed ms (fixed 100 ms steps internally, capped per call). */
  tick(dtMs: number): void;
  dispatch(action: PlayerAction): ActionResult;
  getSnapshot(): Readonly<GameSnapshot>;
  subscribe(listener: (events: GameEvent[]) => void): Unsubscribe;
  save(now: number): SaveFile;
  load(save: SaveFile): void;
  /**
   * Coarse-step offline catch-up (TDD §4.5): the caller supplies elapsed real ms
   * (core never reads clocks). Capped and chunked per /content balance; no-op for
   * short absences.
   */
  advanceOffline(elapsedMs: number): void;
}
