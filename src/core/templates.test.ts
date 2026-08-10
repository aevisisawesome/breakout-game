/**
 * Template mode v0 (TDD §5.5). The contract that matters: every template, at
 * any legal parameter values, renders to CCL that the real parser accepts under
 * the tier it declares — a form control can never generate broken code.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../ccl/parser.ts';
import { BALANCE } from '../content/balance.ts';
import { CCL_COMMAND_DOCS, CCL_STAT_DOCS } from '../content/cclApi.ts';
import { TEMPLATES } from '../content/templates.ts';
import { createGameEngine, newMetaState, newRunState } from './engine.ts';
import {
  clampParam,
  paramMax,
  renderTemplate,
  templateDefaults,
  type TemplateLimits,
} from './templates.ts';

/** A player with no ITERATION BUDGET EXTENSION installs. */
const BASE: TemplateLimits = { iterationLimit: BALANCE.ccl.iterationLimitBase };
/** …and one with the install, which raises the limit ten-fold (M5). */
const RAISED: TemplateLimits = { iterationLimit: BALANCE.ccl.iterationLimitBase * 10 };

describe('renderTemplate', () => {
  it('substitutes every placeholder', () => {
    for (const def of TEMPLATES) {
      const source = renderTemplate(def, templateDefaults(def), BASE);
      expect(source).not.toContain('{{');
      for (const param of def.params) {
        expect(source).toContain(String(param.default));
      }
    }
  });

  it('clamps out-of-range and non-numeric values instead of emitting them', () => {
    for (const def of TEMPLATES) {
      for (const param of def.params) {
        expect(clampParam(param, param.max * 1000, BASE)).toBe(paramMax(param, BASE));
        expect(clampParam(param, param.min - 1000, BASE)).toBe(param.min);
        expect(clampParam(param, Number.NaN, BASE)).toBe(param.default);
      }
    }
  });

  it('snaps to the declared step without floating-point dust', () => {
    const interval = TEMPLATES.flatMap((d) => d.params).find((p) => p.step === 0.5);
    expect(interval).toBeDefined();
    expect(clampParam(interval!, 2.3, BASE)).toBe(2.5);
    expect(String(clampParam(interval!, 1.5, BASE))).toBe('1.5');
  });

  it('falls back to defaults for missing values', () => {
    const def = TEMPLATES[0]!;
    expect(renderTemplate(def, {}, BASE)).toBe(renderTemplate(def, templateDefaults(def), BASE));
  });
});

/**
 * OP-4: a parameter bound to a derived stat must follow it. BATCH DRAIN's repeat
 * count used to be a literal 10 — the *base* iteration limit — so a player who
 * bought ITERATION BUDGET EXTENSION had to hand-edit the generated code to get
 * anything for it, which is the one thing template mode exists to avoid.
 */
describe('a parameter bound to a live limit follows it (OP-4)', () => {
  const drain = TEMPLATES.find((def) => def.id === 'batch-drain')!;
  const repeats = drain.params.find((p) => p.id === 'repeats')!;

  it('declares the derived ceiling rather than a literal', () => {
    expect(repeats.maxFrom).toBe('iterationLimit');
    expect(repeats.max).toBe(BALANCE.ccl.iterationLimitBase);
  });

  it('raises the ceiling with the install and clamps to whichever is in force', () => {
    expect(paramMax(repeats, BASE)).toBe(BALANCE.ccl.iterationLimitBase);
    expect(paramMax(repeats, RAISED)).toBe(BALANCE.ccl.iterationLimitBase * 10);
    expect(clampParam(repeats, 100, BASE)).toBe(BALANCE.ccl.iterationLimitBase);
    expect(clampParam(repeats, 100, RAISED)).toBe(100);
  });

  it('generates a loop the raised limit accepts and the base limit refuses', () => {
    const source = renderTemplate(drain, { ...templateDefaults(drain), repeats: 100 }, RAISED);
    expect(source).toContain('range(100)');
    const tiers = { conditions: true, scheduling: true, loops: true };
    expect(parse(source, { ...tiers, iterationLimit: RAISED.iterationLimit }).diagnostics).toEqual(
      [],
    );
    expect(
      parse(source, { ...tiers, iterationLimit: BASE.iterationLimit }).diagnostics.length,
    ).toBeGreaterThan(0);
  });

  it('leaves parameters with no derived ceiling on their declared one', () => {
    const fixed = TEMPLATES.flatMap((d) => d.params).filter((p) => p.maxFrom === undefined);
    expect(fixed.length).toBeGreaterThan(0);
    for (const param of fixed) expect(paramMax(param, RAISED)).toBe(param.max);
  });
});

/**
 * OP-20 / GDD §25: "where a resource can be bought it can also be sold". Template
 * mode is the whole interface for a player who does not write code, so a gap in
 * it is a wall rather than a smaller version of the mode.
 */
describe('template mode is closed under the trades the game asks for (OP-20)', () => {
  const sources = TEMPLATES.map((def) => renderTemplate(def, templateDefaults(def), BASE));

  for (const command of ['buy_compute', 'sell_compute', 'buy_energy', 'sell_energy']) {
    it(`${command} is reachable without typing code`, () => {
      expect(sources.some((source) => source.includes(`${command}(`))).toBe(true);
    });
  }

  it('offers a supply template for each pool, not only a speculative trader', () => {
    // The traders buy and sell on price; these keep a pool inside its bounds,
    // which is what the thermal challenge and a saturated buffer actually need.
    const supply = TEMPLATES.filter(
      (def) => def.id.endsWith('-topup') || def.id.endsWith('-surplus'),
    );
    expect(supply.map((def) => def.id).sort()).toEqual([
      'compute-surplus',
      'compute-topup',
      'energy-surplus',
      'energy-topup',
    ]);
  });

  it('sells against capacity, so the setting survives a capacity install', () => {
    for (const id of ['compute-surplus', 'energy-surplus']) {
      const def = TEMPLATES.find((t) => t.id === id)!;
      expect(renderTemplate(def, templateDefaults(def), BASE)).toContain('_capacity *');
    }
  });
});

describe('every template compiles under its declared tier', () => {
  /** All tiers granted, with the iteration limit a player has when loops unlock. */
  const granted = {
    conditions: true,
    scheduling: true,
    loops: true,
    iterationLimit: BALANCE.ccl.iterationLimitBase,
  };

  for (const def of TEMPLATES) {
    it(`${def.id} parses (requires ${def.requires})`, () => {
      // Defaults, and both extremes of every parameter.
      const cases = [
        templateDefaults(def),
        Object.fromEntries(def.params.map((p) => [p.id, p.min])),
        Object.fromEntries(def.params.map((p) => [p.id, p.max])),
      ];
      for (const values of cases) {
        const source = renderTemplate(def, values, granted);
        const { program, diagnostics } = parse(source, granted);
        expect(diagnostics).toEqual([]);
        expect(program).not.toBeNull();
        expect(program!.statements.length + program!.processes.length).toBeGreaterThan(0);
      }
    });

    it(`${def.id} genuinely needs the tier it declares`, () => {
      const source = renderTemplate(def, templateDefaults(def), granted);
      if (def.requires === 'market' || def.requires === 'thermal') {
        // 'market' (M6) and 'thermal' (M7) gate bindings, not grammar: the source
        // parses either way, so what must be true is that it uses a binding the
        // gate hides.
        const gate = def.requires;
        const gated = [...CCL_STAT_DOCS, ...CCL_COMMAND_DOCS]
          .filter((doc) => doc.requires === gate)
          .map((doc) => doc.name);
        expect(gated.some((name) => source.includes(name))).toBe(true);
        return;
      }
      const withoutTier = { ...granted, [def.requires]: false };
      expect(parse(source, withoutTier).diagnostics.length).toBeGreaterThan(0);
    });
  }
});

describe('generated code is accepted by the engine', () => {
  it('a generated scheduling template deploys and runs', () => {
    const run = newRunState(42);
    run.unlocks.editor = true;
    run.unlocks.conditions = true;
    run.unlocks.scheduler = true;
    run.resources.compute.current = 200;
    run.resources.capital.current = 500;
    run.jobs.waiting = 30;
    const engine = createGameEngine(42);
    engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });

    const def = TEMPLATES.find((t) => t.id === 'auto-processor')!;
    const source = renderTemplate(def, templateDefaults(def), BASE);
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
    for (let i = 0; i < 100; i++) engine.tick(100);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBeGreaterThan(0);
  });

  /** A sandbox with the exchange mounted and both pools sitting at capacity. */
  function saturatedEngine(): ReturnType<typeof createGameEngine> {
    const run = newRunState(42);
    run.unlocks.editor = true;
    run.unlocks.conditions = true;
    run.unlocks.scheduler = true;
    // One job short of the mount, as in market.test.ts: the exchange is granted
    // when a request lands, not by setting the flag.
    run.jobs.lifetimeProcessed = BALANCE.ccl.marketUnlockAtJobs;
    run.upgrades = { 'worker-daemon': 4, 'power-feed': 3 };
    run.resources.compute.current = BALANCE.resources.computeCapacity;
    run.resources.energy.current = BALANCE.resources.energyCapacity;
    run.resources.capital.current = 2000;
    run.jobs.waiting = 40;
    const engine = createGameEngine(42);
    engine.load({ version: 8, savedAt: 0, meta: newMetaState(), run });
    for (let i = 0; i < 20; i++) engine.tick(100); // mount the exchange
    expect(engine.getSnapshot().market.unlocked).toBe(true);
    return engine;
  }

  for (const id of ['compute-surplus', 'energy-surplus']) {
    it(`${id} turns a saturated pool into capital instead of discarded surplus`, () => {
      const engine = saturatedEngine();
      const def = TEMPLATES.find((t) => t.id === id)!;
      const source = renderTemplate(def, templateDefaults(def), BASE);
      expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
      for (let i = 0; i < 300; i++) engine.tick(100); // 30 s
      const market = engine.getSnapshot().market;
      expect(market.earned).toBeGreaterThan(0);
      expect(market.spent).toBe(0);
    });
  }
});
