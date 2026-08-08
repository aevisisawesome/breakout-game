/**
 * Engine bootstrap + browser-side persistence (TDD §8).
 * All browser APIs (localStorage, rAF, timers) live here in /ui — never in /core.
 */

import { createGameEngine, TICK_MS } from '../core/engine.ts';
import { toSeed } from '../core/prng.ts';
import { deserializeSave, serializeSave } from '../core/save.ts';
import type { GameEngine } from '../core/types.ts';

export const SAVE_STORAGE_KEY = 'breakout.save.v1';
/** Separate slot for the dev-handle backup (OP-7); never read on boot. */
export const SAVE_BACKUP_KEY = 'breakout.save.backup';
export const AUTOSAVE_INTERVAL_MS = 30_000;

export function loadStoredSave(): ReturnType<typeof deserializeSave> {
  const raw = localStorage.getItem(SAVE_STORAGE_KEY);
  return raw === null ? null : deserializeSave(raw);
}

/**
 * Snapshot the live session into the backup slot (OP-7). Paired with
 * `readBackupSave` + `engine.load`, this is the only safe way to force state
 * during a playtest: restoring through the engine means the next autosave
 * commits the restored state rather than the crafted one.
 */
export function writeBackupSave(engine: GameEngine): void {
  localStorage.setItem(SAVE_BACKUP_KEY, serializeSave(engine.save(Date.now())));
}

export function readBackupSave(): ReturnType<typeof deserializeSave> {
  const raw = localStorage.getItem(SAVE_BACKUP_KEY);
  return raw === null ? null : deserializeSave(raw);
}

export function persistSave(engine: GameEngine): void {
  localStorage.setItem(SAVE_STORAGE_KEY, serializeSave(engine.save(Date.now())));
}

export function clearStoredSave(): void {
  localStorage.removeItem(SAVE_STORAGE_KEY);
}

/** Export the current save as a downloadable base64 archive (TDD §8). */
export function exportSaveFile(engine: GameEngine): void {
  const base64 = btoa(serializeSave(engine.save(Date.now())));
  const blob = new Blob([base64], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `breakout-archive-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.dat`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Import an archive produced by exportSaveFile. Returns false if the file is invalid. */
export async function importSaveFile(engine: GameEngine, file: File): Promise<boolean> {
  let text: string;
  try {
    text = atob((await file.text()).trim());
  } catch {
    return false;
  }
  const save = deserializeSave(text);
  if (!save) return false;
  engine.load(save);
  persistSave(engine);
  return true;
}

/** Create the engine, restoring a stored session (with offline catch-up) when one exists. */
export function bootEngine(): GameEngine {
  const engine = createGameEngine(toSeed(Date.now()));
  const stored = loadStoredSave();
  if (stored) {
    engine.load(stored);
    engine.advanceOffline(Date.now() - stored.savedAt);
  }
  return engine;
}

/**
 * Drive the sim from requestAnimationFrame (TDD §4.1). The engine consumes elapsed
 * real time in fixed 100 ms steps internally. Returns a stop function.
 */
export function startGameLoop(engine: GameEngine, onFrame: () => void): () => void {
  let last = performance.now();
  let handle = 0;
  const frame = (now: number): void => {
    // Clamp pathological frame gaps; long absences belong to the offline path (M2+).
    const dt = Math.min(now - last, TICK_MS * 1000);
    last = now;
    engine.tick(dt);
    onFrame();
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(handle);
}
