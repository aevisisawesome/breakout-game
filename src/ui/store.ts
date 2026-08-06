/**
 * UI-side store (TDD §2: Zustand). Holds the latest immutable sim snapshot;
 * components subscribe to slices without prop-drilling. The engine remains the
 * single source of truth — this store only mirrors getSnapshot().
 */

import { create } from 'zustand';

import type { GameEngine, GameSnapshot } from '../core/types.ts';

interface GameStore {
  snapshot: GameSnapshot;
  /** Re-read the engine snapshot; no-op re-render-wise if the revision is unchanged. */
  sync(engine: GameEngine): void;
}

export function createGameStore(engine: GameEngine) {
  return create<GameStore>((set, get) => ({
    snapshot: engine.getSnapshot(),
    sync(e: GameEngine): void {
      const next = e.getSnapshot();
      if (next.revision !== get().snapshot.revision) {
        set({ snapshot: next });
      }
    },
  }));
}

export type GameStoreHook = ReturnType<typeof createGameStore>;
