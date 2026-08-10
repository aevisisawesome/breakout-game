import { useCallback, useEffect, useRef, useState } from 'react';

import { useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/**
 * How close to the last line still counts as "following". One line of slack, so
 * a fractional scroll position or a rounded scrollHeight cannot silently detach
 * a player who never scrolled.
 */
const FOLLOW_SLACK_PX = 24;

export function TerminalPanel() {
  const terminal = useGameStore((s) => s.snapshot.terminal);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Following the newest line, as opposed to reading back through the history.
   * A ref, not state: the scroll handler and the output effect both need the
   * current value without re-rendering the whole log to get it.
   */
  const following = useRef(true);
  const [detachedFrom, setDetachedFrom] = useState<number | null>(null);

  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
    setDetachedFrom(null);
  }, []);

  /**
   * The newest line's id, which changes only when something is actually written
   * (OP-27). The `terminal` array itself is rebuilt by `getSnapshot()` on every
   * revision, and the store swaps in a new snapshot at the 10 Hz timestep — so
   * depending on the array meant re-running this ten times a second, which is
   * what made the panel impossible to scroll back through.
   */
  const newestId = terminal.length > 0 ? terminal[terminal.length - 1]!.id : -1;

  useEffect(() => {
    // Stick to the bottom only for a reader who is already there. A player who
    // has scrolled up is reading, and yanking them back is the defect.
    if (following.current) toBottom();
  }, [newestId, toBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    following.current = atBottom;
    // Remember where the reader detached, so the badge can say how much has
    // arrived since rather than merely that something has.
    setDetachedFrom((from) => (atBottom ? null : (from ?? newestId)));
  }, [newestId]);

  // A collapsed body has no height, so its scroll position is lost; snap back to
  // the newest line when it reappears rather than waiting for the next output.
  const onToggle = useCallback(
    (collapsed: boolean) => {
      if (!collapsed) requestAnimationFrame(toBottom);
    },
    [toBottom],
  );

  const pending = detachedFrom === null ? 0 : newestId - detachedFrom;

  return (
    <Panel id="terminal" title="SYSTEM TERMINAL" className="terminal-panel" onToggle={onToggle}>
      <div
        className="terminal-output"
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-label="Terminal"
      >
        {terminal.map((line) => (
          <p key={line.id} className={`terminal-line term-${line.kind}`}>
            {line.text}
          </p>
        ))}
        <p className="terminal-line">
          <span className="terminal-prompt">&gt;&nbsp;</span>
          <span className="terminal-cursor" aria-hidden="true" />
        </p>
      </div>
      {detachedFrom !== null && (
        <button type="button" className="terminal-follow" onClick={toBottom}>
          {pending > 0 ? `${pending} NEW LINE${pending === 1 ? '' : 'S'} BELOW` : 'SCROLLED BACK'}{' '}
          &darr;
        </button>
      )}
    </Panel>
  );
}
