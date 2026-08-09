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
      <InboundMeter />
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

/**
 * Inbound request traffic (M7.5 WP1a, OP-16). The one live element on the
 * opening screen: the bar fills towards the next arriving request and empties
 * as it lands, roughly once a second at the starting rate. It is real state —
 * the sim's fractional arrival accumulator — not decoration, and it answers the
 * question an empty queue raises, which is "how long until there is work".
 */
function InboundMeter() {
  const jobs = useGameStore((s) => s.snapshot.jobs);
  // A full queue still takes traffic — it is dropped upstream — so say that
  // rather than counting down to an arrival the player will never see.
  const full = jobs.waiting >= jobs.queueCapacity;
  const next = Number.isFinite(jobs.secondsToNextArrival)
    ? `${jobs.secondsToNextArrival.toFixed(1)}S`
    : '--';

  return (
    <div className="meter inbound-meter">
      <div className="meter-label">
        <span>INBOUND</span>
        <span>
          {jobs.arrivalPerSec.toFixed(1)}/S {full ? '— QUEUE FULL' : `— NEXT ${next}`}
        </span>
      </div>
      <div className="meter-track">
        <div
          className="meter-fill inbound-fill"
          style={{ width: `${jobs.arrivalProgress * 100}%` }}
        />
      </div>
    </div>
  );
}
