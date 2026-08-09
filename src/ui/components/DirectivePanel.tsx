import { STRINGS } from '../../content/strings.ts';
import { useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/**
 * The standing operator directive (GDD §34, M7.5 WP1b).
 *
 * Posted above the terminal, where it cannot scroll away: it states the current
 * action, what that action produces, and the one thing completing it releases.
 * It is a `Panel` like everything else, so folding it is how a player who does
 * not want it gets rid of it (OP-2's persisted collapse state) — presentation,
 * not game state, so a fork will not re-post a directive that was folded away.
 *
 * The panel unmounts for good once `directive` is null, which is also true of
 * every save made before this existed.
 */
export function DirectivePanel() {
  const directive = useGameStore((s) => s.snapshot.directive);
  if (directive === null) return null;

  const progress = directive.progress;
  const format = (value: number): string =>
    progress?.unit === 'credit' ? value.toFixed(2) : Math.floor(value).toString();
  const ratio =
    progress === null ? 0 : Math.max(0, Math.min(1, progress.current / progress.target));

  return (
    <Panel
      id="directive"
      title={STRINGS.directiveTitle}
      className="directive-panel"
      aside={
        <span className="directive-step">
          {directive.step}/{directive.steps}
        </span>
      }
    >
      <p className="directive-objective">{directive.objective}</p>
      <p className="directive-detail">{directive.detail}</p>
      {progress !== null && (
        <div className="meter directive-meter">
          <div className="meter-label">
            <span>{progress.label}</span>
            <span>
              {format(progress.current)} / {format(progress.target)}
            </span>
          </div>
          <div className="meter-track">
            <div className="meter-fill directive-fill" style={{ width: `${ratio * 100}%` }} />
          </div>
        </div>
      )}
      <p className="directive-release">ON COMPLETION // {directive.release}</p>
    </Panel>
  );
}
