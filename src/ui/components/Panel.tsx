import { useCallback, useState, type ReactNode } from 'react';

/**
 * Collapsible panel shell (OP-2). Every panel gained a title that folds its
 * body away, because the page grows monotonically as tiers unlock and a panel
 * that is irrelevant right now could not be got out of the way — worst on
 * narrow screens, where everything is one column.
 *
 * The body is hidden with CSS rather than unmounted: collapsing must not destroy
 * the CodeMirror instance (whose buffer persists on a 600 ms debounce) or reset
 * the terminal's scroll position.
 *
 * Collapse state is presentation, not game state, so it lives in localStorage
 * rather than in the sim (TDD §9 puts *unlock* state in the sim; this is neither
 * unlocked nor earned).
 */

const STORAGE_KEY = 'breakout.ui.collapsed.v1';

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // A full or unavailable store only costs the preference, never the session.
  }
}

/** Shared across panels so one panel's toggle does not re-read the store for all. */
let collapsedIds = readCollapsed();

export interface PanelProps {
  /** Stable key for the persisted collapse state. */
  id: string;
  title: string;
  /** Class on the panel root, so existing per-panel styling keeps working. */
  className: string;
  /** Optional header content shown beside the title (e.g. the editor's budget). */
  aside?: ReactNode;
  /** Called when the body is folded or unfolded, for panels that must re-measure. */
  onToggle?: (collapsed: boolean) => void;
  children: ReactNode;
}

export function Panel({ id, title, className, aside, onToggle, children }: PanelProps) {
  const [collapsed, setCollapsed] = useState(() => collapsedIds.has(id));

  const toggle = useCallback(() => {
    setCollapsed((wasCollapsed) => {
      const next = new Set(collapsedIds);
      if (wasCollapsed) next.delete(id);
      else next.add(id);
      collapsedIds = next;
      writeCollapsed(next);
      onToggle?.(!wasCollapsed);
      return !wasCollapsed;
    });
  }, [id, onToggle]);

  return (
    <section className={collapsed ? `${className} panel-collapsed` : className}>
      <div className="panel-head">
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={!collapsed}
          onClick={toggle}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <span className="panel-caret" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="panel-title">{title}</span>
        </button>
        {aside}
      </div>
      <div className="panel-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
