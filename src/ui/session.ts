/** Module-level game session: one engine + one store for the app lifetime. */

import {
  bootEngine,
  persistSave,
  readBackupSave,
  writeBackupSave,
  SAVE_BACKUP_KEY,
} from './game.ts';
import { createGameStore } from './store.ts';
import { serializeSave } from '../core/save.ts';

export const engine = bootEngine();
export const useGameStore = createGameStore(engine);

// Dev-only console handle for driving the sim manually (never in production builds).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__breakout = {
    engine,

    /**
     * Copy the live session into a separate backup key (OP-7).
     *
     * Backing a playtest save up by hand and restoring it by hand does not work:
     * the on-unload autosave commits whatever is in memory over the main key
     * before a reload completes, so a restore written straight to `localStorage`
     * is overwritten by the crafted state it was supposed to replace. These two
     * helpers close that hole by never touching storage directly — `restore()`
     * loads into the *engine* and then persists, so the autosave has nothing
     * stale left to commit. Force state only between a `backup()` and a
     * `restore()`, and never reload in between.
     */
    backup(): string {
      writeBackupSave(engine);
      return SAVE_BACKUP_KEY;
    },

    /** Load the backup into the engine and persist it, in that order. */
    restore(): boolean {
      const save = readBackupSave();
      if (save === null) return false;
      engine.load(save);
      persistSave(engine);
      return true;
    },

    /** Commit the live session now, without waiting for the autosave. */
    persist(): void {
      persistSave(engine);
    },

    /** Serialized current save, for eyeballing size or diffing by hand. */
    dump(): string {
      return serializeSave(engine.save(Date.now()));
    },
  };
}
