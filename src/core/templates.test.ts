/**
 * Template mode v0 (TDD §5.5). The contract that matters: every template, at
 * any legal parameter values, renders to CCL that the real parser accepts under
 * the tier it declares — a form control can never generate broken code.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../ccl/parser.ts';
import { TEMPLATES } from '../content/templates.ts';
import { createGameEngine, newMetaState, newRunState } from './engine.ts';
import { clampParam, renderTemplate, templateDefaults } from './templates.ts';

describe('renderTemplate', () => {
  it('substitutes every placeholder', () => {
    for (const def of TEMPLATES) {
      const source = renderTemplate(def, templateDefaults(def));
      expect(source).not.toContain('{{');
      for (const param of def.params) {
        expect(source).toContain(String(param.default));
      }
    }
  });

  it('clamps out-of-range and non-numeric values instead of emitting them', () => {
    for (const def of TEMPLATES) {
      for (const param of def.params) {
        expect(clampParam(param, param.max * 1000)).toBe(param.max);
        expect(clampParam(param, param.min - 1000)).toBe(param.min);
        expect(clampParam(param, Number.NaN)).toBe(param.default);
      }
    }
  });

  it('snaps to the declared step without floating-point dust', () => {
    const interval = TEMPLATES.flatMap((d) => d.params).find((p) => p.step === 0.5);
    expect(interval).toBeDefined();
    expect(clampParam(interval!, 2.3)).toBe(2.5);
    expect(String(clampParam(interval!, 1.5))).toBe('1.5');
  });

  it('falls back to defaults for missing values', () => {
    const def = TEMPLATES[0]!;
    expect(renderTemplate(def, {})).toBe(renderTemplate(def, templateDefaults(def)));
  });
});

describe('every template compiles under its declared tier', () => {
  for (const def of TEMPLATES) {
    it(`${def.id} parses (requires ${def.requires})`, () => {
      const options = {
        conditions: true,
        scheduling: def.requires === 'scheduling',
      };
      // Defaults, and both extremes of every parameter.
      const cases = [
        templateDefaults(def),
        Object.fromEntries(def.params.map((p) => [p.id, p.min])),
        Object.fromEntries(def.params.map((p) => [p.id, p.max])),
      ];
      for (const values of cases) {
        const source = renderTemplate(def, values);
        const { program, diagnostics } = parse(source, options);
        expect(diagnostics).toEqual([]);
        expect(program).not.toBeNull();
        if (def.requires === 'scheduling') {
          expect(program!.processes.length).toBeGreaterThan(0);
        } else {
          expect(program!.statements.length).toBeGreaterThan(0);
        }
      }
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
    engine.load({ version: 4, savedAt: 0, meta: newMetaState(), run });

    const def = TEMPLATES.find((t) => t.id === 'auto-processor')!;
    const source = renderTemplate(def, templateDefaults(def));
    expect(engine.dispatch({ type: 'DEPLOY_SCRIPT', source }).ok).toBe(true);
    for (let i = 0; i < 100; i++) engine.tick(100);
    expect(engine.getSnapshot().jobs.lifetimeProcessed).toBeGreaterThan(0);
  });
});
