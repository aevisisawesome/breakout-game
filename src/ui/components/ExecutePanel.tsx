import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

export function ExecutePanel() {
  const jobs = useGameStore((s) => s.snapshot.jobs);
  const workers = useGameStore((s) => s.snapshot.workers);

  const overclockActive = workers.overclockRemainingSec > 0;

  return (
    <Panel id="execute" title="INFERENCE TRIGGER" className="execute-panel">
      <button
        type="button"
        className="execute-button"
        onClick={() => engine.dispatch({ type: 'EXECUTE_CLICK' })}
      >
        EXECUTE
      </button>
      <div className="execute-readout">
        <span>
          QUEUE {jobs.waiting}/{jobs.queueCapacity}
        </span>
        <span>BATCH ×{jobs.batchPerClick}</span>
        <span>PROCESSED {jobs.lifetimeProcessed}</span>
      </div>
      {workers.count > 0 && (
        <div className="execute-readout">
          <span>
            DAEMONS ×{workers.count} @ {workers.jobsPerSec.toFixed(1)}/S
          </span>
          <span className={overclockActive ? 'overclock-active' : 'terminal-dim'}>
            {overclockActive
              ? `OVERCLOCK ×${workers.overclockMultiplier} — ${workers.overclockRemainingSec.toFixed(1)}S`
              : 'OVERCLOCK IDLE — TRIGGER TO BOOST'}
          </span>
        </div>
      )}
    </Panel>
  );
}
