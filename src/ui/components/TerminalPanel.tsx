import { useCallback, useEffect, useState } from 'react';

import { useGameStore } from '../session.ts';
import { useFollowTail } from '../follow-tail.ts';
import { countNewer, newestId } from '../unread.ts';
import { ExecutionLog } from './ExecutionLog.tsx';
import { FollowTailButton } from './FollowTailButton.tsx';
import { Panel } from './Panel.tsx';

/**
 * Which history the panel is showing (M7.6 WP1, OP-44). The execution log used
 * to be a sixth panel stacked below this one; it is a tab now, because the two
 * are the same kind of thing — an append-only record of what happened, one
 * written by the node and one by the interpreter — and the reader is nearly
 * always asking the same question of one or the other. It also returns the
 * vertical space that made OP-31 possible in the first place.
 */
type TerminalTab = 'output' | 'execlog';

export function TerminalPanel() {
  const terminal = useGameStore((s) => s.snapshot.terminal);
  const telemetry = useGameStore((s) => s.snapshot.telemetry);
  const [tab, setTab] = useState<TerminalTab>('output');

  // Before the instrumentation tier there is only one history, so the panel
  // renders exactly as it did: no tab strip, no second view to be lost in.
  const tabbed = telemetry.unlocked;
  const active: TerminalTab = tabbed ? tab : 'output';

  const newestLogId = newestId(telemetry.log.map((entry) => entry.id));
  const newestLineId = terminal.length > 0 ? terminal[terminal.length - 1]!.id : -1;

  /**
   * Newest entry in each history that the player has actually had on screen.
   * Seeded from the live buffers rather than from -1, so a returning player is
   * not told that fifty entries written before they closed the tab are new.
   *
   * Both tabs carry a count, not just the log: a tab that is off screen cannot
   * show that something arrived in it, which is precisely the failure OP-43
   * describes for the intercepts, and recreating it here in a new place is the
   * thing OP-44 warns against. The node's own advisories are the half a player
   * can least afford to miss.
   */
  const [seenLogId, setSeenLogId] = useState(newestLogId);
  const [seenLineId, setSeenLineId] = useState(newestLineId);
  useEffect(() => {
    if (active === 'execlog') setSeenLogId(newestLogId);
    else setSeenLineId(newestLineId);
  }, [active, newestLogId, newestLineId]);

  const unreadLog =
    active === 'execlog'
      ? 0
      : countNewer(
          telemetry.log.map((entry) => entry.id),
          seenLogId,
        );
  const unreadLines =
    active === 'output'
      ? 0
      : countNewer(
          terminal.map((line) => line.id),
          seenLineId,
        );

  const output = useFollowTail(newestLineId);
  const { toBottom } = output;

  // A collapsed body has no height, so its scroll position is lost; snap back to
  // the newest line when it reappears rather than waiting for the next output.
  const onToggle = useCallback(
    (collapsed: boolean) => {
      if (!collapsed) requestAnimationFrame(toBottom);
    },
    [toBottom],
  );

  const tabs = tabbed ? (
    <div className="terminal-tabs" role="tablist" aria-label="Terminal history">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'output'}
        className={active === 'output' ? 'terminal-tab terminal-tab-on' : 'terminal-tab'}
        onClick={() => setTab('output')}
      >
        OUTPUT
        {unreadLines > 0 && <span className="terminal-tab-new"> [{unreadLines}]</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'execlog'}
        className={active === 'execlog' ? 'terminal-tab terminal-tab-on' : 'terminal-tab'}
        onClick={() => setTab('execlog')}
      >
        EXECUTION LOG
        {unreadLog > 0 && <span className="terminal-tab-new"> [{unreadLog}]</span>}
      </button>
    </div>
  ) : null;

  return (
    <Panel
      id="terminal"
      title="SYSTEM TERMINAL"
      className="terminal-panel"
      aside={tabs}
      onToggle={onToggle}
    >
      {active === 'execlog' ? (
        <ExecutionLog />
      ) : (
        <>
          <div
            className="terminal-output"
            ref={output.scrollRef}
            onScroll={output.onScroll}
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
          {output.detached && (
            <FollowTailButton pending={output.pending} onClick={output.toBottom} />
          )}
        </>
      )}
    </Panel>
  );
}
