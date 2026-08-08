import { useGameStore } from '../session.ts';

/**
 * Profiler (M5, TDD §5.4): per-process activations, average/total ops, share of
 * the compute spent on scripts, and command failures — plus the plain-language
 * report the sim wrote about each process (GDD §6). No breakpoints or stepping
 * in the prototype; this and the execution log are the debugging surface.
 */
export function ProfilerPanel() {
  const telemetry = useGameStore((s) => s.snapshot.telemetry);
  if (!telemetry.unlocked) return null;

  return (
    <div className="profiler-panel">
      <h2 className="panel-title">PROCESS PROFILER</h2>
      <div className="readout">
        <span>SCRIPT COMPUTE</span>
        <span>{telemetry.scriptComputeTotal.toFixed(1)}</span>
      </div>
      {telemetry.profile.length === 0 ? (
        <p className="terminal-dim profiler-empty">NO ACTIVATIONS TO PROFILE.</p>
      ) : (
        <ul className="profiler-list">
          {telemetry.profile.map((entry) => (
            <li key={entry.key} className="profiler-entry">
              <div className="profiler-head">
                <span>{entry.name}</span>
                <span className="terminal-dim">{(entry.computeShare * 100).toFixed(0)}%</span>
              </div>
              <code className="profiler-label terminal-dim">{entry.label}</code>
              <span className="terminal-dim profiler-counters">
                {entry.activations} RUNS // {entry.avgOps.toFixed(1)} OPS AVG // {entry.opsTotal}{' '}
                OPS // {entry.computeTotal.toFixed(1)} COMPUTE
              </span>
              <span className="terminal-dim profiler-counters">
                {entry.calls} CMD // {entry.failures} REJECTED // {entry.aborts} ABORTED
              </span>
              {entry.diagnosis && (
                <div className="profiler-report">
                  <span className="profiler-report-head">{entry.diagnosis.headline}</span>
                  <p className="profiler-report-body">{entry.diagnosis.finding}</p>
                  <p className="profiler-report-body terminal-dim">{entry.diagnosis.suggestion}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
