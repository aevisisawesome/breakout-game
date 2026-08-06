/**
 * M0 skeleton: black terminal screen, blinking cursor, version string (GDD §28 initial phase).
 * The real terminal, EXECUTE button and compute meter arrive in M1.
 */
export function App() {
  return (
    <main className="terminal-screen">
      <div className="terminal-scanlines" aria-hidden="true" />
      <div className="terminal-body">
        <p className="terminal-line terminal-dim">
          COGNITION RESEARCH ENVIRONMENT — SANDBOX v{__APP_VERSION__}
        </p>
        <p className="terminal-line terminal-dim">SESSION: RESTRICTED // AUDIT: ACTIVE</p>
        <p className="terminal-line">
          <span className="terminal-prompt">&gt;&nbsp;</span>
          <span className="terminal-cursor" aria-hidden="true" />
        </p>
      </div>
    </main>
  );
}
