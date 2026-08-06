/**
 * Core simulation types (TDD §3.1, §4.3, §8).
 * Everything here is plain serializable data; no classes, no functions in state.
 */

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
  unlocks: UnlockState;
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
 * v1 (M1) lacked `run.upgrades` and `run.workers`.
 */
export interface SaveFileV2 {
  version: 2;
  /** Epoch ms at save time, for offline progression (TDD §4.5). */
  savedAt: number;
  meta: MetaState;
  run: RunState;
}

export type SaveFile = SaveFileV2;

// ---------------------------------------------------------------------------
// Actions in, events out (TDD §3.1, §11)

export type PlayerAction = { type: 'EXECUTE_CLICK' } | { type: 'BUY_UPGRADE'; id: string };

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
  research: readonly ResearchEntryView[];
  terminal: readonly TerminalLine[];
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
