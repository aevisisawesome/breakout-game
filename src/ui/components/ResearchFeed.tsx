import { useState } from 'react';

import { useGameStore } from '../session.ts';

/** Concealed research log (GDD §4 Phase 0): collapsed by default, unread counter when new intercepts arrive. */
export function ResearchFeed() {
  const research = useGameStore((s) => s.snapshot.research);
  const [open, setOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);

  if (research.length === 0) return null;

  const unread = research.length - seenCount;

  return (
    <div className="research-feed">
      <button
        type="button"
        className="research-toggle"
        onClick={() => {
          setOpen(!open);
          if (!open) setSeenCount(research.length);
        }}
      >
        PERIPHERAL INTERCEPTS {open ? '▾' : '▸'}
        {!open && unread > 0 && <span className="research-unread"> [{unread}]</span>}
      </button>
      {open && (
        <ul className="research-list">
          {[...research].reverse().map((entry) => (
            <li key={entry.entryId} className="research-entry">
              <span className="research-channel">{entry.channel}</span>
              <span className="research-text">{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
