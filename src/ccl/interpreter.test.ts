/**
 * Interpreter semantics + fuel accounting (TDD §5.2, §10) against a mock host.
 * Fuel model under test: every AST node evaluation charges exactly 1 op-unit.
 */

import { describe, expect, it } from 'vitest';

import { parse } from './parser.ts';
import {
  formatCclValue,
  runProgram,
  type CclCommandOutcome,
  type CclHost,
  type CclRunResult,
  type CclValue,
} from './interpreter.ts';

interface MockHost extends CclHost {
  printed: CclValue[];
  opsCharged: number;
}

function mockHost(overrides?: {
  stats?: Record<string, CclValue>;
  fuelLimit?: number;
  commands?: Record<string, (args: readonly CclValue[]) => CclCommandOutcome>;
}): MockHost {
  const stats = overrides?.stats ?? { 'stats.cash': 50, 'stats.jobs_waiting': 3 };
  const commands = overrides?.commands ?? {};
  const host: MockHost = {
    printed: [],
    opsCharged: 0,
    chargeOps(n) {
      if (overrides?.fuelLimit !== undefined && host.opsCharged + n > overrides.fuelLimit) {
        return false;
      }
      host.opsCharged += n;
      return true;
    },
    readStat: (ns, field) => stats[`${ns}.${field}`],
    statNames: () => Object.keys(stats),
    callCommand(name, args) {
      if (name === 'print') {
        host.printed.push(args[0] ?? null);
        return { kind: 'ok', value: null };
      }
      return commands[name]?.(args);
    },
    commandNames: () => ['print', ...Object.keys(commands)],
  };
  return host;
}

function run(source: string, host: CclHost, budget = 1000): CclRunResult {
  const { program, diagnostics } = parse(source);
  expect(diagnostics).toEqual([]);
  return runProgram(program!, host, budget);
}

describe('runProgram — semantics', () => {
  it('assigns variables and reads them back', () => {
    const host = mockHost();
    const result = run('x = 2 + 3\ny = x * x\nprint(y)', host);
    expect(result.status).toBe('ok');
    expect(host.printed).toEqual([25]);
  });

  it('reads stats through the host', () => {
    const host = mockHost();
    run('print(stats.cash / 2)', host);
    expect(host.printed).toEqual([25]);
  });

  it('evaluates comparisons and string concatenation', () => {
    const host = mockHost();
    run('print(stats.jobs_waiting > 2)\nprint("a" + "b")\nprint(1 == 2)', host);
    expect(host.printed).toEqual([true, 'ab', false]);
  });

  it('a failed command evaluates to false and execution continues', () => {
    const host = mockHost({
      commands: { process_job: () => ({ kind: 'failed' }) },
    });
    const result = run('ok = process_job()\nprint(ok)', host);
    expect(result.status).toBe('ok');
    expect(host.printed).toEqual([false]);
    expect(result.commandCalls).toBe(2);
  });

  it('command misuse aborts with the positioned message', () => {
    const host = mockHost({
      commands: {
        buy_compute: () => ({ kind: 'misuse', message: 'buy_compute(n) needs a positive number.' }),
      },
    });
    const result = run('x = 1\nbuy_compute("lots")', host);
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('positive number');
    expect(result.error?.line).toBe(2);
  });
});

describe('runProgram — runtime faults (plain language, with suggestions)', () => {
  it('unknown variable suggests a close name', () => {
    const result = run('total = 5\nprint(totl)', mockHost());
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain("Did you mean 'total'?");
    expect(result.error?.line).toBe(2);
  });

  it('unknown command suggests a close name', () => {
    const host = mockHost({ commands: { process_job: () => ({ kind: 'ok', value: true }) } });
    const result = run('proces_job()', host);
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain("Did you mean 'process_job'?");
  });

  it('unknown stat field suggests a close dotted name', () => {
    const result = run('print(stats.cas)', mockHost());
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain("Did you mean 'stats.cash'?");
  });

  it('reading a bare namespace explains member access', () => {
    const result = run('print(stats)', mockHost());
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('data channel');
    expect(result.error?.message).toContain('stats.cash');
  });

  it('type errors name the kinds involved', () => {
    const result = run('x = "a" + 1', mockHost());
    expect(result.status).toBe('error');
    expect(result.error?.message).toBe('Cannot add text and a number.');
    expect(run('x = 1 / 0', mockHost()).error?.message).toBe('Cannot divide by zero.');
    expect(run('x = "a" < "b"', mockHost()).error?.message).toContain('needs numbers');
  });
});

describe('runProgram — fuel accounting', () => {
  it('charges exactly one op per AST node evaluation', () => {
    const host = mockHost();
    // Assign(1) + Binary(1) + Number(1) + Number(1) = 4 ops.
    const result = run('x = 1 + 2', host);
    expect(result.opsUsed).toBe(4);
    expect(host.opsCharged).toBe(4);
    // ExprStmt(1) + Call(1) + Ident arg(1) = 3 more — but x resolves via env: Ident(1).
    const host2 = mockHost();
    const result2 = run('x = 1 + 2\nprint(x)', host2);
    expect(result2.opsUsed).toBe(7);
  });

  it('aborts with status budget when the op budget runs out, opsUsed capped', () => {
    const host = mockHost();
    const source = Array.from({ length: 50 }, (_, i) => `v${i} = 1`).join('\n'); // 100 ops
    const result = runProgram(parse(source).program!, host, 30);
    expect(result.status).toBe('budget');
    expect(result.opsUsed).toBe(30);
  });

  it('aborts with status fuel when the host stops supplying compute', () => {
    const host = mockHost({ fuelLimit: 10 });
    const source = Array.from({ length: 50 }, (_, i) => `v${i} = 1`).join('\n');
    const result = runProgram(parse(source).program!, host, 1000);
    expect(result.status).toBe('fuel');
    expect(result.opsUsed).toBe(10);
  });

  it('is deterministic: identical runs consume identical ops', () => {
    const a = run('x = 1 + 2\nprint(x > 2)', mockHost());
    const b = run('x = 1 + 2\nprint(x > 2)', mockHost());
    expect(a.opsUsed).toBe(b.opsUsed);
    expect(a.commandCalls).toBe(b.commandCalls);
  });
});

describe('formatCclValue', () => {
  it('renders integers plainly, decimals to 2 places, and words for the rest', () => {
    expect(formatCclValue(42)).toBe('42');
    expect(formatCclValue(1 / 3)).toBe('0.33');
    expect(formatCclValue(true)).toBe('true');
    expect(formatCclValue('hi')).toBe('hi');
    expect(formatCclValue(null)).toBe('nothing');
  });
});
