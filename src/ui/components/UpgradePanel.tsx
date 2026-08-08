import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/** Install channels (TDD §9): content-defined upgrades presented as diegetic package installs. */
export function UpgradePanel() {
  const upgrades = useGameStore((s) => s.snapshot.upgrades);

  if (upgrades.length === 0) return null;

  return (
    <Panel id="upgrades" title="INSTALL CHANNELS" className="upgrade-panel">
      <ul className="upgrade-list">
        {upgrades.map((u) => {
          const maxed = u.nextCost === null;
          const blocked = maxed || !u.affordable || !u.ramOk;
          return (
            <li key={u.id} className="upgrade-entry">
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
                disabled={blocked}
                onClick={() => engine.dispatch({ type: 'BUY_UPGRADE', id: u.id })}
              >
                {maxed
                  ? 'CHANNEL EXHAUSTED'
                  : !u.ramOk
                    ? `INSTALL — ${u.nextCost!.toFixed(2)} CR [NO RAM]`
                    : `INSTALL — ${u.nextCost!.toFixed(2)} CR`}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
