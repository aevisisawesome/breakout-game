import { useGameStore } from '../session.ts';
import { TICKS_PER_SEC } from '../../core/engine.ts';
import type { ExecLogEntry } from '../../core/types.ts';

/** Sim-time stamp for the log's left column. */
function timestamp(tick: number): string {
  const totalSec = Math.floor(tick / TICKS_PER_SEC);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(3, '0')}:${String(sec).padStart(2, '0')}`;
}

/** What the activation did, or why it stopped. Plain enough to read at a glance. */
function outcome(entry: ExecLogEntry): string {
  switch (entry.status) {
    case 'ok': {
      const parts = [`${entry.opsUsed} OPS`, `${entry.computeSpent.toFixed(2)} COMPUTE`];
      if (entry.commandCalls > 0) parts.push(`${entry.commandCalls} CMD`);
      if (entry.commandFailures > 0) parts.push(`${entry.commandFailures} REJECTED`);
      return parts.join(' // ');
    }
    case 'budget':
      return `PREEMPTED // OP BUDGET EXHAUSTED AFTER ${entry.opsUsed} OPS`;
    case 'fuel':
      return `HALTED // COMPUTE POOL EMPTY AFTER ${entry.opsUsed} OPS`;
    case 'error':
      return `FAULT // LINE ${entry.line ?? '?'}: ${entry.message ?? 'UNSPECIFIED'}`;
  }
}

/**
 * Execution log (M5, TDD §5.4): the ring buffer of script activations, newest
 * first. Deployed processes are quiet in the terminal by design (they would
 * flood it), so this is where their per-activation detail lives.
 */
export function ExecutionLog() {
  const telemetry = useGameStore((s) => s.snapshot.telemetry);
  if (!telemetry.unlocked) return null;

  return (
    <div className="log-panel">
      <h2 className="panel-title">EXECUTION LOG</h2>
      {telemetry.log.length === 0 ? (
        <p className="terminal-dim log-empty">NO ACTIVATIONS RECORDED.</p>
      ) : (
        <ol className="log-list">
          {telemetry.log.map((entry) => (
            <li
              key={entry.id}
              className={entry.status === 'ok' ? 'log-entry' : 'log-entry log-entry-bad'}
            >
              <span className="terminal-dim log-time">{timestamp(entry.tick)}</span>
              <span className="log-source">
                {entry.process === '' ? entry.label : `${entry.process} ${entry.label}`}
                {entry.kind === 'guard' && ' [GUARD]'}
              </span>
              <span className="log-outcome terminal-dim">{outcome(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
