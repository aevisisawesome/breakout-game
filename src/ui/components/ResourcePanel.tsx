import { useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/**
 * Below half the smallest printed digit a signed rate would only ever flicker
 * between `+0.00` and `-0.00`, so it reads flat instead. Presentation only —
 * the sim's number is untouched.
 */
const RATE_EPSILON = 0.005;

/** Signed per-second rate in the system voice: `+4.20/S`, `-0.35°C/S`, `0.00/S`. */
function formatRate(value: number, unit: string): string {
  if (!Number.isFinite(value) || Math.abs(value) < RATE_EPSILON) return `0.00${unit}/S`;
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}${unit}/S`;
}

/**
 * A pool with its meter and, once the readouts are granted, the signed rate it
 * is moving at (M7.5 WP3, OP-21).
 *
 * The rate lives on the label line rather than in a row of its own, and is
 * rendered whenever `rate` is supplied rather than when it is interesting. That
 * is the OP-19 fix: the old POWER DRAW row mounted only while the balance was
 * negative, so at 10 Hz an oscillating reserve resized the panel — and every
 * panel under it — ten times a second.
 */
function Meter({
  label,
  note,
  current,
  capacity,
  rate,
  unit = '',
  tone = '',
}: {
  label: string;
  /** Standing condition on this pool, shown beside its name (M7.6 WP7). */
  note?: string;
  current: number;
  capacity: number;
  rate?: number;
  unit?: string;
  tone?: string;
}) {
  const pct = capacity > 0 && Number.isFinite(capacity) ? (current / capacity) * 100 : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>
          {label}
          {note !== undefined && <span className="meter-note"> {note}</span>}
        </span>
        <span className="meter-values">
          {rate !== undefined && (
            <span className={tone === '' ? 'meter-rate' : `meter-rate meter-rate-${tone}`}>
              {formatRate(rate, unit)}
            </span>
          )}
          <span>
            {Math.floor(current)}/{capacity}
          </span>
        </span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function ResourcePanel() {
  const resources = useGameStore((s) => s.snapshot.resources);
  const unlocks = useGameStore((s) => s.snapshot.unlocks);
  const workers = useGameStore((s) => s.snapshot.workers);

  // Rates appear with the rest of the system readouts rather than at tick 0: on
  // the opening screen a node with no daemons has nothing flowing, and a fixed
  // `0.00/S` under the first meter is exactly the dead element WP1a removed.
  const rates = unlocks.systemReadouts;

  // A drained buffer throttles the daemons rather than stopping them (M7.6 WP7,
  // OP-55), and a throttle nobody can see is a throughput collapse with no cause
  // on screen — so it is named on the meter it is about, in the terms the player
  // will check it against. The state comes from the daemon half of the snapshot
  // because that is whose throughput it describes; it is drawn here because this
  // is the pool the player is looking at when they ask why.
  // Short on purpose: the meter's label line holds about 30 characters at
  // 1280 px, and spelling the condition out wrapped it to two rows (measured) —
  // which would make the tag resize the panel as well as mark it.
  const starved = workers.computeStarved;
  const starvedNote = `STARVED ×${workers.computeStarvedFactor}`;

  return (
    <Panel id="resources" title="RESOURCES" className="resource-panel">
      <Meter
        label="COMPUTE"
        {...(starved && { note: starvedNote })}
        current={resources.compute.current}
        capacity={resources.compute.capacity}
        {...(rates && { rate: resources.compute.ratePerSec })}
      />
      {unlocks.capitalReadout && (
        <div className="readout">
          <span>CAPITAL</span>
          <span>{resources.capital.current.toFixed(2)} CR</span>
        </div>
      )}
      {unlocks.systemReadouts && (
        <>
          <Meter
            label="RAM (MB)"
            current={resources.ram.current}
            capacity={resources.ram.capacity}
          />
          <Meter
            label="ENERGY"
            current={resources.energy.current}
            capacity={resources.energy.capacity}
            rate={resources.energy.ratePerSec}
            // A reserve that is emptying is the one rate worth alarming about;
            // it is what POWER DRAW meant before it became a row that came and went.
            tone={resources.energy.ratePerSec < -RATE_EPSILON ? 'bad' : ''}
          />
          <CoreTemp />
        </>
      )}
    </Panel>
  );
}

/**
 * Core temperature (M7). Live from the start — the heat model always runs — so
 * a player watches it climb with their build-out long before the controls that
 * manage it are granted. The bar is scaled against the watchdog's hard limit,
 * because that is the number the reading actually means something against.
 *
 * The °C/s beside it is the readout that changes play most (OP-21): inside a
 * demand window the temperature says where the core *is*, and only its rate
 * says whether the player is winning.
 */
function CoreTemp() {
  const temperature = useGameStore((s) => s.snapshot.resources.temperature);
  const thermal = useGameStore((s) => s.snapshot.thermal);
  const span = thermal.hardThresholdC - thermal.ambientC;
  const pct = span > 0 ? ((temperature.current - thermal.ambientC) / span) * 100 : 0;
  const state = thermal.halted
    ? 'bad'
    : temperature.current >= thermal.softThresholdC
      ? 'warn'
      : '';
  // Rising is only alarming once the core is already in the degraded band —
  // below it, climbing towards the resting temperature is what a working node does.
  const rateTone = state !== '' && temperature.ratePerSec > RATE_EPSILON ? 'alert' : '';

  return (
    <div className="meter">
      <div className="meter-label">
        <span>CORE TEMP</span>
        <span className="meter-values">
          <span className={rateTone === '' ? 'meter-rate' : `meter-rate meter-rate-${rateTone}`}>
            {formatRate(temperature.ratePerSec, '°C')}
          </span>
          <span className={state === 'bad' ? 'thermal-alert' : undefined}>
            {temperature.current.toFixed(1)}°C
          </span>
        </span>
      </div>
      <div className="meter-track">
        <div
          className={state === '' ? 'meter-fill' : `meter-fill meter-fill-${state}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
