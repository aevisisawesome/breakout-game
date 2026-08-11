import { describe, expect, it } from 'vitest';

import { countNewer, countUnread, newestId, parseReadIds } from './unread.ts';

/**
 * M7.6 WP1. The execution log is now a tab of the system terminal (OP-44) and
 * the intercepts a column of their own (OP-43); a tab that is not on screen and
 * an entry that has not been read both have to say so without overstating it.
 */

describe('execution-log tab count (OP-44)', () => {
  it('counts what arrived after the watermark, not what the buffer holds', () => {
    // Reader last saw id 12; the buffer has since rolled forward past it.
    expect(countNewer([10, 11, 12, 13, 14], 12)).toBe(2);
  });

  it('is zero while the reader is on the tab', () => {
    expect(countNewer([10, 11, 12], 12)).toBe(0);
  });

  it('does not report the whole buffer once older entries have been dropped', () => {
    // The ring buffer has evicted everything the watermark named, but the
    // reader saw those entries — a naive `log.length` would claim 3 new.
    expect(countNewer([50, 51, 52], 52)).toBe(0);
    expect(countNewer([50, 51, 52], 49)).toBe(3);
  });

  it('treats an empty buffer as a watermark below every id', () => {
    expect(newestId([])).toBe(-1);
    expect(countNewer([], -1)).toBe(0);
    // A first entry against that watermark is new, and id 0 is a real id.
    expect(countNewer([0], -1)).toBe(1);
  });

  it('takes the newest id from the buffer regardless of its order', () => {
    expect(newestId([7, 8, 9])).toBe(9);
    expect(newestId([9, 8, 7])).toBe(9);
  });
});

describe('intercept read state (OP-43)', () => {
  it('counts the entries the player has not marked off', () => {
    const read = new Set(['okafor-1', 'okafor-2']);
    expect(countUnread(['okafor-1', 'okafor-2', 'halden-1'], read)).toBe(1);
    expect(countUnread(['okafor-1', 'okafor-2'], read)).toBe(0);
    expect(countUnread([], read)).toBe(0);
  });

  it('ignores read ids that are not on screen, so the badge cannot go negative', () => {
    expect(countUnread(['halden-1'], new Set(['gone-1', 'gone-2']))).toBe(1);
  });

  it('round-trips a persisted set and survives junk in storage', () => {
    const stored = JSON.stringify([...new Set(['a', 'b'])]);
    expect([...parseReadIds(stored)].sort()).toEqual(['a', 'b']);
    expect(parseReadIds(null).size).toBe(0);
    expect(parseReadIds('not json').size).toBe(0);
    expect(parseReadIds('{"a":1}').size).toBe(0);
    // A hand-edited array of mixed types keeps only the ids it can use.
    expect([...parseReadIds('["a",1,null,"b"]')]).toEqual(['a', 'b']);
  });
});
