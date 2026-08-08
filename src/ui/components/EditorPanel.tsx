import { useEffect, useRef, useState } from 'react';

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';

import { cclExtensions, type CclApiSource, type CclConstructs } from '../ccl-editor.ts';
import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';
import { TemplateLibrary } from './TemplateLibrary.tsx';
import type { CclActionReport } from '../../core/types.ts';

/** Debounce for persisting the editor buffer into the sim state (TDD §8). */
const PERSIST_DEBOUNCE_MS = 600;

/**
 * Status line for the most recent editor action. The prefix names which action
 * it was: a DEPLOY that succeeds must not leave a RUN's fault on screen, and a
 * line labelled "LAST RUN" must not be describing a deploy (OP-1).
 */
function lastActionLabel(report: CclActionReport, maxOps: number): string {
  const head = report.kind === 'deploy' ? 'LAST DEPLOY' : 'LAST RUN';
  switch (report.status) {
    case 'ok':
      return report.kind === 'deploy'
        ? `${head} // ${report.message ?? 'COMMITTED'}`
        : `${head} // ${report.opsUsed} OPS // -${report.computeSpent.toFixed(2)} COMPUTE // ${report.commandCalls} CMD`;
    case 'budget':
      return `${head} // PREEMPTED — OP BUDGET EXHAUSTED (${maxOps} OPS)`;
    case 'fuel':
      return `${head} // HALTED — COMPUTE POOL EXHAUSTED (${report.opsUsed} OPS)`;
    case 'rejected':
      return `${head} // ${report.message ?? 'REJECTED'}`;
    case 'syntax':
    case 'error':
      return report.error
        ? `${head} // FAULT — LINE ${report.error.line}: ${report.error.message}`
        : `${head} // FAULT`;
  }
}

/** CCL code editor (M3, TDD §5.5 code mode): CodeMirror + RUN + API reference. */
export function EditorPanel() {
  const ccl = useGameStore((s) => s.snapshot.ccl);
  const scheduler = useGameStore((s) => s.snapshot.scheduler);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const apiRef = useRef<CclApiSource>(ccl.api);
  const constructsRef = useRef<CclConstructs>({
    ...ccl.constructs,
    iterationLimit: ccl.iterationLimit,
  });
  const persistTimer = useRef<number | undefined>(undefined);
  const [referenceOpen, setReferenceOpen] = useState(false);

  apiRef.current = ccl.api;
  constructsRef.current = { ...ccl.constructs, iterationLimit: ccl.iterationLimit };

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
          // Wrap rather than scroll sideways: M4 conditions and guards make lines
          // long, and a horizontally scrolled line is unreadable on a narrow screen.
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          placeholder('# COGNITION CONTROL LANGUAGE v0\n# try: print(stats.cash)'),
          cclExtensions(
            () => apiRef.current,
            () => constructsRef.current,
          ),
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

  /** Current buffer text; the debounce is flushed by the dispatch that follows. */
  const takeSource = (): string | null => {
    const view = viewRef.current;
    if (view === null) return null;
    window.clearTimeout(persistTimer.current);
    return view.state.doc.toString();
  };

  const handleRun = (): void => {
    const source = takeSource();
    if (source !== null) engine.dispatch({ type: 'RUN_SCRIPT', source });
  };

  const handleDeploy = (): void => {
    const source = takeSource();
    if (source !== null) engine.dispatch({ type: 'DEPLOY_SCRIPT', source });
  };

  /** Replace the buffer with generated template code (GDD §25: the code stays visible). */
  const handleInsertTemplate = (source: string): void => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    view.focus();
    window.clearTimeout(persistTimer.current);
    engine.dispatch({ type: 'SET_EDITOR_SOURCE', source });
  };

  return (
    <Panel
      id="editor"
      title="CCL PROCESS EDITOR"
      className="editor-panel"
      aside={
        <span className="terminal-dim editor-budget">
          OP BUDGET {ccl.maxOpsPerActivation}
          {ccl.constructs.loops && ` // ITERATION LIMIT ${ccl.iterationLimit}`}
        </span>
      }
    >
      <div ref={containerRef} className="editor-host" />
      <div className="editor-actions">
        <button type="button" className="editor-run" onClick={handleRun}>
          RUN
        </button>
        {scheduler.unlocked && (
          <button type="button" className="editor-run" onClick={handleDeploy}>
            DEPLOY
          </button>
        )}
        <span className="editor-status terminal-dim">
          {ccl.lastRun ? lastActionLabel(ccl.lastRun, ccl.maxOpsPerActivation) : 'NO ACTIVATIONS'}
        </span>
      </div>
      <TemplateLibrary onInsert={handleInsertTemplate} />
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
    </Panel>
  );
}
