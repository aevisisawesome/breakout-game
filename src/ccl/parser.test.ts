/** Parser golden tests: source → AST shapes, plus plain-language diagnostics. */

import { describe, expect, it } from 'vitest';

import { countNodes, type Expr, type Stmt } from './ast.ts';
import { parse, type ParseOptions } from './parser.ts';

/** Every tier unlocked — the M4 end state. */
const ALL: ParseOptions = { conditions: true, scheduling: true };

/** Strip spans so golden comparisons stay readable. */
function bare(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(bare);
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'span' || key === 'nameSpan') continue;
      out[key] = bare(value);
    }
    return out;
  }
  return node;
}

function statements(source: string): unknown[] {
  const { program, diagnostics } = parse(source);
  expect(diagnostics).toEqual([]);
  return (program!.statements as Stmt[]).map(bare);
}

function firstError(source: string): string {
  const { program, diagnostics } = parse(source);
  expect(program).toBeNull();
  return diagnostics[0]!.message;
}

describe('parse — golden ASTs', () => {
  it('parses the GDD tier-1 dashboard script', () => {
    expect(statements('cash = stats.cash\nprint(stats.jobs_waiting)')).toEqual([
      {
        kind: 'assign',
        name: 'cash',
        value: { kind: 'member', object: 'stats', field: 'cash' },
      },
      {
        kind: 'expr',
        expr: {
          kind: 'call',
          callee: { kind: 'ident', name: 'print' },
          args: [{ kind: 'member', object: 'stats', field: 'jobs_waiting' }],
        },
      },
    ]);
  });

  it('applies arithmetic precedence and parentheses', () => {
    expect(statements('x = 1 + 2 * 3')).toEqual([
      {
        kind: 'assign',
        name: 'x',
        value: {
          kind: 'binary',
          op: '+',
          left: { kind: 'number', value: 1 },
          right: {
            kind: 'binary',
            op: '*',
            left: { kind: 'number', value: 2 },
            right: { kind: 'number', value: 3 },
          },
        },
      },
    ]);
    expect(statements('y = (1 + 2) * 3')).toEqual([
      {
        kind: 'assign',
        name: 'y',
        value: {
          kind: 'binary',
          op: '*',
          left: {
            kind: 'binary',
            op: '+',
            left: { kind: 'number', value: 1 },
            right: { kind: 'number', value: 2 },
          },
          right: { kind: 'number', value: 3 },
        },
      },
    ]);
  });

  it('parses comparisons over arithmetic', () => {
    expect(statements('ok = stats.energy > 10 + 5')).toEqual([
      {
        kind: 'assign',
        name: 'ok',
        value: {
          kind: 'binary',
          op: '>',
          left: { kind: 'member', object: 'stats', field: 'energy' },
          right: {
            kind: 'binary',
            op: '+',
            left: { kind: 'number', value: 10 },
            right: { kind: 'number', value: 5 },
          },
        },
      },
    ]);
  });

  it('parses commands with multiple arguments and unary minus', () => {
    expect(statements('buy_compute(2 + 3)\nx = -4')).toEqual([
      {
        kind: 'expr',
        expr: {
          kind: 'call',
          callee: { kind: 'ident', name: 'buy_compute' },
          args: [
            {
              kind: 'binary',
              op: '+',
              left: { kind: 'number', value: 2 },
              right: { kind: 'number', value: 3 },
            },
          ],
        },
      },
      {
        kind: 'assign',
        name: 'x',
        value: { kind: 'unary', op: '-', operand: { kind: 'number', value: 4 } },
      },
    ]);
  });

  it('accepts an empty program and trailing newlines', () => {
    expect(statements('')).toEqual([]);
    expect(statements('\n\n# only a comment\n')).toEqual([]);
  });
});

describe('parse — diagnostics (plain language, positioned)', () => {
  it('explains locked constructs instead of failing cryptically', () => {
    expect(firstError('if stats.cash > 10 {\n  process_job()\n}')).toContain(
      "Conditional rules ('if')",
    );
    expect(firstError('every 5 seconds {\n  process_job()\n}')).toContain('Scheduled processes');
    expect(firstError('for i in range(10) {\n}')).toContain("Loops ('for')");
  });

  it('rejects a value-only line with advice', () => {
    const message = firstError('stats.cash + 5');
    expect(message).toContain('does nothing with it');
    expect(message).toContain('print');
  });

  it('positions the error where the parenthesis fails to close', () => {
    // Newlines inside '(' … ')' are spacing, so the fault lands on the next token.
    const { diagnostics } = parse('x = 1\ny = (2 + 3\nz = 4');
    expect(diagnostics[0]!.line).toBe(3);
    expect(diagnostics[0]!.message).toContain("closing ')'");
  });

  it('explains chained comparisons', () => {
    expect(firstError('x = 1 < 2 < 3')).toContain('cannot be chained');
  });

  it('explains an incomplete member read', () => {
    expect(firstError('x = stats.')).toContain("Expected a name after '.'");
  });

  it('reports leftovers after a complete instruction', () => {
    expect(firstError('x = 1 2')).toContain('after the end of this instruction');
  });

  it('describes unexpected tokens in words', () => {
    expect(firstError('x = ')).toContain('Expected a value here');
  });
});

describe('parse — spans', () => {
  it('covers the full call in the statement span', () => {
    const { program } = parse('print(1)');
    const stmt = program!.statements[0]!;
    expect(stmt.span.from).toBe(0);
    expect(stmt.span.to).toBe(8);
    const call = (stmt as { expr: Expr }).expr;
    expect(call.span.to).toBe(8);
  });

  it('spans an if statement from the keyword to its closing brace', () => {
    const source = 'if true {\n  print(1)\n}';
    const { program } = parse(source, ALL);
    const stmt = program!.statements[0]!;
    expect(stmt.span.from).toBe(0);
    expect(stmt.span.to).toBe(source.length);
  });
});

// ---------------------------------------------------------------------------
// M4: conditions (tier 3) and scheduling (tier 4)

describe('parse — conditions (tier 3)', () => {
  function tiered(source: string, options: ParseOptions = ALL): unknown[] {
    const { program, diagnostics } = parse(source, options);
    expect(diagnostics).toEqual([]);
    return (program!.statements as Stmt[]).map(bare);
  }

  it('parses the GDD tier-3 example', () => {
    expect(tiered('if stats.compute_available > 20 {\n  process_job()\n}')).toEqual([
      {
        kind: 'if',
        cond: {
          kind: 'binary',
          op: '>',
          left: { kind: 'member', object: 'stats', field: 'compute_available' },
          right: { kind: 'number', value: 20 },
        },
        then: [
          {
            kind: 'expr',
            expr: { kind: 'call', callee: { kind: 'ident', name: 'process_job' }, args: [] },
          },
        ],
        otherwise: null,
      },
    ]);
  });

  it('parses if/else with both branches', () => {
    const [stmt] = tiered('if stats.temperature > 80 {\n  print(1)\n} else {\n  process_job()\n}');
    expect(stmt).toMatchObject({ kind: 'if', otherwise: [{ kind: 'expr' }] });
  });

  it('chains else if as a nested if in the else branch', () => {
    const [stmt] = tiered('if false {\n  print(1)\n} else if true {\n  print(2)\n}');
    expect(stmt).toMatchObject({ kind: 'if', otherwise: [{ kind: 'if' }] });
  });

  it("does not treat a following 'if' as an else branch", () => {
    const statements = tiered('if true {\n  print(1)\n}\nif false {\n  print(2)\n}');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatchObject({ otherwise: null });
  });

  it("gives 'and'/'or'/'not' the expected precedence", () => {
    expect(tiered('x = not true or false and true')).toEqual([
      {
        kind: 'assign',
        name: 'x',
        value: {
          kind: 'logical',
          op: 'or',
          left: { kind: 'not', operand: { kind: 'bool', value: true } },
          right: {
            kind: 'logical',
            op: 'and',
            left: { kind: 'bool', value: false },
            right: { kind: 'bool', value: true },
          },
        },
      },
    ]);
  });

  it('binds comparison tighter than the logical operators', () => {
    const [stmt] = tiered('ok = stats.cash > 10 and stats.energy < 5');
    expect(stmt).toMatchObject({
      value: { kind: 'logical', op: 'and', left: { op: '>' }, right: { op: '<' } },
    });
  });

  it('still explains the tier as locked when conditions are not unlocked', () => {
    expect(firstError('if stats.cash > 10 {\n}')).toContain("Conditional rules ('if')");
    const { diagnostics } = parse('x = true and false', { scheduling: true });
    expect(diagnostics[0]!.message).toContain("'and' is reserved");
  });

  it('reports an unterminated block at the brace that opened it', () => {
    const { diagnostics } = parse('if true {\n  print(1)\n', ALL);
    expect(diagnostics[0]!.message).toContain('never ends');
    expect(diagnostics[0]!.line).toBe(1);
  });

  it("rejects a stray 'else'", () => {
    const { diagnostics } = parse('else {\n}', ALL);
    expect(diagnostics[0]!.message).toContain("can only follow an 'if' block");
  });
});

describe('parse — scheduled processes (tier 4)', () => {
  it('parses the GDD tier-4 examples into processes, not statements', () => {
    const { program, diagnostics } = parse(
      'every 5 seconds {\n  process_job()\n}\nwhen stats.temperature > 90 {\n  print(1)\n}',
      ALL,
    );
    expect(diagnostics).toEqual([]);
    expect(program!.statements).toEqual([]);
    expect(program!.processes).toHaveLength(2);
    expect(program!.processes[0]).toMatchObject({
      kind: 'every',
      interval: 5,
      unit: 'seconds',
      header: 'every 5 seconds',
    });
    expect(program!.processes[1]).toMatchObject({
      kind: 'when',
      header: 'when stats.temperature > 90',
    });
  });

  it('keeps the run-once body separate from the declarations', () => {
    const { program } = parse('print(1)\nevery 2 ticks {\n  process_job()\n}', ALL);
    expect(program!.statements).toHaveLength(1);
    expect(program!.processes).toHaveLength(1);
    expect(program!.processes[0]).toMatchObject({ unit: 'ticks', interval: 2 });
  });

  it('allows declarations only at the top level (TDD §5.1)', () => {
    const { diagnostics } = parse('if true {\n  every 5 seconds {\n  }\n}', ALL);
    expect(diagnostics[0]!.message).toContain('only be declared at the top level');
  });

  it('explains a malformed interval in plain language', () => {
    expect(parse('every seconds {\n}', ALL).diagnostics[0]!.message).toContain('every 5 seconds');
    expect(parse('every 5 {\n}', ALL).diagnostics[0]!.message).toContain("'seconds' or 'ticks'");
    expect(parse('every 0 seconds {\n}', ALL).diagnostics[0]!.message).toContain(
      'greater than zero',
    );
  });

  it('explains the tier as locked when scheduling is not unlocked', () => {
    const { diagnostics } = parse('every 5 seconds {\n}', { conditions: true });
    expect(diagnostics[0]!.message).toContain('Scheduled processes');
  });

  it('points stray braces at the constructs that can carry them', () => {
    expect(parse('x = {', ALL).diagnostics[0]!.message).toContain("can only follow 'if'");
    expect(parse('x = {').diagnostics[0]!.message).toContain('has not unlocked yet');
  });
});

describe('countNodes — RAM sizing (TDD §4.3)', () => {
  it('counts statements, expressions and scheduled bodies', () => {
    // 1 declaration + (1 if + 3 cond nodes) + (1 stmt + 1 call + 1 callee) = 8.
    const { program } = parse(
      'every 5 seconds {\n  if stats.cash > 1 {\n    process_job()\n  }\n}',
      ALL,
    );
    expect(countNodes(program!)).toBe(8);
  });

  it('grows with script size', () => {
    const small = parse('print(1)', ALL).program!;
    const large = parse('print(1)\nprint(2)\nprint(3)', ALL).program!;
    expect(countNodes(large)).toBeGreaterThan(countNodes(small));
  });
});
