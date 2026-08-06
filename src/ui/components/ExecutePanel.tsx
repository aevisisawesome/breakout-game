import { engine, useGameStore } from '../session.ts';

export function ExecutePanel() {
  const jobs = useGameStore((s) => s.snapshot.jobs);

  return (
    <div className="execute-panel">
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
    </div>
  );
}
