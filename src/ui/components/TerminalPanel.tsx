import { useCallback, useEffect, useRef } from 'react';

import { useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

export function TerminalPanel() {
  const terminal = useGameStore((s) => s.snapshot.terminal);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(toBottom, [terminal, toBottom]);

  // A collapsed body has no height, so its scroll position is lost; snap back to
  // the newest line when it reappears rather than waiting for the next output.
  const onToggle = useCallback(
    (collapsed: boolean) => {
      if (!collapsed) requestAnimationFrame(toBottom);
    },
    [toBottom],
  );

  return (
    <Panel id="terminal" title="SYSTEM TERMINAL" className="terminal-panel" onToggle={onToggle}>
      <div className="terminal-output" ref={scrollRef} aria-live="polite" aria-label="Terminal">
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
    </Panel>
  );
}
