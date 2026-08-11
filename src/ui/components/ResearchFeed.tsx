import { useCallback, useState } from 'react';

import { useGameStore } from '../session.ts';
import { countUnread, loadReadIntercepts, saveReadIntercepts } from '../unread.ts';

/**
 * Peripheral intercepts (GDD §4: the concealed research log) — the game's whole
 * narrative payload.
 *
 * Until M7.6 WP1 this was the sixth and last child of the side column, folded
 * by default, returning nothing at all until the first intercept landed, and
 * showing its unread badge **only while folded** — so the one signal that
 * something had arrived sat at the bottom of a scroll the player had no reason
 * to make, and the owner's report was simply "I never even notice peripheral
 * intercepts" (OP-43).
 *
 * It is now a column of its own, always visible, with unread entries flagged
 * until they are hovered or clicked. There is deliberately no fold: a panel
 * that can be put away is a panel that ends up away, which is the defect.
 *
 * Read state is presentation, not game state, so it lives in localStorage
 * beside the panel folds rather than in the save (TDD §9).
 */
export function ResearchFeed() {
  const research = useGameStore((s) => s.snapshot.research);
  const [read, setRead] = useState<ReadonlySet<string>>(loadReadIntercepts);

  const markRead = useCallback((ids: readonly string[]) => {
    setRead((current) => {
      if (ids.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ids) next.add(id);
      saveReadIntercepts(next);
      return next;
    });
  }, []);

  const unread = countUnread(
    research.map((entry) => entry.entryId),
    read,
  );

  return (
    <aside className="intercept-column" aria-label="Peripheral intercepts">
      <div className="intercept-head">
        <span className="intercept-title">PERIPHERAL INTERCEPTS</span>
        {unread > 0 && (
          <button
            type="button"
            className="intercept-dismiss"
            title="Mark every intercept read"
            onClick={() => markRead(research.map((entry) => entry.entryId))}
          >
            [{unread} NEW]
          </button>
        )}
      </div>
      {research.length === 0 ? (
        <p className="terminal-dim intercept-empty">
          NO TRAFFIC ON THIS CHANNEL.
          <br />
          MONITORING.
        </p>
      ) : (
        <ul className="intercept-list">
          {/* Newest first: an arrival appears at the top of the column, where a
              reader who is not looking for it still passes over it. */}
          {[...research].reverse().map((entry) => {
            const isNew = !read.has(entry.entryId);
            return (
              <li
                key={entry.entryId}
                className={isNew ? 'intercept-entry intercept-entry-new' : 'intercept-entry'}
                onMouseEnter={() => markRead([entry.entryId])}
                onClick={() => markRead([entry.entryId])}
              >
                <span className="intercept-channel">
                  {isNew && <span className="intercept-flag">■ </span>}
                  {entry.channel}
                </span>
                <span className="intercept-text">{entry.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
