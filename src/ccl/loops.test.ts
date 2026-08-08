/**
 * M5 CCL tests: `for i in range(n)` — parse-time iteration cap (TDD §5.2),
 * plain-language diagnostics, AST shape, RAM sizing, and fuel accounting
 * including the runaway-loop abort path.
 */

import { describe, expect, it } from 'vitest';

import { countNodes } from './ast.ts';
import { runProgram, type CclCommandOutcome, type CclHost, type CclValue } from './interpreter.ts';
import { parse, type ParseOptions } from './parser.ts';

/** Every tier through M5, with the tier-6 base iteration limit. */
const LOOPS: ParseOptions = {
  conditions: true,
  scheduling: true,
  loops: true,
  iterationLimit: 10,
};

function firstError(source: string, options: ParseOptions = LOOPS): string {
  const { program, diagnostics } = parse(source, options);
  expect(program).toBeNull();
  return diagnostics[0]!.message;
}

interface CountingHost extends CclHost {
  opsCharged: number;
  calls: number;
}

function countingHost(fuelLimit = Number.POSITIVE_INFINITY): CountingHost {
  const host: CountingHost = {
    opsCharged: 0,
    calls: 0,
    chargeOps(n) {
      if (host.opsCharged + n > fuelLimit) return false;
      host.opsCharged += n;
      return true;
    },
    readStat: () => undefined,
    statNames: () => [],
    callCommand(name, args): CclCommandOutcome | undefined {
      if (name !== 'tick') return undefined;
      host.calls += 1;
      return { kind: 'ok', value: (args[0] ?? null) as CclValue };
    },
    commandNames: () => ['tick'],
  };
  return host;
}

/** The limit after one ITERATION BUDGET EXTENSION — where runaway loops become possible. */
const RAISED: ParseOptions = { ...LOOPS, iterationLimit: 100 };

function run(source: string, host: CclHost, budget = 10_000, options: ParseOptions = LOOPS) {
  const { program, diagnostics } = parse(source, options);
  expect(diagnostics).toEqual([]);
  return runProgram(program!, host, budget);
}

describe('parse — for loops', () => {
  it('parses the GDD tier-6 loop into a for node carrying its literal repeat count', () => {
    const { program, diagnostics } = parse('for i in range(10) {\n  tick()\n}', LOOPS);
    expect(diagnostics).toEqual([]);
    const stmt = program!.statements[0]!;
    expect(stmt.kind).toBe('for');
    if (stmt.kind !== 'for') throw new Error('expected a for statement');
    expect(stmt.name).toBe('i');
    expect(stmt.count).toBe(10);
    expect(stmt.body).toHaveLength(1);
  });

  it('stays locked until the tier is granted, and says so in plain language', () => {
    expect(firstError('for i in range(3) {\n}', { conditions: true, scheduling: true })).toContain(
      "Loops ('for')",
    );
  });

  it('rejects a repeat count above the unlocked iteration limit, naming both numbers', () => {
    const message = firstError('for i in range(50) {\n  tick()\n}');
    expect(message).toContain('at most 10');
    expect(message).toContain('asks for 50');
  });

  it('accepts exactly the limit, and more once the limit is raised', () => {
    expect(parse('for i in range(10) {\n  tick()\n}', LOOPS).diagnostics).toEqual([]);
    expect(
      parse('for i in range(100) {\n  tick()\n}', { ...LOOPS, iterationLimit: 100 }).diagnostics,
    ).toEqual([]);
  });

  it('leaves the count uncapped when no limit is supplied (redeploy of saved source)', () => {
    const { diagnostics } = parse('for i in range(9999) {\n  tick()\n}', {
      conditions: true,
      scheduling: true,
      loops: true,
    });
    expect(diagnostics).toEqual([]);
  });

  it('explains each missing piece of the loop header', () => {
    expect(firstError('for in range(3) {\n}')).toContain('needs a name to count with');
    expect(firstError('for i range(3) {\n}')).toContain("Expected 'in'");
    expect(firstError('for i in 3 {\n}')).toContain('range(5)');
    expect(firstError('for i in range(n) {\n}')).toContain('plain number of repeats');
    expect(firstError('for i in range(0) {\n}')).toContain('at least 1');
    expect(firstError('for i in range(2.5) {\n}')).toContain('whole number');
  });

  it('may be declared inside a scheduled process', () => {
    const { program, diagnostics } = parse(
      'every 2 seconds {\n  for i in range(3) {\n    tick()\n  }\n}',
      LOOPS,
    );
    expect(diagnostics).toEqual([]);
    expect(program!.processes).toHaveLength(1);
  });

  it('prices RAM by the code, not by the work: the body is stored once', () => {
    const once = parse('for i in range(2) {\n  tick()\n}', LOOPS).program!;
    const many = parse('for i in range(10) {\n  tick()\n}', LOOPS).program!;
    expect(countNodes(once)).toBe(countNodes(many));
  });
});

describe('interpret — for loops', () => {
  it('runs the body once per repeat, binding the counter from zero', () => {
    const host = countingHost();
    const seen: CclValue[] = [];
    const wrapped: CclHost = {
      ...host,
      callCommand(name, args) {
        seen.push(args[0] ?? null);
        return host.callCommand(name, args);
      },
    };
    const result = run('for i in range(4) {\n  tick(i)\n}', wrapped);
    expect(result.status).toBe('ok');
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('charges fuel per iteration on top of the body, so repeats have a real cost', () => {
    const one = countingHost();
    const four = countingHost();
    run('for i in range(1) {\n  tick()\n}', one);
    run('for i in range(4) {\n  tick()\n}', four);
    // Each extra repeat costs the loop step plus the body's statement + call nodes.
    expect(four.opsCharged - one.opsCharged).toBe(3 * 3);
  });

  it('aborts a runaway loop on the op budget without running to completion', () => {
    const host = countingHost();
    const result = run('for i in range(100) {\n  tick()\n}', host, 40, RAISED);
    expect(result.status).toBe('budget');
    expect(result.opsUsed).toBeLessThanOrEqual(40);
    // Preemption is the point: far fewer than 100 commands actually ran.
    expect(host.calls).toBeLessThan(100);
    expect(host.calls).toBeGreaterThan(0);
  });

  it('aborts on an empty compute pool rather than looping against it', () => {
    const host = countingHost(25);
    const result = run('for i in range(100) {\n  tick()\n}', host, 10_000, RAISED);
    expect(result.status).toBe('fuel');
    expect(host.opsCharged).toBeLessThanOrEqual(25);
  });

  it('propagates a fault out of the loop body at the exact source position', () => {
    const host = countingHost();
    const result = run('for i in range(5) {\n  tick(missing)\n}', host);
    expect(result.status).toBe('error');
    expect(result.error!.line).toBe(2);
    expect(result.error!.message).toContain('missing');
  });
});
