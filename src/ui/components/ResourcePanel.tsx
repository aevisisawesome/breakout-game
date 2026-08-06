import { useGameStore } from '../session.ts';

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
    <div className="resource-panel">
      <h2 className="panel-title">RESOURCES</h2>
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
          <div className="readout terminal-dim">
            <span>RAM</span>
            <span>
              {Math.floor(resources.ram.current)}/{resources.ram.capacity} MB
            </span>
          </div>
          <div className="readout terminal-dim">
            <span>ENERGY</span>
            <span>
              {Math.floor(resources.energy.current)}/{resources.energy.capacity}
            </span>
          </div>
          <div className="readout terminal-dim">
            <span>CORE TEMP</span>
            <span>{resources.temperature.current.toFixed(1)}°C</span>
          </div>
        </>
      )}
    </div>
  );
}
