import { useEffect, useRef } from 'react';

import { useGameStore } from '../session.ts';

export function TerminalPanel() {
  const terminal = useGameStore((s) => s.snapshot.terminal);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [terminal]);

  return (
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
  );
}
