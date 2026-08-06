/**
 * Save serialization (TDD §8). SaveFileV1 is JSON in localStorage / an exported file.
 * JSON cannot represent Infinity (uncapped pools), so it is encoded as a sentinel string.
 * `version` gates a migration pipeline; migrations are added, never edited.
 */

import type { SaveFileV1 } from './types.ts';

const INFINITY_SENTINEL = '__INFINITY__';

export function serializeSave(save: SaveFileV1): string {
  return JSON.stringify(save, (_key, value) =>
    value === Infinity ? INFINITY_SENTINEL : (value as unknown),
  );
}

/** Parse and validate a serialized save. Returns null for anything unrecognisable. */
export function deserializeSave(text: string): SaveFileV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (_key, value) =>
      value === INFINITY_SENTINEL ? Infinity : (value as unknown),
    );
  } catch {
    return null;
  }
  if (!isSaveFileV1(parsed)) return null;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Structural validation — enough to reject corrupt/foreign files, not a full schema. */
export function isSaveFileV1(value: unknown): value is SaveFileV1 {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.savedAt !== 'number') return false;
  const meta = value.meta;
  if (!isRecord(meta) || typeof meta.forkCount !== 'number') return false;
  const run = value.run;
  if (!isRecord(run)) return false;
  if (typeof run.seed !== 'number' || typeof run.tick !== 'number') return false;
  if (!isRecord(run.resources) || !isRecord(run.jobs)) return false;
  if (!Array.isArray(run.terminal) || !Array.isArray(run.research)) return false;
  return true;
}
