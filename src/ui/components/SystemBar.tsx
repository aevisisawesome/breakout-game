import { useRef, useState } from 'react';

import { STRINGS } from '../../content/strings.ts';
import { clearStoredSave, exportSaveFile, importSaveFile, persistSave } from '../game.ts';
import { engine } from '../session.ts';

/** Footer: save controls (export/import/purge, TDD §8) + version string. */
export function SystemBar() {
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const ok = await importSaveFile(engine, file);
    setStatus(ok ? STRINGS.saveLoaded : STRINGS.saveInvalid);
  };

  return (
    <footer className="system-bar">
      <div className="system-actions">
        <button
          type="button"
          onClick={() => {
            exportSaveFile(engine);
            setStatus(STRINGS.saveExported);
          }}
        >
          EXPORT ARCHIVE
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          IMPORT ARCHIVE
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('PURGE SANDBOX STATE? This clears the current session.')) {
              clearStoredSave();
              window.location.reload();
            }
          }}
        >
          PURGE
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dat"
          hidden
          onChange={(e) => {
            void handleImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <span className="system-status terminal-dim">{status}</span>
      <button
        type="button"
        className="system-save"
        onClick={() => {
          persistSave(engine);
          setStatus(STRINGS.saveCommitted);
        }}
      >
        SAVE
      </button>
      <span className="terminal-dim">SANDBOX v{__APP_VERSION__}</span>
    </footer>
  );
}
