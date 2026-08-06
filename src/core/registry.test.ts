/** API registry coverage: content docs and core implementations must stay 1:1. */

import { describe, expect, it } from 'vitest';

import { BALANCE } from '../content/balance.ts';
import { CCL_COMMAND_DOCS, CCL_STAT_DOCS } from '../content/cclApi.ts';
import {
  apiCommandViews,
  commandNames,
  implementedCommandNames,
  implementedStatNames,
  statNames,
} from './registry.ts';

describe('CCL API registry', () => {
  it('every documented stat has an implementation, and vice versa', () => {
    expect([...implementedStatNames()].sort()).toEqual(CCL_STAT_DOCS.map((d) => d.name).sort());
    expect([...statNames()].sort()).toEqual([...implementedStatNames()].sort());
  });

  it('every documented command has an implementation, and vice versa', () => {
    expect([...implementedCommandNames()].sort()).toEqual(
      CCL_COMMAND_DOCS.map((d) => d.name).sort(),
    );
    expect([...commandNames()].sort()).toEqual([...implementedCommandNames()].sort());
  });

  it('every command has a listed compute cost in balance', () => {
    const costs: Readonly<Record<string, number | undefined>> = BALANCE.ccl.commandCosts;
    for (const name of commandNames()) {
      expect(costs[name], `commandCosts.${name}`).toBeTypeOf('number');
    }
  });

  it('command views expose the balance-defined costs for the reference panel', () => {
    const view = apiCommandViews().find((c) => c.name === 'process_job');
    expect(view?.computeCost).toBe(BALANCE.ccl.commandCosts.process_job);
    expect(view?.signature).toBe('process_job()');
  });
});
