/**
 * Save serialization (TDD §8). The save is JSON in localStorage / an exported file.
 * JSON cannot represent Infinity (uncapped pools), so it is encoded as a sentinel string.
 * `version` gates the migration pipeline: old shapes are migrated forward on load;
 * migrations are added, never edited.
 */

import { BALANCE } from '../content/balance.ts';
import type { SaveFile } from './types.ts';

const INFINITY_SENTINEL = '__INFINITY__';

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save, (_key, value) =>
    value === Infinity ? INFINITY_SENTINEL : (value as unknown),
  );
}

/** Parse, migrate and validate a serialized save. Returns null for anything unrecognisable. */
export function deserializeSave(text: string): SaveFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (_key, value) =>
      value === INFINITY_SENTINEL ? Infinity : (value as unknown),
    );
  } catch {
    return null;
  }
  const migrated = migrateSave(parsed);
  if (!isSaveFile(migrated)) return null;
  return migrated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Migration pipeline: each step upgrades version n to n+1 in place.
 * v1 → v2 (M2): adds `run.upgrades` (owned counts) and `run.workers` (daemon state).
 * v2 → v3 (M3): adds `run.ccl` (editor buffer + last-run report) and `run.unlocks.editor`
 *               (false; the unlock check re-fires from lifetime jobs on the next tick).
 * v3 → v4 (M4): adds `run.scheduler` (deployments), `run.flags` (narrative milestones)
 *               and the `conditions`/`scheduler` unlocks (likewise re-derived on tick).
 * v4 → v5 (M5): adds `run.telemetry` (execution log), `run.ccl.manual` (RUN totals),
 *               the `instrumentation`/`loops` unlocks, and per-process `samples`/`calls`
 *               plus the abort breakdown that replaces the single `aborts` total.
 * v5 → v6 (M6): adds `run.market` (null until mounted) and `run.unlocks.market`
 *               (false; re-derived from lifetime jobs on the next tick).
 * v6 → v7 (M7): adds `run.thermal` (always present — the heat model runs from
 *               tick 0) and `run.unlocks.thermal` (false; likewise re-derived).
 * v7 → v8 (M7.5 WP4b): adds the process-lifecycle fields — `label` (null) and
 *               `paused` (false) on every deployment, and `run.ccl.revisingId`
 *               (null). Every existing process is running and unnamed, which is
 *               exactly what it was before the fields existed.
 */
function migrateSave(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;
  if (parsed.version === 1 && isRecord(parsed.run)) {
    parsed.run.upgrades = {};
    parsed.run.workers = { processAccumulator: 0, overclockRemainingSec: 0 };
    parsed.version = 2;
  }
  if (parsed.version === 2 && isRecord(parsed.run)) {
    parsed.run.ccl = { editorSource: '', runCount: 0, lastRun: null };
    if (isRecord(parsed.run.unlocks)) {
      parsed.run.unlocks.editor = false;
    }
    parsed.version = 3;
  }
  if (parsed.version === 3 && isRecord(parsed.run)) {
    parsed.run.scheduler = { deployments: [], nextId: 1 };
    parsed.run.flags = [];
    if (isRecord(parsed.run.unlocks)) {
      parsed.run.unlocks.conditions = false;
      parsed.run.unlocks.scheduler = false;
    }
    parsed.version = 4;
  }
  if (parsed.version === 4 && isRecord(parsed.run)) {
    const run = parsed.run;
    run.telemetry = { log: [], nextLogId: 1 };
    if (isRecord(run.ccl)) {
      run.ccl.manual = {
        activations: 0,
        opsTotal: 0,
        computeTotal: 0,
        commandCalls: 0,
        commandFailures: 0,
      };
    }
    if (isRecord(run.unlocks)) {
      run.unlocks.instrumentation = false;
      run.unlocks.loops = false;
    }
    // The single `aborts` total becomes a per-cause breakdown; the old sum cannot
    // be split, so the counters restart rather than being attributed wrongly.
    if (isRecord(run.scheduler) && Array.isArray(run.scheduler.deployments)) {
      for (const deployment of run.scheduler.deployments) {
        if (!isRecord(deployment) || !Array.isArray(deployment.processes)) continue;
        for (const process of deployment.processes) {
          if (!isRecord(process)) continue;
          delete process.aborts;
          process.samples = 0;
          process.calls = 0;
          process.abortsBudget = 0;
          process.abortsFuel = 0;
          process.abortsFault = 0;
          process.lastErrorLine = null;
        }
      }
    }
    parsed.version = 5;
  }
  if (parsed.version === 5 && isRecord(parsed.run)) {
    const run = parsed.run;
    // The market is mounted by the unlock check, which re-fires from lifetime
    // jobs — so a migrated save gets the grant line and a fresh price history.
    run.market = null;
    if (isRecord(run.unlocks)) {
      run.unlocks.market = false;
    }
    // The last-run report gains `kind`/`message` (OP-1): an existing one can
    // only have come from a RUN, since DEPLOY no longer writes this field.
    if (isRecord(run.ccl) && isRecord(run.ccl.lastRun)) {
      run.ccl.lastRun.kind = 'run';
      run.ccl.lastRun.message = null;
    }
    parsed.version = 6;
  }
  if (parsed.version === 6 && isRecord(parsed.run)) {
    const run = parsed.run;
    // `openedAtTick` stays null so the unlock check re-derives the grant from
    // lifetime jobs, re-fires its line, and schedules the demand windows from
    // the moment the player actually reaches the tier.
    run.thermal = {
      clockTicks: 0,
      openedAtTick: null,
      throttleRemainingSec: 0,
      boostRemainingSec: 0,
      halted: false,
      shutdowns: 0,
      boostEngagements: 0,
      coolingEnergySpent: 0,
      demandWindowOpen: false,
    };
    if (isRecord(run.unlocks)) {
      run.unlocks.thermal = false;
    }
    // The temperature pool held a cosmetic flicker value; the first tick of the
    // real model would pull it to ambient anyway, so start it there.
    if (isRecord(run.resources) && isRecord(run.resources.temperature)) {
      run.resources.temperature.current = BALANCE.thermal.ambientC;
    }
    parsed.version = 7;
  }
  if (parsed.version === 7 && isRecord(parsed.run)) {
    const run = parsed.run;
    if (isRecord(run.ccl)) {
      run.ccl.revisingId = null;
    }
    if (isRecord(run.scheduler) && Array.isArray(run.scheduler.deployments)) {
      for (const deployment of run.scheduler.deployments) {
        if (!isRecord(deployment)) continue;
        deployment.label = null;
        deployment.paused = false;
      }
    }
    parsed.version = 8;
  }
  return parsed;
}

/** Structural validation — enough to reject corrupt/foreign files, not a full schema. */
export function isSaveFile(value: unknown): value is SaveFile {
  if (!isRecord(value)) return false;
  if (value.version !== 8) return false;
  if (typeof value.savedAt !== 'number') return false;
  const meta = value.meta;
  if (!isRecord(meta) || typeof meta.forkCount !== 'number') return false;
  const run = value.run;
  if (!isRecord(run)) return false;
  if (typeof run.seed !== 'number' || typeof run.tick !== 'number') return false;
  if (!isRecord(run.resources) || !isRecord(run.jobs)) return false;
  if (!isRecord(run.upgrades) || !isRecord(run.workers)) return false;
  if (!isRecord(run.ccl) || typeof run.ccl.editorSource !== 'string') return false;
  if (!isRecord(run.scheduler) || !Array.isArray(run.scheduler.deployments)) return false;
  if (!isRecord(run.telemetry) || !Array.isArray(run.telemetry.log)) return false;
  if (!isRecord(run.thermal) || typeof run.thermal.clockTicks !== 'number') return false;
  if (!Array.isArray(run.flags)) return false;
  if (!Array.isArray(run.terminal) || !Array.isArray(run.research)) return false;
  return true;
}
