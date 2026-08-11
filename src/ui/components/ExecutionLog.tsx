import { useGameStore } from '../session.ts';
import { useFollowTail } from '../follow-tail.ts';
import { newestId } from '../unread.ts';
import { FollowTailButton } from './FollowTailButton.tsx';
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
 * Execution log (M5, TDD §5.4): the ring buffer of script activations. Deployed
 * processes are quiet in the terminal by design (they would flood it), so this
 * is where their per-activation detail lives.
 *
 * Since M7.6 WP1 it is the second tab of the system terminal rather than a
 * panel of its own (OP-44), and it reads **oldest-first, following the tail**
 * like the terminal beside it — the two tabs had to agree about direction, and
 * the terminal's is the one that matches how the histories are written.
 */
export function ExecutionLog() {
  const log = useGameStore((s) => s.snapshot.telemetry.log);
  const follow = useFollowTail<HTMLOListElement>(newestId(log.map((entry) => entry.id)));

  if (log.length === 0) {
    return <p className="terminal-dim log-empty">NO ACTIVATIONS RECORDED.</p>;
  }

  return (
    <>
      <ol className="log-list" ref={follow.scrollRef} onScroll={follow.onScroll}>
        {log.map((entry) => (
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
      {follow.detached && <FollowTailButton pending={follow.pending} onClick={follow.toBottom} />}
    </>
  );
}
