import { useState, type ReactNode } from 'react';

import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';
import type { DeploymentView, ProcessView, ProfileEntryView } from '../../core/types.ts';

/**
 * Process table (M7.5 WP4a, OP-25). One panel per process, not two.
 *
 * PROCESS SCHEDULER (M4) and PROCESS PROFILER (M5) were keyed on the same
 * processes and rendered five of the same fields, divided by which milestone
 * built them rather than by what they answer. They are now one row with two
 * halves: **live state** — what it is, when it last ran, whether it is faulting —
 * always visible, and **accumulated cost plus the plain-language report** (GDD §6)
 * behind a per-row disclosure, because a player asking "what is running?" is not
 * the same player asking "what is it costing me?".
 *
 * The cost half is gated on the instrumentation unlock exactly as the profiler
 * panel was, so the tier still buys something visible; a diagnosis headline is
 * hoisted onto the live row so a failing process cannot hide inside a fold.
 *
 * M7.5 WP4b adds the lifecycle controls the merge was decided for: a process can
 * be designated (OP-12), pulled back into the editor and replaced in place
 * (OP-13), and held without losing its counters (OP-14).
 */

/** Terminal-voice summary of a process's most recent activation. */
function statusLabel(process: ProcessView, paused: boolean): string {
  // A held process is not idle and has not faulted — it is stopped on purpose,
  // and its last status would otherwise read as if it were still working.
  if (paused) return 'HELD — SCHEDULE SUSPENDED';
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

/** The cost/diagnosis half of a row: counters, share, and the GDD §6 report. */
function CostDetail({ entry }: { entry: ProfileEntryView }) {
  return (
    <div className="process-cost-body">
      <span className="terminal-dim process-counters">
        {entry.avgOps.toFixed(1)} OPS AVG // {entry.opsTotal} OPS // {entry.computeTotal.toFixed(1)}{' '}
        COMPUTE // {(entry.computeShare * 100).toFixed(0)}% SHARE
      </span>
      <span className="terminal-dim process-counters">
        {entry.calls} CMD // {entry.failures} REJECTED // {entry.aborts} ABORTED
      </span>
      {entry.diagnosis && (
        <div className="process-report">
          <span className="process-report-head">{entry.diagnosis.headline}</span>
          <p className="process-report-body">{entry.diagnosis.finding}</p>
          <p className="process-report-body terminal-dim">{entry.diagnosis.suggestion}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Disclosure button + body, shared by process rows and the manual-run row.
 * `banner` is shown only while the section is folded — it exists so a diagnosis
 * can shout from the closed row without saying the same word twice once opened.
 */
function CostSection({ entry, banner }: { entry: ProfileEntryView; banner?: ReactNode }) {
  // Expansion is per row and deliberately transient: unlike panel collapse
  // (OP-2) this is "look closer at this one", not a standing preference.
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && banner}
      <button
        type="button"
        className="process-cost-toggle"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="panel-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        COST DETAIL
      </button>
      {open && <CostDetail entry={entry} />}
    </>
  );
}

/** One deployed process: live state always, cost on demand. */
function ProcessRow({
  process,
  entry,
  paused,
}: {
  process: ProcessView;
  entry: ProfileEntryView | null;
  paused: boolean;
}) {
  const bad = !paused && process.lastStatus !== null && process.lastStatus !== 'ok';
  return (
    <div className="process-detail">
      <code className="process-label">{process.label}</code>
      <span
        className={
          bad
            ? 'process-status process-status-bad'
            : paused
              ? 'process-status process-status-held'
              : 'process-status terminal-dim'
        }
      >
        {statusLabel(process, paused)}
      </span>
      <span className="terminal-dim process-counters">
        {process.activations} RUNS // {process.failures} FAIL
      </span>
      {entry && (
        <CostSection
          entry={entry}
          banner={
            entry.diagnosis ? (
              <span className="process-status process-status-bad">
                DIAGNOSIS // {entry.diagnosis.headline}
              </span>
            ) : null
          }
        />
      )}
    </div>
  );
}

/**
 * Head, controls and rows of one deployment. The three lifecycle controls sit on
 * one line under the rows because they act on the whole deployment, not on a
 * single declaration — a script may hold two processes in two slots, and holding
 * half of it would be a different feature.
 */
function DeploymentEntry({
  deployment,
  labelMaxChars,
  editorBuffer,
  entryFor,
}: {
  deployment: DeploymentView;
  labelMaxChars: number;
  editorBuffer: string;
  entryFor: (key: string) => ProfileEntryView | null;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  // Pulling a deployment's source over the editor destroys whatever is in the
  // buffer (OP-13's first flow question). Rather than a modal, the button asks
  // twice — and only when there is something to lose.
  const [confirmEdit, setConfirmEdit] = useState(false);
  const clobbers = editorBuffer.trim().length > 0 && editorBuffer !== deployment.source;

  const commitRename = (): void => {
    engine.dispatch({
      type: 'RENAME_DEPLOYMENT',
      id: deployment.id,
      label: draft.trim().length > 0 ? draft : null,
    });
    setRenaming(false);
  };

  return (
    <li className="process-entry">
      <div className="process-head">
        <span>
          {deployment.name}
          {deployment.label !== null && (
            <span className="process-designation"> {deployment.label}</span>
          )}
        </span>
        <span className="terminal-dim">
          {deployment.paused && 'HELD // '}
          {deployment.ramMb} MB
        </span>
      </div>
      {renaming ? (
        <div className="process-rename">
          <input
            className="process-rename-input"
            type="text"
            autoFocus
            maxLength={labelMaxChars}
            value={draft}
            aria-label={`DESIGNATION FOR ${deployment.name}`}
            placeholder="DESIGNATION"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
          <button type="button" className="process-control" onClick={commitRename}>
            SET
          </button>
        </div>
      ) : null}
      {deployment.processes.map((process) => (
        <ProcessRow
          key={process.profileKey}
          process={process}
          entry={entryFor(process.profileKey)}
          paused={deployment.paused}
        />
      ))}
      <div className="process-controls">
        <button
          type="button"
          className="process-control"
          onClick={() => {
            setDraft(deployment.label ?? '');
            setRenaming((was) => !was);
          }}
        >
          {renaming ? 'CANCEL' : 'DESIGNATE'}
        </button>
        <button
          type="button"
          className="process-control"
          onClick={() =>
            engine.dispatch({
              type: 'SET_DEPLOYMENT_PAUSED',
              id: deployment.id,
              paused: !deployment.paused,
            })
          }
        >
          {deployment.paused ? 'RESUME' : 'HOLD'}
        </button>
        <button
          type="button"
          className={confirmEdit ? 'process-control process-control-warn' : 'process-control'}
          onClick={() => {
            if (clobbers && !confirmEdit) {
              setConfirmEdit(true);
              return;
            }
            setConfirmEdit(false);
            engine.dispatch({ type: 'REVISE_DEPLOYMENT', id: deployment.id });
          }}
          onBlur={() => setConfirmEdit(false)}
        >
          {confirmEdit ? 'OVERWRITE BUFFER?' : 'REVISE'}
        </button>
      </div>
      <button
        type="button"
        className="process-terminate"
        onClick={() => engine.dispatch({ type: 'UNDEPLOY_SCRIPT', id: deployment.id })}
      >
        TERMINATE
      </button>
    </li>
  );
}

export function ProcessTable() {
  const scheduler = useGameStore((s) => s.snapshot.scheduler);
  const telemetry = useGameStore((s) => s.snapshot.telemetry);
  // Read only to decide whether REVISE would destroy unsaved work (OP-13).
  const editorSource = useGameStore((s) => s.snapshot.ccl.editorSource);
  if (!scheduler.unlocked && !telemetry.unlocked) return null;

  // Cost is telemetry's to give: before the instrumentation unlock the rows
  // carry live state only, which is what the scheduler tier shipped with.
  const profile = telemetry.unlocked ? telemetry.profile : [];
  const byKey = new Map(profile.map((entry) => [entry.key, entry]));
  // Whatever the profile holds that no deployed process claims is cost without a
  // slot — the manual-RUN aggregate today. Derived rather than matched by name,
  // so a second such row would appear on its own.
  const deployed = new Set(
    scheduler.deployments.flatMap((d) => d.processes.map((p) => p.profileKey)),
  );
  const unscheduled = profile.filter((entry) => !deployed.has(entry.key));

  return (
    <Panel id="scheduler" title="PROCESS TABLE" className="process-panel">
      <div className="readout">
        <span>SLOTS</span>
        <span>
          {scheduler.slotsUsed}/{scheduler.slotsTotal}
        </span>
      </div>
      {telemetry.unlocked && (
        <div className="readout">
          <span>SCRIPT COMPUTE</span>
          <span>{telemetry.scriptComputeTotal.toFixed(1)}</span>
        </div>
      )}
      {scheduler.deployments.length === 0 ? (
        <p className="terminal-dim process-empty">
          NO PERSISTENT PROCESSES. WRITE AN &apos;every&apos; OR &apos;when&apos; BLOCK AND DEPLOY.
        </p>
      ) : (
        <ul className="process-list">
          {scheduler.deployments.map((deployment) => (
            <DeploymentEntry
              key={deployment.id}
              deployment={deployment}
              labelMaxChars={scheduler.labelMaxChars}
              editorBuffer={editorSource}
              entryFor={(key) => byKey.get(key) ?? null}
            />
          ))}
        </ul>
      )}
      {unscheduled.length > 0 && (
        <ul className="process-list">
          {unscheduled.map((entry) => (
            <li key={entry.key} className="process-entry">
              <div className="process-head">
                <span>{entry.name}</span>
                <span className="terminal-dim">NO SLOT</span>
              </div>
              <div className="process-detail">
                <code className="process-label">{entry.label}</code>
                <span className="terminal-dim process-counters">{entry.activations} RUNS</span>
                <CostSection entry={entry} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
