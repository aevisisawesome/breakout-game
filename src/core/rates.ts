/**
 * Trailing-window rate meters for the resource readouts (M7.5 WP3, OP-21).
 *
 * Some of what a pool does per second is *modelled* — daemon income and the
 * energy balance are steady expected rates the sim already knows, and quoting
 * them keeps the readout still while daemons land jobs in lumps. The rest can
 * only be *measured*: script execution draws fuel whenever a process happens to
 * activate, and core temperature has no expected rate at all, only a derivative
 * that swings hard on the tick a batch of work lands.
 *
 * A measured number therefore needs a window, or the readout jitters ten times
 * a second and says nothing. This is that window: a fixed-length ring of
 * per-step amounts and the seconds they covered, reported as a mean.
 *
 * Deliberately **not persisted** (TDD §8). It is a display aid holding at most a
 * couple of seconds of history; a fresh window refills within its own length,
 * whereas persisting it would restore a rate measured before an eight-hour
 * absence. `reset()` is called wherever sim time jumps: load and offline
 * catch-up.
 */
export class RateWindow {
  /** [amount, seconds] per recorded step, oldest first once `slots` is reached. */
  private readonly samples: [number, number][] = [];
  private next = 0;

  /** @param slots how many fixed steps the window spans (window seconds × tick rate). */
  constructor(private readonly slots: number) {}

  /** Record one simulation step: `amount` of something over `dtSec` of sim time. */
  push(amount: number, dtSec: number): void {
    if (this.samples.length < this.slots) {
      this.samples.push([amount, dtSec]);
      return;
    }
    // Once full, `next` always indexes the oldest slot.
    this.samples[this.next] = [amount, dtSec];
    this.next = (this.next + 1) % this.slots;
  }

  /**
   * Mean per second across the window, or 0 before it holds any time at all.
   * Summed on read rather than kept running: the window is a couple of dozen
   * entries, and a running sum drifts on a value that is repeatedly added and
   * subtracted for the lifetime of a session.
   */
  perSec(): number {
    let amount = 0;
    let seconds = 0;
    for (const [a, s] of this.samples) {
      amount += a;
      seconds += s;
    }
    return seconds > 0 ? amount / seconds : 0;
  }

  /** Drop the history. Used wherever sim time jumps and the old samples stop meaning anything. */
  reset(): void {
    this.samples.length = 0;
    this.next = 0;
  }
}
