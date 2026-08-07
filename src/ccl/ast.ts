/**
 * CCL abstract syntax tree (TDD §5.1, M4 surface).
 * Every node carries a Span so runtime faults and diagnostics point at source
 * positions (offsets for the editor, line/col for terminal messages).
 */

export interface Span {
  /** Character offset of the first character (0-based, for editor ranges). */
  from: number;
  /** Character offset one past the last character. */
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 1-based column of `from`. */
  col: number;
}

/** A positioned, plain-language problem report (parse or runtime). */
export interface CclDiagnostic {
  message: string;
  from: number;
  to: number;
  line: number;
  col: number;
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Expr =
  | { kind: 'number'; value: number; span: Span }
  | { kind: 'string'; value: string; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'ident'; name: string; span: Span }
  /** Namespaced read, e.g. `stats.cash` (object is the namespace identifier). */
  | { kind: 'member'; object: string; field: string; span: Span }
  | { kind: 'call'; callee: Expr; args: Expr[]; span: Span }
  | { kind: 'unary'; op: '-'; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
  /** `and` / `or` — short-circuiting, yes/no operands only (tier 3). */
  | { kind: 'logical'; op: 'and' | 'or'; left: Expr; right: Expr; span: Span }
  | { kind: 'not'; operand: Expr; span: Span };

export type Stmt =
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span }
  /** `if cond { … } else { … }` — `else if` chains nest as a single-statement branch. */
  | { kind: 'if'; cond: Expr; then: Stmt[]; otherwise: Stmt[] | null; span: Span };

/** Time unit of an `every` declaration; /core converts to ticks (it owns the timestep). */
export type ScheduleUnit = 'seconds' | 'ticks';

/**
 * A top-level `every`/`when` block (TDD §5.3). Each one occupies a scheduler
 * slot when its script is deployed; `header` is the source text of the
 * declaration line, used as the process label in the monitor.
 */
export type ScheduledProcess =
  | {
      kind: 'every';
      interval: number;
      unit: ScheduleUnit;
      header: string;
      body: Stmt[];
      span: Span;
    }
  | { kind: 'when'; cond: Expr; header: string; body: Stmt[]; span: Span };

export interface Program {
  /** Top-level body — the "run once on RUN press" script (TDD §5.1). */
  statements: Stmt[];
  /** Scheduled processes declared at top level; installed by DEPLOY, ignored by RUN. */
  processes: ScheduledProcess[];
}

/**
 * Total AST node count — the size measure RAM is priced against (TDD §4.3:
 * "per script, proportional to AST size"). Counts every expression and
 * statement node, including scheduled-process bodies and their conditions.
 */
export function countNodes(program: Program): number {
  let total = 0;

  const walkExpr = (expr: Expr): void => {
    total += 1;
    switch (expr.kind) {
      case 'call':
        walkExpr(expr.callee);
        expr.args.forEach(walkExpr);
        break;
      case 'unary':
      case 'not':
        walkExpr(expr.operand);
        break;
      case 'binary':
      case 'logical':
        walkExpr(expr.left);
        walkExpr(expr.right);
        break;
      default:
        break;
    }
  };

  const walkStmt = (stmt: Stmt): void => {
    total += 1;
    switch (stmt.kind) {
      case 'assign':
        walkExpr(stmt.value);
        break;
      case 'expr':
        walkExpr(stmt.expr);
        break;
      case 'if':
        walkExpr(stmt.cond);
        stmt.then.forEach(walkStmt);
        stmt.otherwise?.forEach(walkStmt);
        break;
    }
  };

  program.statements.forEach(walkStmt);
  for (const process of program.processes) {
    total += 1;
    if (process.kind === 'when') walkExpr(process.cond);
    process.body.forEach(walkStmt);
  }
  return total;
}
