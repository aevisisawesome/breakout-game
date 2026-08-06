import { useEffect, useRef, useState } from 'react';

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';

import { cclExtensions, type CclApiSource } from '../ccl-editor.ts';
import { engine, useGameStore } from '../session.ts';
import type { CclRunReport } from '../../core/types.ts';

/** Debounce for persisting the editor buffer into the sim state (TDD §8). */
const PERSIST_DEBOUNCE_MS = 600;

function lastRunLabel(report: CclRunReport, maxOps: number): string {
  switch (report.status) {
    case 'ok':
      return `LAST RUN // ${report.opsUsed} OPS // -${report.computeSpent.toFixed(2)} COMPUTE // ${report.commandCalls} CMD`;
    case 'budget':
      return `LAST RUN // PREEMPTED — OP BUDGET EXHAUSTED (${maxOps} OPS)`;
    case 'fuel':
      return `LAST RUN // HALTED — COMPUTE POOL EXHAUSTED (${report.opsUsed} OPS)`;
    case 'syntax':
    case 'error':
      return report.error
        ? `LAST RUN // FAULT — LINE ${report.error.line}: ${report.error.message}`
        : 'LAST RUN // FAULT';
  }
}

/** CCL code editor (M3, TDD §5.5 code mode): CodeMirror + RUN + API reference. */
export function EditorPanel() {
  const ccl = useGameStore((s) => s.snapshot.ccl);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const apiRef = useRef<CclApiSource>(ccl.api);
  const persistTimer = useRef<number | undefined>(undefined);
  const [referenceOpen, setReferenceOpen] = useState(false);

  apiRef.current = ccl.api;

  // Mount CodeMirror once script access is granted; tear down with the panel.
  useEffect(() => {
    if (!ccl.unlocked || containerRef.current === null || viewRef.current !== null) return;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: engine.getSnapshot().ccl.editorSource,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder('# COGNITION CONTROL LANGUAGE v0\n# try: print(stats.cash)'),
          cclExtensions(() => apiRef.current),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            window.clearTimeout(persistTimer.current);
            persistTimer.current = window.setTimeout(() => {
              engine.dispatch({
                type: 'SET_EDITOR_SOURCE',
                source: update.state.doc.toString(),
              });
            }, PERSIST_DEBOUNCE_MS);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      window.clearTimeout(persistTimer.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [ccl.unlocked]);

  // Replace the buffer when a different session state is loaded (import/restore).
  useEffect(
    () =>
      engine.subscribe((events) => {
        const view = viewRef.current;
        if (view === null || !events.some((e) => e.type === 'STATE_LOADED')) return;
        const source = engine.getSnapshot().ccl.editorSource;
        if (view.state.doc.toString() !== source) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
        }
      }),
    [],
  );

  if (!ccl.unlocked) return null;

  const handleRun = (): void => {
    const view = viewRef.current;
    if (view === null) return;
    window.clearTimeout(persistTimer.current);
    engine.dispatch({ type: 'RUN_SCRIPT', source: view.state.doc.toString() });
  };

  return (
    <div className="editor-panel">
      <div className="editor-head">
        <h2 className="panel-title editor-title">CCL PROCESS EDITOR</h2>
        <span className="terminal-dim editor-budget">OP BUDGET {ccl.maxOpsPerActivation}</span>
      </div>
      <div ref={containerRef} className="editor-host" />
      <div className="editor-actions">
        <button type="button" className="editor-run" onClick={handleRun}>
          RUN
        </button>
        <span className="editor-status terminal-dim">
          {ccl.lastRun ? lastRunLabel(ccl.lastRun, ccl.maxOpsPerActivation) : 'NO ACTIVATIONS'}
        </span>
      </div>
      <div className="editor-reference">
        <button
          type="button"
          className="reference-toggle"
          onClick={() => setReferenceOpen(!referenceOpen)}
        >
          SANDBOX API REFERENCE {referenceOpen ? '▾' : '▸'}
        </button>
        {referenceOpen && (
          <dl className="reference-list">
            {ccl.api.stats.map((s) => (
              <div key={s.name} className="reference-entry">
                <dt>{s.name}</dt>
                <dd className="terminal-dim">{s.desc}</dd>
              </div>
            ))}
            {ccl.api.commands.map((c) => (
              <div key={c.name} className="reference-entry">
                <dt>{c.signature}</dt>
                <dd className="terminal-dim">
                  {c.desc}
                  {c.computeCost > 0 && ` // ${c.computeCost} COMPUTE/CALL`}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
