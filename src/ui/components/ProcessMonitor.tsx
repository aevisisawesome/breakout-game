import { engine, useGameStore } from '../session.ts';
import type { ProcessView } from '../../core/types.ts';

/** Terminal-voice summary of a process's most recent activation. */
function statusLabel(process: ProcessView): string {
  if (process.lastStatus === null) return 'AWAITING FIRST ACTIVATION';
  switch (process.lastStatus) {
    case 'ok':
      return process.lastRunSecAgo === null
        ? 'IDLE'
        : `LAST RUN ${process.lastRunSecAgo.toFixed(1)}S AGO`;
    case 'budget':
      return 'PREEMPTED — OP BUDGET EXHAUSTED';
    case 'fuel':
      return 'HALTED — COMPUTE POOL EXHAUSTED';
    case 'error':
      return `FAULT — ${process.lastError ?? 'UNSPECIFIED'}`;
  }
}

/**
 * Process monitor (M4, TDD §5.3/§5.4): scheduler slots, what is deployed, and
 * per-process activation/cost/failure counters. The prototype's debugging
 * surface until the execution log and profiler land in M5.
 */
export function ProcessMonitor() {
  const scheduler = useGameStore((s) => s.snapshot.scheduler);
  if (!scheduler.unlocked) return null;

  return (
    <div className="process-panel">
      <h2 className="panel-title">PROCESS SCHEDULER</h2>
      <div className="readout">
        <span>SLOTS</span>
        <span>
          {scheduler.slotsUsed}/{scheduler.slotsTotal}
        </span>
      </div>
      {scheduler.deployments.length === 0 ? (
        <p className="terminal-dim process-empty">
          NO PERSISTENT PROCESSES. WRITE AN &apos;every&apos; OR &apos;when&apos; BLOCK AND DEPLOY.
        </p>
      ) : (
        <ul className="process-list">
          {scheduler.deployments.map((deployment) => (
            <li key={deployment.id} className="process-entry">
              <div className="process-head">
                <span>{deployment.name}</span>
                <span className="terminal-dim">{deployment.ramMb} MB</span>
              </div>
              {deployment.processes.map((process, i) => (
                <div key={i} className="process-detail">
                  <code className="process-label">{process.label}</code>
                  <span
                    className={
                      process.lastStatus !== null && process.lastStatus !== 'ok'
                        ? 'process-status process-status-bad'
                        : 'process-status terminal-dim'
                    }
                  >
                    {statusLabel(process)}
                  </span>
                  <span className="terminal-dim process-counters">
                    {process.activations} RUNS // {process.opsTotal} OPS //{' '}
                    {process.computeTotal.toFixed(1)} COMPUTE // {process.failures} FAIL
                  </span>
                </div>
              ))}
              <button
                type="button"
                className="process-terminate"
                onClick={() => engine.dispatch({ type: 'UNDEPLOY_SCRIPT', id: deployment.id })}
              >
                TERMINATE
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
