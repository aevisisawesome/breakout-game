/**
 * CCL recursive-descent parser (TDD §5.1) — M4 surface: assignments,
 * command-call statements, arithmetic/comparison/logical expressions,
 * `stats.*` reads, `if`/`else`, and top-level `every`/`when` declarations.
 *
 * Constructs are unlock-gated: locked ones are recognised and explained rather
 * than misread. The caller (the engine, or the editor's linter via the snapshot)
 * supplies the player's current unlock state in ParseOptions.
 * Errors are positioned and phrased for non-programmers (GDD §6).
 */

import type {
  CclDiagnostic,
  Expr,
  Program,
  ScheduledProcess,
  ScheduleUnit,
  Span,
  Stmt,
} from './ast.ts';
import { lex, type Keyword, type Token } from './lexer.ts';

/** Which language tiers the player has unlocked. Everything defaults to locked. */
export interface ParseOptions {
  /** Tier 3: `if`/`else` and the `and`/`or`/`not` operators. */
  conditions?: boolean;
  /** Tier 4: top-level `every N seconds` / `when expr` scheduled processes. */
  scheduling?: boolean;
}

export interface ParseResult {
  /** Null when parsing failed; see diagnostics. */
  program: Program | null;
  diagnostics: CclDiagnostic[];
}

/** Keywords that exist in the language but belong to a tier the player may not have. */
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

/** Keywords unlocked by each tier — removed from LOCKED_CONSTRUCTS when granted. */
const CONDITION_KEYWORDS: readonly Keyword[] = ['if', 'else', 'and', 'or', 'not'];
const SCHEDULING_KEYWORDS: readonly Keyword[] = ['every', 'when', 'seconds', 'ticks'];

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

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const unlocked = new Set<Keyword>();
  if (options.conditions === true) for (const k of CONDITION_KEYWORDS) unlocked.add(k);
  if (options.scheduling === true) for (const k of SCHEDULING_KEYWORDS) unlocked.add(k);
  const blocksAvailable = unlocked.size > 0;

  /** Locked-tier message for a keyword, or null when the player may use it. */
  const lockedMessage = (word: string): string | null => {
    if (unlocked.has(word as Keyword)) return null;
    return LOCKED_CONSTRUCTS[word as Keyword] ?? null;
  };

  const { tokens, diagnostic } = lex(source);
  if (diagnostic) {
    return { program: null, diagnostics: [diagnostic] };
  }

  let pos = 0;
  /** Block nesting depth; scheduled processes may only be declared at 0 (TDD §5.1). */
  let depth = 0;
  // The token stream always ends in 'eof' and the parser never advances past it.
  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;
  const atOp = (text: string): boolean => peek().kind === 'op' && peek().text === text;
  const atKeyword = (text: Keyword): boolean => peek().kind === 'keyword' && peek().text === text;

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
      const locked = lockedMessage(token.text);
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
        blocksAvailable
          ? "Code blocks '{ }' can only follow 'if', 'else', 'every' or 'when'."
          : "Code blocks '{ }' belong to constructs this process has not unlocked yet.",
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

  function parseComparison(): Expr {
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

  /** `not` binds tighter than `and`/`or` and looser than comparison. */
  function parseNot(): Expr {
    if (atKeyword('not') && unlocked.has('not')) {
      const op = next();
      const operand = parseNot();
      return { kind: 'not', operand, span: mergeSpan(op.span, operand.span) };
    }
    return parseComparison();
  }

  function parseAnd(): Expr {
    let left = parseNot();
    while (atKeyword('and') && unlocked.has('and')) {
      next();
      const right = parseNot();
      left = { kind: 'logical', op: 'and', left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  function parseExpression(): Expr {
    let left = parseAnd();
    while (atKeyword('or') && unlocked.has('or')) {
      next();
      const right = parseAnd();
      left = { kind: 'logical', op: 'or', left, right, span: mergeSpan(left.span, right.span) };
    }
    return left;
  }

  function endStatement(): void {
    const token = peek();
    if (token.kind === 'newline') {
      next();
      return;
    }
    // A block's closing brace ends the statement inside it (not consumed here).
    if (token.kind === 'eof' || (depth > 0 && token.kind === 'op' && token.text === '}')) return;
    // A locked operator (`and`, `or`, …) reads as leftovers; explain the tier instead.
    if (token.kind === 'keyword') {
      const locked = lockedMessage(token.text);
      if (locked) throw issue(locked, token.span);
    }
    throw issue(`Unexpected ${describe(token)} after the end of this instruction.`, token.span);
  }

  /** Span of the `}` closing the most recently parsed block, for statement spans. */
  let lastBlockEnd: Span = { from: 0, to: 0, line: 1, col: 1 };

  /** `{ statement* }` — the body of an `if`, `else`, `every` or `when`. */
  function parseBlock(introducer: string): Stmt[] {
    if (!atOp('{')) {
      throw issue(
        `Expected '{' to open the block of instructions for '${introducer}' — found ${describe(peek())}.`,
        peek().span,
      );
    }
    const open = next();
    depth += 1;
    const body: Stmt[] = [];
    skipNewlines();
    while (!atOp('}')) {
      if (peek().kind === 'eof') {
        throw issue(`This '${introducer}' block never ends — add a closing '}'.`, open.span);
      }
      body.push(parseStatement());
      skipNewlines();
    }
    lastBlockEnd = next().span; // consume '}'
    depth -= 1;
    return body;
  }

  function parseIf(): Stmt {
    const start = next(); // consume 'if'
    const cond = parseExpression();
    const then = parseBlock('if');
    let otherwise: Stmt[] | null = null;
    let end = lastBlockEnd;
    // `else` may follow on the same line or the next one.
    const save = pos;
    skipNewlines();
    if (atKeyword('else')) {
      next();
      if (atKeyword('if')) {
        const nested = parseIf();
        otherwise = [nested];
        end = nested.span;
      } else {
        otherwise = parseBlock('else');
        end = lastBlockEnd;
      }
    } else {
      pos = save;
    }
    return { kind: 'if', cond, then, otherwise, span: mergeSpan(start.span, end) };
  }

  /** Source text of a declaration header, used as the process label in the monitor. */
  function headerText(from: number, to: number): string {
    return source.slice(from, to).replace(/\s+/g, ' ').trim();
  }

  function parseEvery(): ScheduledProcess {
    const start = next(); // consume 'every'
    const amount = peek();
    if (amount.kind !== 'number') {
      throw issue(
        `'every' needs a length of time, like: every 5 seconds — found ${describe(amount)}.`,
        amount.span,
      );
    }
    next();
    const interval = amount.value as number;
    if (interval <= 0) {
      throw issue("'every' needs a length of time greater than zero.", amount.span);
    }
    const unitToken = peek();
    if (
      unitToken.kind !== 'keyword' ||
      (unitToken.text !== 'seconds' && unitToken.text !== 'ticks')
    ) {
      throw issue(
        `Expected 'seconds' or 'ticks' after the number — found ${describe(unitToken)}.`,
        unitToken.span,
      );
    }
    next();
    const header = headerText(start.span.from, unitToken.span.to);
    const body = parseBlock('every');
    return {
      kind: 'every',
      interval,
      unit: unitToken.text as ScheduleUnit,
      header,
      body,
      span: mergeSpan(start.span, lastBlockEnd),
    };
  }

  function parseWhen(): ScheduledProcess {
    const start = next(); // consume 'when'
    const cond = parseExpression();
    const header = headerText(start.span.from, cond.span.to);
    const body = parseBlock('when');
    return { kind: 'when', cond, header, body, span: mergeSpan(start.span, lastBlockEnd) };
  }

  function parseStatement(): Stmt {
    const token = peek();

    if (token.kind === 'keyword' && token.text !== 'true' && token.text !== 'false') {
      const locked = lockedMessage(token.text);
      if (locked) throw issue(locked, token.span);
      if (token.text === 'if') return parseIf();
      if (token.text === 'else') {
        throw issue("'else' can only follow an 'if' block.", token.span);
      }
      if (token.text === 'every' || token.text === 'when') {
        // Reached only inside a block: top-level declarations are handled below.
        throw issue(
          `Scheduled processes ('${token.text}') can only be declared at the top level of a script, not inside another block.`,
          token.span,
        );
      }
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
    const processes: ScheduledProcess[] = [];
    skipNewlines();
    while (peek().kind !== 'eof') {
      if (atKeyword('every') && unlocked.has('every')) {
        processes.push(parseEvery());
      } else if (atKeyword('when') && unlocked.has('when')) {
        processes.push(parseWhen());
      } else {
        statements.push(parseStatement());
      }
      skipNewlines();
    }
    return { program: { statements, processes }, diagnostics: [] };
  } catch (error) {
    if (error instanceof SyntaxIssue) {
      return { program: null, diagnostics: [error.diagnostic] };
    }
    throw error;
  }
}
