/** Lexer golden tests (TDD §10: treat CCL like a real compiler project). */

import { describe, expect, it } from 'vitest';

import { lex } from './lexer.ts';

function kinds(source: string): string[] {
  const { tokens, diagnostic } = lex(source);
  expect(diagnostic).toBeNull();
  return tokens.map((t) => `${t.kind}:${t.text}`);
}

describe('lex — tokens', () => {
  it('tokenizes an assignment with positions', () => {
    const { tokens } = lex('cash = stats.cash');
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['ident', 'cash'],
      ['op', '='],
      ['ident', 'stats'],
      ['op', '.'],
      ['ident', 'cash'],
      ['eof', ''],
    ]);
    expect(tokens[2]!.span).toEqual({ from: 7, to: 12, line: 1, col: 8 });
  });

  it('parses numbers, strings with escapes, and booleans as keywords', () => {
    const { tokens } = lex('x = 12.5\ny = "a \\"b\\""\nz = true');
    const numTok = tokens.find((t) => t.kind === 'number');
    expect(numTok?.value).toBe(12.5);
    const strTok = tokens.find((t) => t.kind === 'string');
    expect(strTok?.value).toBe('a "b"');
    expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'true')).toBe(true);
  });

  it('collapses blank lines and skips comments', () => {
    expect(kinds('a = 1\n\n\n# note\nb = 2')).toEqual([
      'ident:a',
      'op:=',
      'number:1',
      'newline:\n',
      'ident:b',
      'op:=',
      'number:2',
      'eof:',
    ]);
  });

  it('suppresses newlines inside parentheses', () => {
    expect(kinds('print(\n1\n)')).toEqual(['ident:print', 'op:(', 'number:1', 'op:)', 'eof:']);
  });

  it('lexes two-character comparison operators as single tokens', () => {
    expect(kinds('1 <= 2 == 3 != 4 >= 5')).toEqual([
      'number:1',
      'op:<=',
      'number:2',
      'op:==',
      'number:3',
      'op:!=',
      'number:4',
      'op:>=',
      'number:5',
      'eof:',
    ]);
  });
});

describe('lex — errors', () => {
  it('reports an unterminated string in plain language, positioned', () => {
    const { diagnostic } = lex('x = "abc');
    expect(diagnostic?.message).toContain('closing quote');
    expect(diagnostic?.line).toBe(1);
    expect(diagnostic?.col).toBe(5);
  });

  it('explains a lone "!"', () => {
    const { diagnostic } = lex('x = 1 ! 2');
    expect(diagnostic?.message).toContain("'!='");
  });

  it('rejects unknown characters with the character named', () => {
    const { diagnostic } = lex('x = 1 @ 2');
    expect(diagnostic?.message).toContain("'@'");
  });
});
