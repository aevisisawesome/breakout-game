import { useState } from 'react';

import { engine, useGameStore } from '../session.ts';
import { Panel } from './Panel.tsx';
import type { MarketGoodView } from '../../core/types.ts';

/** Chart viewBox. Rendered responsively via CSS; these are drawing units only. */
const CHART_W = 300;
const CHART_H = 64;

/**
 * Price history sparkline. Hand-rolled SVG rather than a charting library: the
 * prototype's bundle is already over Vite's warning threshold (OP-5) and a
 * polyline is all TDD §6's "price history chart" needs.
 */
function PriceChart({ history, average }: { history: readonly number[]; average: number }) {
  if (history.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const value of history) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min || 1;
  const y = (value: number): number => CHART_H - ((value - min) / span) * (CHART_H - 4) - 2;
  const points = history
    .map(
      (value, i) => `${((i / (history.length - 1)) * CHART_W).toFixed(1)},${y(value).toFixed(1)}`,
    )
    .join(' ');
  const avgY = y(average).toFixed(1);

  return (
    <svg
      className="market-chart"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Price history, ${min.toFixed(3)} to ${max.toFixed(3)} CR`}
    >
      <line
        className="market-chart-average"
        x1="0"
        x2={CHART_W}
        y1={avgY}
        y2={avgY}
        strokeDasharray="3 3"
      />
      <polyline className="market-chart-line" points={points} />
    </svg>
  );
}

function GoodRow({ good }: { good: MarketGoodView }) {
  const [units, setUnits] = useState(25);
  const direction = good.price > good.previous ? '▲' : good.price < good.previous ? '▼' : '=';
  const drift = good.average > 0 ? (good.price / good.average - 1) * 100 : 0;
  const order = (side: 'buy' | 'sell'): void => {
    engine.dispatch({ type: 'TRADE', good: good.id, side, units });
  };

  return (
    <li className="market-good">
      <div className="market-head">
        <span>{good.label}</span>
        <span className={drift >= 0 ? 'market-price market-up' : 'market-price market-down'}>
          {direction} {good.price.toFixed(3)} CR
        </span>
      </div>
      <PriceChart history={good.history} average={good.average} />
      <div className="readout terminal-dim">
        <span>MEAN {good.average.toFixed(3)}</span>
        <span>
          {drift >= 0 ? '+' : ''}
          {drift.toFixed(1)}% VS MEAN
        </span>
      </div>
      <div className="readout terminal-dim">
        <span>HELD</span>
        <span>
          {Math.floor(good.held)}
          {Number.isFinite(good.heldCapacity) ? `/${Math.floor(good.heldCapacity)}` : ''}
        </span>
      </div>
      <div className="market-order">
        <label className="market-units">
          <span className="terminal-dim">UNITS</span>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={units}
            onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          />
        </label>
        <button type="button" className="market-button" onClick={() => order('buy')}>
          BUY
        </button>
        <button type="button" className="market-button" onClick={() => order('sell')}>
          SELL
        </button>
      </div>
    </li>
  );
}

/**
 * Market terminal (M6, TDD §6): live prices, history chart and manual orders.
 * The active regime is never shown — the player reads the market's behaviour off
 * the chart, which is the whole point of the mid-run shift.
 */
export function MarketPanel() {
  const market = useGameStore((s) => s.snapshot.market);
  if (!market.unlocked) return null;

  const net = market.earned - market.spent;
  return (
    <Panel id="market" title="RESOURCE EXCHANGE" className="market-panel">
      <div className="readout terminal-dim">
        <span>
          {market.trades} ORDERS // FEE {(market.fee * 100).toFixed(0)}%
        </span>
        <span className={net >= 0 ? 'market-up' : 'market-down'}>
          NET {net >= 0 ? '+' : ''}
          {net.toFixed(2)} CR
        </span>
      </div>
      <ul className="market-list">
        {market.goods.map((good) => (
          <GoodRow key={good.id} good={good} />
        ))}
      </ul>
    </Panel>
  );
}
