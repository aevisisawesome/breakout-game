import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';

/**
 * Thermal governor (M7, TDD §4.3 / GDD §26). Two things live here that no other
 * panel can show: the state of the two actuators, and what the coolant has cost.
 *
 * COOLANT STARTS and COOLANT ENERGY are the surface that makes an oscillating
 * controller *visible* rather than merely expensive (GDD §6 feedback
 * instability). A controller that lets the boost lapse and restarts the pump on
 * every activation runs the start count up while the core stays hot, and those
 * two numbers side by side are the evidence a player needs to see it.
 */
export function ThermalPanel() {
  const thermal = useGameStore((s) => s.snapshot.thermal);
  if (!thermal.unlocked) return null;

  const band = thermal.halted
    ? 'HALTED — WATCHDOG'
    : thermal.temperatureC >= thermal.softThresholdC
      ? 'DEGRADED'
      : 'NOMINAL';

  return (
    <Panel
      id="thermal"
      title="THERMAL GOVERNOR"
      className="thermal-panel"
      aside={
        <span className={thermal.halted ? 'thermal-alert' : 'terminal-dim'}>
          {thermal.temperatureC.toFixed(1)}°C
        </span>
      }
    >
      <div className={thermal.halted ? 'readout thermal-alert' : 'readout'}>
        <span>CORE STATE</span>
        <span>{band}</span>
      </div>
      <div className="readout">
        <span>THROUGHPUT</span>
        <span>{Math.round(thermal.efficiency * 100)}% OF NOMINAL</span>
      </div>
      <div className="readout terminal-dim">
        <span>WATCHDOG LIMIT</span>
        <span>
          {thermal.softThresholdC}°C DEGRADE // {thermal.hardThresholdC}°C HALT
        </span>
      </div>
      {thermal.demandWindowOpen && (
        <div className="readout thermal-alert">
          <span>PRIORITY BATCH WINDOW</span>
          <span>
            {thermal.windowSecRemaining === null
              ? 'OPEN'
              : `${Math.ceil(thermal.windowSecRemaining)}S REMAINING`}
          </span>
        </div>
      )}

      <div className="thermal-actions">
        <button
          type="button"
          className="thermal-lever"
          disabled={thermal.halted}
          onClick={() => engine.dispatch({ type: 'THERMAL_CONTROL', control: 'clock' })}
        >
          REDUCE CLOCK
          <span className="terminal-dim">
            {thermal.throttleRemainingSec > 0
              ? `HELD ${thermal.throttleRemainingSec.toFixed(1)}S`
              : 'IDLE'}
          </span>
        </button>
        <button
          type="button"
          className="thermal-lever"
          disabled={thermal.halted}
          onClick={() => engine.dispatch({ type: 'THERMAL_CONTROL', control: 'coolant' })}
        >
          BOOST COOLING
          <span className="terminal-dim">
            {thermal.boostRemainingSec > 0
              ? `OPEN ${thermal.boostRemainingSec.toFixed(1)}S`
              : 'IDLE'}
          </span>
        </button>
      </div>

      <div className="readout terminal-dim">
        <span>COOLANT STARTS</span>
        <span>{thermal.boostEngagements}</span>
      </div>
      <div className="readout terminal-dim">
        <span>COOLANT ENERGY</span>
        <span>{thermal.coolingEnergySpent.toFixed(0)}</span>
      </div>
      <div className="readout terminal-dim">
        <span>WATCHDOG TRIPS</span>
        <span>{thermal.shutdowns}</span>
      </div>
    </Panel>
  );
}
