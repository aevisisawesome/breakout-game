/**
 * Interpreter semantics + fuel accounting (TDD §5.2, §10) against a mock host.
 * Fuel model under test: every AST node evaluation charges exactly 1 op-unit.
 */

import { describe, expect, it } from 'vitest';

import { parse, type ParseOptions } from './parser.ts';
import {
  evalCondition,
  formatCclValue,
  runProgram,
  runStatements,
  type CclCommandOutcome,
  type CclHost,
  type CclRunResult,
  type CclValue,
} from './interpreter.ts';

/** Every tier unlocked — the M4 end state. */
const ALL: ParseOptions = { conditions: true, scheduling: true };

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

// ---------------------------------------------------------------------------
// M4: conditions (tier 3) and `when` guards (tier 4)

describe('if / else', () => {
  function tiered(source: string, host: CclHost, budget = 1000): CclRunResult {
    const { program, diagnostics } = parse(source, ALL);
    expect(diagnostics).toEqual([]);
    return runProgram(program!, host, budget);
  }

  it('takes the branch the condition selects', () => {
    const host = mockHost({ stats: { 'stats.cash': 50 } });
    tiered('if stats.cash > 10 {\n  print("rich")\n} else {\n  print("poor")\n}', host);
    expect(host.printed).toEqual(['rich']);
  });

  it('takes the else branch and skips the untaken one entirely (no fuel spent on it)', () => {
    const host = mockHost({ stats: { 'stats.cash': 1 } });
    const taken = tiered('if stats.cash > 10 {\n  print(1)\n}', host);
    const withElse = tiered('if stats.cash > 10 {\n  print(1)\n} else {\n  print(2)\n}', host);
    expect(host.printed).toEqual([2]);
    // The else branch adds exactly the nodes it actually executed.
    expect(withElse.opsUsed).toBeGreaterThan(taken.opsUsed);
  });

  it('runs an else-if chain', () => {
    const host = mockHost({ stats: { 'stats.cash': 5 } });
    tiered(
      'if stats.cash > 10 {\n  print("a")\n} else if stats.cash > 3 {\n  print("b")\n} else {\n  print("c")\n}',
      host,
    );
    expect(host.printed).toEqual(['b']);
  });

  it('refuses a non-boolean condition with plain-language guidance', () => {
    const result = tiered('if stats.cash {\n  print(1)\n}', mockHost());
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('yes/no value');
    expect(result.error?.message).toContain('stats.cash > 10');
  });
});

describe('and / or / not', () => {
  function value(source: string, stats: Record<string, CclValue>): CclValue[] {
    const host = mockHost({ stats });
    const { program } = parse(source, ALL);
    runProgram(program!, host, 1000);
    return host.printed;
  }

  it('evaluates logical combinations', () => {
    const stats = { 'stats.cash': 50, 'stats.energy': 2 };
    expect(value('print(stats.cash > 10 and stats.energy > 10)', stats)).toEqual([false]);
    expect(value('print(stats.cash > 10 or stats.energy > 10)', stats)).toEqual([true]);
    expect(value('print(not stats.energy > 10)', stats)).toEqual([true]);
  });

  it('short-circuits: the right side is never evaluated, so it costs no fuel', () => {
    const host = mockHost({ stats: { 'stats.cash': 0 } });
    const { program } = parse('x = stats.cash > 10 and stats.cash > 5', ALL);
    const short = runProgram(program!, host, 1000);

    const host2 = mockHost({ stats: { 'stats.cash': 50 } });
    const { program: program2 } = parse('x = stats.cash > 10 and stats.cash > 5', ALL);
    const full = runProgram(program2!, host2, 1000);

    expect(short.status).toBe('ok');
    expect(short.opsUsed).toBeLessThan(full.opsUsed);
  });

  it('refuses non-boolean operands', () => {
    const { program } = parse('x = stats.cash and true', ALL);
    const result = runProgram(program!, mockHost(), 1000);
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain("'and'");
  });
});

describe('runStatements + evalCondition (scheduled processes)', () => {
  it('runs a process body with its own fresh variable scope', () => {
    const { program } = parse('every 1 seconds {\n  x = 2\n  print(x)\n}', ALL);
    const body = program!.processes[0]!.body;
    const host = mockHost();
    expect(runStatements(body, host, 1000).status).toBe('ok');
    // A second activation starts clean and still resolves x from its own assignment.
    expect(runStatements(body, host, 1000).status).toBe('ok');
    expect(host.printed).toEqual([2, 2]);
  });

  it('evaluates a when guard to a boolean, charging fuel for it', () => {
    const { program } = parse('when stats.cash > 10 {\n  print(1)\n}', ALL);
    const guard = program!.processes[0]!;
    if (guard.kind !== 'when') throw new Error('expected a when process');
    const host = mockHost({ stats: { 'stats.cash': 50 } });
    const result = evalCondition(guard.cond, host, 1000);
    expect(result.value).toBe(true);
    expect(result.opsUsed).toBe(3); // comparison + member read + literal
    expect(host.opsCharged).toBe(3);
  });

  it('reads a guard that faults or runs out of fuel as false', () => {
    const { program } = parse('when nonsense > 1 {\n  print(1)\n}', ALL);
    const guard = program!.processes[0]!;
    if (guard.kind !== 'when') throw new Error('expected a when process');
    const faulted = evalCondition(guard.cond, mockHost(), 1000);
    expect(faulted.status).toBe('error');
    expect(faulted.value).toBe(false);

    const starved = evalCondition(guard.cond, mockHost({ fuelLimit: 0 }), 1000);
    expect(starved.status).toBe('fuel');
    expect(starved.value).toBe(false);
  });

  it('counts command failures separately from command calls', () => {
    const host = mockHost({
      commands: { flaky: () => ({ kind: 'failed' }) },
    });
    const { program } = parse('flaky()\nflaky()\nprint(1)', ALL);
    const result = runProgram(program!, host, 1000);
    expect(result.commandCalls).toBe(3);
    expect(result.commandFailures).toBe(2);
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
