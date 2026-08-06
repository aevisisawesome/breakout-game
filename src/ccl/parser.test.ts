/** Parser golden tests: source → AST shapes, plus plain-language diagnostics. */

import { describe, expect, it } from 'vitest';

import type { Expr, Stmt } from './ast.ts';
import { parse } from './parser.ts';

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
});
