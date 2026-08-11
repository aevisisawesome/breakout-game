/**
 * Unread bookkeeping for the two surfaces M7.6 WP1 adds (OP-43, OP-44).
 *
 * Both surfaces have the same problem in two shapes: something arrives where
 * the reader is not currently looking, and the interface has to say so without
 * lying about how much. The execution log is a monotonic ring buffer, so what
 * is unread is "everything past the id I last saw" — old entries fall out of
 * the buffer and must not keep being counted. The intercepts are an append-only
 * narrative feed the player marks off one at a time by reading them, so what is
 * unread is a set difference instead.
 *
 * Kept out of the components so the arithmetic can be tested: the UI layer has
 * no render-level test harness (vitest runs in `node`), and these are the only
 * parts of the package that are worth pinning rather than measuring in-browser.
 */

/** Per-run read state, so it survives a reload but not a purge (see `clearReadIntercepts`). */
const INTERCEPTS_KEY = 'breakout.ui.intercepts.v1';

/**
 * How many of `ids` are newer than the newest one the reader has seen.
 *
 * Ids are monotonic and the buffer is bounded, so this counts what arrived
 * rather than what is retained: a watermark below the whole window yields the
 * window, never the total number of entries ever written.
 */
export function countNewer(ids: readonly number[], seenId: number): number {
  let n = 0;
  for (const id of ids) if (id > seenId) n += 1;
  return n;
}

/** The newest id present, or `-1` for an empty buffer (below every real id). */
export function newestId(ids: readonly number[]): number {
  let newest = -1;
  for (const id of ids) if (id > newest) newest = id;
  return newest;
}

/** How many of `ids` the reader has not marked off. */
export function countUnread(ids: readonly string[], read: ReadonlySet<string>): number {
  let n = 0;
  for (const id of ids) if (!read.has(id)) n += 1;
  return n;
}

/** Parse a persisted read-set, tolerating anything that is not one. */
export function parseReadIds(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

/** Which intercepts the player has already read. Presentation state, like the panel folds. */
export function loadReadIntercepts(): Set<string> {
  try {
    return parseReadIds(window.localStorage.getItem(INTERCEPTS_KEY));
  } catch {
    return new Set();
  }
}

export function saveReadIntercepts(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(INTERCEPTS_KEY, JSON.stringify([...ids]));
  } catch {
    // A full or unavailable store only costs the flag, never the session.
  }
}

/**
 * Forget every intercept, for a run that no longer exists.
 *
 * Entry ids come from `/content/narrative.ts` and are therefore stable across
 * runs: a purged sandbox unlocks the same `okafor-1` it did before, so without
 * this the whole narrative would arrive pre-read on the second run. Called from
 * PURGE rather than stored in the save, because the save version is spoken for
 * (M8's meta/run split is v9).
 */
export function clearReadIntercepts(): void {
  try {
    window.localStorage.removeItem(INTERCEPTS_KEY);
  } catch {
    // Same as above: a storage failure costs the flag, not the purge.
  }
}
