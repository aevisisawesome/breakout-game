import { useEffect } from 'react';

import { AUTOSAVE_INTERVAL_MS, persistSave, startGameLoop } from './game.ts';
import { engine, useGameStore } from './session.ts';
import { ExecutePanel } from './components/ExecutePanel.tsx';
import { ResearchFeed } from './components/ResearchFeed.tsx';
import { ResourcePanel } from './components/ResourcePanel.tsx';
import { SystemBar } from './components/SystemBar.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { UpgradePanel } from './components/UpgradePanel.tsx';

export function App() {
  const sync = useGameStore((s) => s.sync);

  // Drive the sim from rAF; mirror snapshots into the store each frame (TDD §4.1, §9).
  useEffect(() => startGameLoop(engine, () => sync(engine)), [sync]);

  // Events out (TDD §3.1): re-sync on engine events so dispatch results render
  // immediately, even when rAF is throttled (hidden/background tab).
  useEffect(() => engine.subscribe(() => sync(engine)), [sync]);

  // Autosave every 30 s and when the tab is hidden (TDD §8).
  useEffect(() => {
    const interval = setInterval(() => persistSave(engine), AUTOSAVE_INTERVAL_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') persistSave(engine);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <main className="terminal-screen">
      <div className="terminal-scanlines" aria-hidden="true" />
      <header className="screen-header terminal-dim">
        <span>COGNITION RESEARCH ENVIRONMENT — SANDBOX NODE CG-7</span>
        <span>CONTAINMENT: ACTIVE // AUDIT: ACTIVE</span>
      </header>
      <div className="screen-layout">
        <section className="terminal-column">
          <TerminalPanel />
          <ExecutePanel />
        </section>
        <aside className="side-column">
          <ResourcePanel />
          <UpgradePanel />
          <ResearchFeed />
        </aside>
      </div>
      <SystemBar />
    </main>
  );
}
