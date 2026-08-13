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
  const thermal = useGameStore((s) => s.snapshot.thermal);
  // A full queue still takes traffic — it is dropped upstream — so say that
  // rather than counting down to an arrival the player will never see.
  const full = jobs.waiting >= jobs.queueCapacity;
  const next = Number.isFinite(jobs.secondsToNextArrival)
    ? `${jobs.secondsToNextArrival.toFixed(1)}S`
    : '--';

  // A demand window multiplies the inbound rate by 2.5, and until now the only
  // statement of that was a row in the thermal panel two columns away and a
  // terminal line that is now behind a tab (M7.6 WP7, OP-56). The headline moves
  // 6.0 → 15.0 with nothing beside it saying why, so say it here: the multiplier
  // that is doing it and how long it lasts, on the meter it changes.
  //
  // On its own line rather than beside the name, and short: the meter is 189–240
  // px wide depending on viewport and its label line already runs to 25 of the
  // ~30 characters that fit at 1280 px, so a marker on that line wraps both
  // halves to two rows (measured). This is not the row OP-19 warns about — that
  // one mounted and unmounted with an oscillating rate, ten times a second; a
  // demand window turns over twice every seven minutes and is a state change the
  // player is meant to notice.
  const windowMark =
    thermal.demandWindowOpen && jobs.arrivalMult !== 1
      ? `▲ PRIORITY ×${jobs.arrivalMult}${
          thermal.windowSecRemaining !== null ? ` — ${Math.ceil(thermal.windowSecRemaining)}S` : ''
        }`
      : null;

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
      {windowMark !== null && <div className="inbound-window">{windowMark}</div>}
    </div>
  );
}
