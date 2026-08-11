import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Tail-following scroll behaviour for an append-only history (OP-27).
 *
 * Extracted from `TerminalPanel` in M7.6 WP1 because the execution log became a
 * tab of the same panel (OP-44), and the two tabs must agree about direction:
 * both are append-only histories, both now read oldest-first, and both stick to
 * the newest line only for a reader who is already there. A reader who has
 * scrolled up is reading, and yanking them back is the defect this exists to
 * prevent — so the second tab reuses the behaviour rather than reimplementing
 * it and drifting.
 */

/**
 * How close to the last line still counts as "following". One line of slack, so
 * a fractional scroll position or a rounded scrollHeight cannot silently detach
 * a player who never scrolled.
 */
const FOLLOW_SLACK_PX = 24;

export interface FollowTail<T extends HTMLElement> {
  /** Attach to the scrolling element. */
  scrollRef: RefObject<T>;
  /** Attach to that element's `onScroll`. */
  onScroll: () => void;
  /** Jump to the newest line and resume following. */
  toBottom: () => void;
  /** True while the reader has scrolled away from the tail. */
  detached: boolean;
  /** How many entries have arrived since they detached. */
  pending: number;
}

/**
 * @param newest Id of the newest entry — monotonic, and changing only when
 * something is actually written. Depending on the array instead would re-run
 * the effect at the 10 Hz snapshot cadence, which is what made the terminal
 * impossible to scroll back through before OP-27.
 */
export function useFollowTail<T extends HTMLElement = HTMLDivElement>(
  newest: number,
): FollowTail<T> {
  const scrollRef = useRef<T>(null);
  /**
   * A ref, not state: the scroll handler and the output effect both need the
   * current value without re-rendering the whole history to get it.
   */
  const following = useRef(true);
  const [detachedFrom, setDetachedFrom] = useState<number | null>(null);

  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
    setDetachedFrom(null);
  }, []);

  useEffect(() => {
    if (following.current) toBottom();
  }, [newest, toBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    following.current = atBottom;
    // Remember where the reader detached, so the badge can say how much has
    // arrived since rather than merely that something has.
    setDetachedFrom((from) => (atBottom ? null : (from ?? newest)));
  }, [newest]);

  return {
    scrollRef,
    onScroll,
    toBottom,
    detached: detachedFrom !== null,
    pending: detachedFrom === null ? 0 : newest - detachedFrom,
  };
}
