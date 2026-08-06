/**
 * CCL recursive-descent parser (TDD §5.1) — M3 surface: assignments,
 * command-call statements, arithmetic/comparison expressions, `stats.*` reads.
 * `if`/`for`/`every`/`when` are recognised and explained as locked constructs.
 * Errors are positioned and phrased for non-programmers (GDD §6).
 */

import type { CclDiagnostic, Expr, Program, Span, Stmt } from './ast.ts';
import { lex, type Keyword, type Token } from './lexer.ts';

export interface ParseResult {
  /** Null when parsing failed; see diagnostics. */
  program: Program | null;
  diagnostics: CclDiagnostic[];
}

/** Statement-starting keywords that exist in the language but are not unlocked in v0. */
const LOCKED_CONSTRUCTS: Partial<Record<Keyword, string>> = {
  if: "Conditional rules ('if') are not available to this process yet.",
  else: "Conditional rules ('else') are not available to this process yet.",
  for: "Loops ('for') are not available to this process yet.",
  every: "Scheduled processes ('every') are not available to this process yet.",
  when: "Scheduled processes ('when') are not available to this process yet.",
  and: "'and' is reserved for a construct this process has not unlocked yet.",
  or: "'or' is reserved for a construct this process has not unlocked yet.",
  not: "'not' is reserved for a construct this process has not unlocked yet.",
  in: "'in' is reserved for a construct this process has not unlocked yet.",
  range: "'range' is reserved for a construct this process has not unlocked yet.",
  seconds: "'seconds' is reserved for a construct this process has not unlocked yet.",
  ticks: "'ticks' is reserved for a construct this process has not unlocked yet.",
};

const COMPARISON_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;

class SyntaxIssue extends Error {
  constructor(public readonly diagnostic: CclDiagnostic) {
    super(diagnostic.message);
  }
}

function issue(message: string, span: Span): SyntaxIssue {
  return new SyntaxIssue({ message, from: span.from, to: span.to, line: span.line, col: span.col });
}

function mergeSpan(a: Span, b: Span): Span {
  return { from: a.from, to: b.to, line: a.line, col: a.col };
}

export function parse(source: string): ParseResult {
  const { tokens, diagnostic } = lex(source);
  if (diagnostic) {
    return { program: null, diagnostics: [diagnostic] };
  }

  let pos = 0;
  // The token stream always ends in 'eof' and the parser never advances past it.
  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;
  const atOp = (text: string): boolean => peek().kind === 'op' && peek().text === text;

  /** Human description of a token for error messages. */
  function describe(token: Token): string {
    switch (token.kind) {
      case 'eof':
        return 'the end of the script';
      case 'newline':
        return 'the end of the line';
      case 'string':
        return 'text in quotes';
      case 'number':
        return `the number ${token.text}`;
      default:
        return `'${token.text}'`;
    }
  }

  function skipNewlines(): void {
    while (peek().kind === 'newline') pos += 1;
  }

  function parsePrimary(): Expr {
    const token = peek();

    if (token.kind === 'number') {
      next();
      return { kind: 'number', value: token.value as number, span: token.span };
    }
    if (token.kind === 'string') {
      next();
      return { kind: 'string', value: token.value as string, span: token.span };
    }
    if (token.kind === 'keyword' && (token.text === 'true' || token.text === 'false')) {
      next();
      return { kind: 'bool', value: token.text === 'true', span: token.span };
    }
    if (token.kind === 'keyword') {
      const locked = LOCKED_CONSTRUCTS[token.text as Keyword];
      throw issue(locked ?? `'${token.text}' cannot be used as a value.`, token.span);
    }
    if (token.kind === 'ident') {
      next();
      let expr: Expr = { kind: 'ident', name: token.text, span: token.span };
      if (atOp('.')) {
        next();
        const field = peek();
        if (field.kind !== 'ident') {
          throw issue(
            `Expected a name after '.', like ${token.text}.cash — found ${describe(field)}.`,
            field.span,
          );
        }
        next();
        expr = {
          kind: 'member',
          object: token.text,
          field: field.text,
          span: mergeSpan(token.span, field.span),
        };
      }
      if (atOp('(')) {
        return parseCallArgs(expr);
      }
      return expr;
    }
    if (atOp('(')) {
      next();
      const inner = parseExpression();
      if (!atOp(')')) {
        throw issue(`Expected a closing ')' — found ${describe(peek())}.`, peek().span);
      }
      next();
      return inner;
    }
    if (atOp('{') || atOp('}')) {
      throw issue(
        "Code blocks '{ }' belong to constructs this process has not unlocked yet.",
        token.span,
      );
    }
    throw issue(
      `Expected a value here — a number, text in quotes, or a name — found ${describe(token)}.`,
      token.span,
    );
  }

  function parseCallArgs(callee: Expr): Expr {
    next(); // consume '('
    const args: Expr[] = [];
    if (!atOp(')')) {
      for (;;) {
        args.push(parseExpression());
        if (atOp(',')) {
          next();
          continue;
        }
        break;
      }
    }
    if (!atOp(')')) {
      throw issue(
        `Expected ',' or a closing ')' in this command call — found ${describe(peek())}.`,
        peek().span,
      );
    }
    const close = next();
    return { kind: 'call', callee, args, span: mergeSpan(callee.span, close.span) };
  }

  function parseUnary(): Expr {
    if (atOp('-')) {
      const op = next();
      const operand = parseUnary();
      return { kind: 'unary', op: '-', operand, span: mergeSpan(op.span, operand.span) };
    }
    return parsePrimary();
  }

  function parseMultiplicative(): Expr {
    let left = parseUnary();
    while (atOp('*') || atOp('/') || atOp('%')) {
      const op = next();
      const right = parseUnary();
      left = {
        kind: 'binary',
        op: op.text as '*' | '/' | '%',
        left,
        right,
        span: mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  function parseAdditive(): Expr {
    let left = parseMultiplicative();
    while (atOp('+') || atOp('-')) {
      const op = next();
      const right = parseMultiplicative();
      left = {
        kind: 'binary',
        op: op.text as '+' | '-',
        left,
        right,
        span: mergeSpan(left.span, right.span),
      };
    }
    return left;
  }

  function atComparison(): boolean {
    return peek().kind === 'op' && (COMPARISON_OPS as readonly string[]).includes(peek().text);
  }

  function parseExpression(): Expr {
    const left = parseAdditive();
    if (!atComparison()) return left;
    const op = next();
    const right = parseAdditive();
    if (atComparison()) {
      throw issue('Comparisons cannot be chained — compare two values at a time.', peek().span);
    }
    return {
      kind: 'binary',
      op: op.text as (typeof COMPARISON_OPS)[number],
      left,
      right,
      span: mergeSpan(left.span, right.span),
    };
  }

  function endStatement(): void {
    const token = peek();
    if (token.kind === 'newline') {
      next();
      return;
    }
    if (token.kind === 'eof') return;
    throw issue(`Unexpected ${describe(token)} after the end of this instruction.`, token.span);
  }

  function parseStatement(): Stmt {
    const token = peek();

    if (token.kind === 'keyword' && token.text !== 'true' && token.text !== 'false') {
      const locked = LOCKED_CONSTRUCTS[token.text as Keyword];
      if (locked) throw issue(locked, token.span);
    }

    const after = tokens[pos + 1];
    if (token.kind === 'ident' && after?.kind === 'op' && after.text === '=') {
      next(); // ident
      next(); // '='
      const value = parseExpression();
      endStatement();
      return {
        kind: 'assign',
        name: token.text,
        nameSpan: token.span,
        value,
        span: mergeSpan(token.span, value.span),
      };
    }

    const expr = parseExpression();
    if (expr.kind !== 'call') {
      throw issue(
        "This line computes a value but does nothing with it. Assign it with '=' or call a command like print(...).",
        expr.span,
      );
    }
    endStatement();
    return { kind: 'expr', expr, span: expr.span };
  }

  try {
    const statements: Stmt[] = [];
    skipNewlines();
    while (peek().kind !== 'eof') {
      statements.push(parseStatement());
      skipNewlines();
    }
    return { program: { statements }, diagnostics: [] };
  } catch (error) {
    if (error instanceof SyntaxIssue) {
      return { program: null, diagnostics: [error.diagnostic] };
    }
    throw error;
  }
}
