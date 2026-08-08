/** API registry coverage: content docs and core implementations must stay 1:1. */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { CCL_COMMAND_DOCS, CCL_STAT_DOCS } from '../content/cclApi.ts';
import {
  apiCommandViews,
  apiStatViews,
  commandNames,
  implementedCommandNames,
  implementedStatNames,
  lockedBinding,
  statNames,
} from './registry.ts';
import type { UnlockState } from './types.ts';

/** Every gate open — the surface a fully progressed run sees. */
const ALL: UnlockState = {
  capitalReadout: true,
  systemReadouts: true,
  editor: true,
  conditions: true,
  scheduler: true,
  instrumentation: true,
  loops: true,
  market: true,
  thermal: true,
};

const NO_MARKET: UnlockState = { ...ALL, market: false };
const NO_THERMAL: UnlockState = { ...ALL, thermal: false };

describe('CCL API registry', () => {
  it('every documented stat has an implementation, and vice versa', () => {
    expect([...implementedStatNames()].sort()).toEqual(CCL_STAT_DOCS.map((d) => d.name).sort());
    expect([...statNames(ALL)].sort()).toEqual([...implementedStatNames()].sort());
  });

  it('every documented command has an implementation, and vice versa', () => {
    expect([...implementedCommandNames()].sort()).toEqual(
      CCL_COMMAND_DOCS.map((d) => d.name).sort(),
    );
    expect([...commandNames(ALL)].sort()).toEqual([...implementedCommandNames()].sort());
  });

  it('every command has a listed compute cost in balance', () => {
    const costs: Readonly<Record<string, number | undefined>> = BALANCE.ccl.commandCosts;
    for (const name of commandNames(ALL)) {
      expect(costs[name], `commandCosts.${name}`).toBeTypeOf('number');
    }
  });

  it('command views expose the balance-defined costs for the reference panel', () => {
    const view = apiCommandViews(ALL).find((c) => c.name === 'process_job');
    expect(view?.computeCost).toBe(BALANCE.ccl.commandCosts.process_job);
    expect(view?.signature).toBe('process_job()');
  });

  describe('unlock gating (M6)', () => {
    it('hides gated bindings from the surface until their unlock is granted', () => {
      expect(commandNames(NO_MARKET)).not.toContain('market.price');
      expect(commandNames(NO_MARKET)).toContain('process_job');
      expect(statNames(NO_MARKET)).not.toContain('stats.compute_capacity');
      expect(statNames(NO_MARKET)).toContain('stats.cash');
      expect(apiCommandViews(NO_MARKET).map((c) => c.name)).not.toContain('sell_compute');
      expect(apiStatViews(NO_MARKET).map((s) => s.name)).not.toContain('stats.energy_capacity');
    });

    it('explains a locked binding rather than letting it read as a typo', () => {
      expect(lockedBinding(NO_MARKET, 'market.price')).toContain('market.price');
      expect(lockedBinding(NO_MARKET, 'stats.energy_capacity')).not.toBeNull();
      // Ungated and unknown names alike have nothing to explain.
      expect(lockedBinding(NO_MARKET, 'process_job')).toBeNull();
      expect(lockedBinding(NO_MARKET, 'nonsense')).toBeNull();
      expect(lockedBinding(ALL, 'market.price')).toBeNull();
    });

    it('gates every binding a market-only doc declares', () => {
      const gated = [...CCL_STAT_DOCS, ...CCL_COMMAND_DOCS].filter((d) => d.requires === 'market');
      expect(gated.length).toBeGreaterThan(0);
      for (const doc of gated) {
        expect(lockedBinding(NO_MARKET, doc.name), doc.name).not.toBeNull();
      }
    });

    it('gates every binding a thermal-only doc declares (M7)', () => {
      const gated = [...CCL_STAT_DOCS, ...CCL_COMMAND_DOCS].filter((d) => d.requires === 'thermal');
      expect(gated.map((d) => d.name)).toEqual([
        'stats.temperature_limit',
        'reduce_clock_speed',
        'boost_cooling',
      ]);
      for (const doc of gated) {
        expect(lockedBinding(NO_THERMAL, doc.name), doc.name).not.toBeNull();
      }
      // `stats.temperature` itself is ungated: the readout exists from the start,
      // because the heat model does. Only the controls are a tier.
      expect(statNames(NO_THERMAL)).toContain('stats.temperature');
      expect(commandNames(NO_THERMAL)).not.toContain('boost_cooling');
    });
  });

  /**
   * OP-11: a signature names a parameter but never says what may go in it, so
   * the domains lived only inside `validate()` and were learnable by triggering
   * a fault. These pin docs and signatures together in both directions.
   */
  describe('parameter documentation (OP-11)', () => {
    it('documents exactly the parameters its signature declares, in order', () => {
      for (const doc of CCL_COMMAND_DOCS) {
        const inner = doc.signature.slice(
          doc.signature.indexOf('(') + 1,
          doc.signature.lastIndexOf(')'),
        );
        const declared = inner === '' ? [] : inner.split(',').map((s) => s.trim());
        expect(
          doc.params.map((p) => p.name),
          doc.signature,
        ).toEqual(declared);
      }
    });

    it('states a non-empty domain for every parameter', () => {
      for (const doc of CCL_COMMAND_DOCS) {
        for (const param of doc.params) {
          expect(param.domain.length, `${doc.name}(${param.name})`).toBeGreaterThan(0);
        }
      }
    });

    it('quotes the bounds the validators actually enforce, so the two cannot drift', () => {
      const units = CCL_COMMAND_DOCS.find((d) => d.name === 'buy_compute')?.params[0];
      expect(units?.domain).toContain(String(BALANCE.market.maxOrderUnits));
      const samples = CCL_COMMAND_DOCS.find((d) => d.name === 'market.average')?.params[1];
      expect(samples?.domain).toContain(String(BALANCE.market.maxAverageSamples));
      const good = CCL_COMMAND_DOCS.find((d) => d.name === 'market.price')?.params[0];
      expect(good?.domain).toContain('"compute"');
      expect(good?.domain).toContain('"energy"');
    });

    it('carries the parameter docs through to the reference-panel view', () => {
      const view = apiCommandViews(ALL).find((c) => c.name === 'market.average');
      expect(view?.params.map((p) => p.name)).toEqual(['good', 'n']);
      expect(view?.params[1]?.domain).toContain('samples');
    });
  });
});
