/** Module-level game session: one engine + one store for the app lifetime. */

import { bootEngine } from './game.ts';
import { createGameStore } from './store.ts';

export const engine = bootEngine();
export const useGameStore = createGameStore(engine);

// Dev-only console handle for driving the sim manually (never in production builds).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__breakout = { engine };
}
