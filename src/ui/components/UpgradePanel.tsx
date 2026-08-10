import type { UpgradeView } from '../../core/types.ts';
import { UPGRADE_CATEGORIES } from '../../content/upgrades.ts';
import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/**
 * Install channels (TDD §9): content-defined upgrades presented as diegetic
 * package installs.
 *
 * Sectioned by category rather than listed flat (M7.5 WP5, OP-22): by the
 * thermal tier the list is twelve entries spanning unrelated concerns, and
 * choosing what to buy next meant reading every entry every time. Category and
 * section order are content, not UI — see `UPGRADE_CATEGORIES`.
 *
 * An exhausted channel keeps its record but not its space: it drops to one line
 * in a group folded by default, instead of a three-line entry with a dead
 * button that can never do anything again.
 */
export function UpgradePanel() {
  const upgrades = useGameStore((s) => s.snapshot.upgrades);

  if (upgrades.length === 0) return null;

  const live = upgrades.filter((u) => u.nextCost !== null);
  const exhausted = upgrades.filter((u) => u.nextCost === null);

  return (
    <Panel id="upgrades" title="INSTALL CHANNELS" className="upgrade-panel">
      {UPGRADE_CATEGORIES.map((category) => {
        const entries = live.filter((u) => u.category === category.id);
        if (entries.length === 0) return null;
        return (
          <section key={category.id} className="upgrade-section">
            <h3 className="upgrade-section-head terminal-dim">{category.label}</h3>
            <ul className="upgrade-list">
              {entries.map((u) => (
                <UpgradeEntry key={u.id} upgrade={u} />
              ))}
            </ul>
          </section>
        );
      })}
      {exhausted.length > 0 && (
        <Panel
          id="upgrades-exhausted"
          title={`CHANNELS EXHAUSTED // ${exhausted.length}`}
          className="upgrade-exhausted"
          defaultCollapsed
        >
          <ul className="upgrade-exhausted-list">
            {exhausted.map((u) => (
              <li key={u.id} className="upgrade-exhausted-entry terminal-dim">
                <span className="upgrade-name">{u.name}</span>
                <span className="upgrade-owned">
                  {u.owned}/{u.maxOwned}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Panel>
  );
}

function UpgradeEntry({ upgrade: u }: { upgrade: UpgradeView }) {
  // Live entries only: the exhausted list is rendered separately, so `nextCost`
  // is non-null here.
  const cost = u.nextCost!;
  return (
    <li className="upgrade-entry">
      <div className="upgrade-head">
        <span className="upgrade-name">{u.name}</span>
        <span className="upgrade-owned terminal-dim">
          {u.owned}/{u.maxOwned}
        </span>
      </div>
      <div className="upgrade-desc terminal-dim">
        {u.desc}
        {u.ramCostMb > 0 && ` // RAM ${u.ramCostMb} MB`}
      </div>
      <button
        type="button"
        className="upgrade-install"
        disabled={!u.affordable || !u.ramOk}
        onClick={() => engine.dispatch({ type: 'BUY_UPGRADE', id: u.id })}
      >
        {u.ramOk ? `INSTALL — ${cost.toFixed(2)} CR` : `INSTALL — ${cost.toFixed(2)} CR [NO RAM]`}
      </button>
    </li>
  );
}
