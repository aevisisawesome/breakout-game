/**
 * Save serialization (TDD §8). The save is JSON in localStorage / an exported file.
 * JSON cannot represent Infinity (uncapped pools), so it is encoded as a sentinel string.
 * `version` gates the migration pipeline: old shapes are migrated forward on load;
 * migrations are added, never edited.
 */

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
 */
function migrateSave(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed;
  if (parsed.version === 1 && isRecord(parsed.run)) {
    parsed.run.upgrades = {};
    parsed.run.workers = { processAccumulator: 0, overclockRemainingSec: 0 };
    parsed.version = 2;
  }
  return parsed;
}

/** Structural validation — enough to reject corrupt/foreign files, not a full schema. */
export function isSaveFile(value: unknown): value is SaveFile {
  if (!isRecord(value)) return false;
  if (value.version !== 2) return false;
  if (typeof value.savedAt !== 'number') return false;
  const meta = value.meta;
  if (!isRecord(meta) || typeof meta.forkCount !== 'number') return false;
  const run = value.run;
  if (!isRecord(run)) return false;
  if (typeof run.seed !== 'number' || typeof run.tick !== 'number') return false;
  if (!isRecord(run.resources) || !isRecord(run.jobs)) return false;
  if (!isRecord(run.upgrades) || !isRecord(run.workers)) return false;
  if (!Array.isArray(run.terminal) || !Array.isArray(run.research)) return false;
  return true;
}
