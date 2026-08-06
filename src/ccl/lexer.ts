/**
 * CCL lexer (TDD §5.1). Hand-written scanner producing positioned tokens.
 * Newlines terminate statements except inside parentheses; `#` starts a
 * line comment. Errors are plain-language and positioned (GDD §6).
 */

import type { CclDiagnostic, Span } from './ast.ts';

/**
 * Reserved words. Only `true`/`false` are live in M3; the rest are held back
 * for later tiers so the parser can explain locked constructs instead of
 * misreading them as variable names.
 */
export const KEYWORDS = [
  'if',
  'else',
  'for',
  'in',
  'range',
  'every',
  'when',
  'seconds',
  'ticks',
  'and',
  'or',
  'not',
  'true',
  'false',
] as const;

export type Keyword = (typeof KEYWORDS)[number];

export type TokenKind = 'ident' | 'keyword' | 'number' | 'string' | 'op' | 'newline' | 'eof';

export interface Token {
  kind: TokenKind;
  /** Raw source text (for ops/idents/keywords) or a canonical form. */
  text: string;
  /** Parsed value for number/string tokens. */
  value?: number | string;
  span: Span;
}

export interface LexResult {
  tokens: Token[];
  /** Non-null when lexing failed; tokens then cover the prefix before the error. */
  diagnostic: CclDiagnostic | null;
}

const TWO_CHAR_OPS = ['==', '!=', '<=', '>='] as const;
const ONE_CHAR_OPS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '=',
  '<',
  '>',
  ',',
  '.',
  '{',
  '}',
] as const;

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;
  let parenDepth = 0;

  const spanFrom = (from: number, fromLine: number, fromLineStart: number): Span => ({
    from,
    to: pos,
    line: fromLine,
    col: from - fromLineStart + 1,
  });

  const fail = (message: string, from: number): LexResult => ({
    tokens,
    diagnostic: {
      message,
      from,
      to: Math.max(pos, from + 1),
      line,
      col: from - lineStart + 1,
    },
  });

  while (pos < source.length) {
    const start = pos;
    const startLine = line;
    const startLineStart = lineStart;
    const c = source[pos]!; // loop condition guarantees pos < source.length

    if (c === '\r') {
      pos += 1;
      continue;
    }

    if (c === '\n') {
      pos += 1;
      line += 1;
      lineStart = pos;
      // Newlines separate statements; inside parentheses they are just spacing.
      if (parenDepth === 0 && tokens[tokens.length - 1]?.kind !== 'newline' && tokens.length > 0) {
        tokens.push({
          kind: 'newline',
          text: '\n',
          span: spanFrom(start, startLine, startLineStart),
        });
      }
      continue;
    }

    if (c === ' ' || c === '\t') {
      pos += 1;
      continue;
    }

    if (c === '#') {
      while (pos < source.length && source[pos] !== '\n') pos += 1;
      continue;
    }

    if (isDigit(c)) {
      pos += 1;
      while (pos < source.length && isDigit(source[pos]!)) pos += 1;
      if (source[pos] === '.' && isDigit(source[pos + 1] ?? '')) {
        pos += 1;
        while (pos < source.length && isDigit(source[pos]!)) pos += 1;
      }
      const text = source.slice(start, pos);
      tokens.push({
        kind: 'number',
        text,
        value: Number(text),
        span: spanFrom(start, startLine, startLineStart),
      });
      continue;
    }

    if (isIdentStart(c)) {
      pos += 1;
      while (pos < source.length && isIdentPart(source[pos]!)) pos += 1;
      const text = source.slice(start, pos);
      const kind: TokenKind = (KEYWORDS as readonly string[]).includes(text) ? 'keyword' : 'ident';
      tokens.push({ kind, text, span: spanFrom(start, startLine, startLineStart) });
      continue;
    }

    if (c === '"') {
      pos += 1;
      let value = '';
      let closed = false;
      while (pos < source.length) {
        const ch = source[pos];
        if (ch === '"') {
          pos += 1;
          closed = true;
          break;
        }
        if (ch === '\n') break;
        if (ch === '\\') {
          const next = source[pos + 1];
          if (next === '"' || next === '\\') {
            value += next;
            pos += 2;
            continue;
          }
          if (next === 'n') {
            value += '\n';
            pos += 2;
            continue;
          }
        }
        value += ch;
        pos += 1;
      }
      if (!closed) {
        return fail('This text never ends — add a closing quote (").', start);
      }
      tokens.push({
        kind: 'string',
        text: source.slice(start, pos),
        value,
        span: spanFrom(start, startLine, startLineStart),
      });
      continue;
    }

    const two = source.slice(pos, pos + 2);
    if ((TWO_CHAR_OPS as readonly string[]).includes(two)) {
      pos += 2;
      tokens.push({ kind: 'op', text: two, span: spanFrom(start, startLine, startLineStart) });
      continue;
    }

    if (c === '!') {
      pos += 1;
      return fail(`'!' on its own means nothing here. To compare, use '!=' (not equal).`, start);
    }

    if ((ONE_CHAR_OPS as readonly string[]).includes(c)) {
      pos += 1;
      if (c === '(') parenDepth += 1;
      if (c === ')') parenDepth = Math.max(0, parenDepth - 1);
      tokens.push({ kind: 'op', text: c, span: spanFrom(start, startLine, startLineStart) });
      continue;
    }

    pos += 1;
    return fail(`Unexpected character '${c}'.`, start);
  }

  tokens.push({
    kind: 'eof',
    text: '',
    span: { from: pos, to: pos, line, col: pos - lineStart + 1 },
  });
  return { tokens, diagnostic: null };
}
