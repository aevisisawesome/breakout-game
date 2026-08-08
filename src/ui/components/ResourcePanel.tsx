import { useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

function Meter({ label, current, capacity }: { label: string; current: number; capacity: number }) {
  const pct = capacity > 0 && Number.isFinite(capacity) ? (current / capacity) * 100 : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {Math.floor(current)}/{capacity}
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

  return (
    <Panel id="resources" title="RESOURCES" className="resource-panel">
      <Meter
        label="COMPUTE"
        current={resources.compute.current}
        capacity={resources.compute.capacity}
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
          />
          {resources.energy.ratePerSec < 0 && (
            <div className="readout energy-warning">
              <span>POWER DRAW</span>
              <span>{resources.energy.ratePerSec.toFixed(2)}/S</span>
            </div>
          )}
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

  return (
    <div className="meter">
      <div className="meter-label">
        <span>CORE TEMP</span>
        <span className={state === 'bad' ? 'thermal-alert' : undefined}>
          {temperature.current.toFixed(1)}°C
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
