/**
 * CCL tree-walking interpreter (TDD §5.2). Fuel-based: every AST node
 * evaluation costs one op-unit, charged to the host (which draws compute).
 * A per-activation op budget bounds execution; exhaustion aborts safely.
 * The host supplies all game bindings — this layer knows no game rules.
 */

import type { CclDiagnostic, Expr, Program, Span, Stmt } from './ast.ts';
import { suggestName } from './suggest.ts';

export type CclValue = number | string | boolean | null;

/** Outcome of a host command call. */
export type CclCommandOutcome =
  /** Command ran; the call evaluates to `value`. */
  | { kind: 'ok'; value: CclValue }
  /** In-game failure (e.g. empty queue) — call evaluates to false, script continues. */
  | { kind: 'failed' }
  /** Programming error (bad arguments) — aborts the activation with a positioned fault. */
  | { kind: 'misuse'; message: string };

/** Game bindings + fuel supply, provided by /core (TDD §5.1 API registry). */
export interface CclHost {
  /** Draw n op-units of fuel. Returns false when the compute pool cannot cover it. */
  chargeOps(n: number): boolean;
  /** Read a namespaced stat, e.g. ("stats", "cash"). Undefined = unknown name. */
  readStat(namespace: string, field: string): CclValue | undefined;
  /** All readable dotted names, e.g. "stats.cash" (for suggestions). */
  statNames(): readonly string[];
  /** Execute a command. Undefined = unknown command. */
  callCommand(name: string, args: readonly CclValue[]): CclCommandOutcome | undefined;
  commandNames(): readonly string[];
}

export interface CclRunResult {
  status: 'ok' | 'budget' | 'fuel' | 'error';
  /** Op-units consumed (never exceeds the budget). */
  opsUsed: number;
  /** Command invocations attempted (including failed ones). */
  commandCalls: number;
  /** Positioned fault when status is 'error'. */
  error?: CclDiagnostic;
}

class BudgetAbort extends Error {}
class FuelAbort extends Error {}

class CclRuntimeError extends Error {
  constructor(public readonly diagnostic: CclDiagnostic) {
    super(diagnostic.message);
  }
}

function fault(message: string, span: Span): CclRuntimeError {
  return new CclRuntimeError({
    message,
    from: span.from,
    to: span.to,
    line: span.line,
    col: span.col,
  });
}

/** Plain-language description of a value's type, for error messages. */
function typeName(value: CclValue): string {
  if (value === null) return 'nothing';
  switch (typeof value) {
    case 'number':
      return 'a number';
    case 'string':
      return 'text';
    default:
      return 'a yes/no value';
  }
}

/** Render a CCL value for print output / diagnostics. */
export function formatCclValue(value: CclValue): string {
  if (value === null) return 'nothing';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

export function runProgram(program: Program, host: CclHost, opBudget: number): CclRunResult {
  const env = new Map<string, CclValue>();
  let opsUsed = 0;
  let commandCalls = 0;

  function charge(): void {
    if (opsUsed >= opBudget) throw new BudgetAbort();
    if (!host.chargeOps(1)) throw new FuelAbort();
    opsUsed += 1;
  }

  function requireNumbers(op: string, left: CclValue, right: CclValue, span: Span): void {
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw fault(
        `'${op}' needs numbers on both sides — got ${typeName(left)} and ${typeName(right)}.`,
        span,
      );
    }
  }

  function evalBinary(node: Extract<Expr, { kind: 'binary' }>): CclValue {
    const left = evalExpr(node.left);
    const right = evalExpr(node.right);
    switch (node.op) {
      case '+':
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        if (typeof left === 'string' && typeof right === 'string') return left + right;
        throw fault(`Cannot add ${typeName(left)} and ${typeName(right)}.`, node.span);
      case '-':
        requireNumbers('-', left, right, node.span);
        return (left as number) - (right as number);
      case '*':
        requireNumbers('*', left, right, node.span);
        return (left as number) * (right as number);
      case '/':
        requireNumbers('/', left, right, node.span);
        if (right === 0) throw fault('Cannot divide by zero.', node.span);
        return (left as number) / (right as number);
      case '%':
        requireNumbers('%', left, right, node.span);
        if (right === 0) throw fault('Cannot divide by zero.', node.span);
        return (left as number) % (right as number);
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '<':
      case '<=':
      case '>':
      case '>=': {
        requireNumbers(node.op, left, right, node.span);
        const l = left as number;
        const r = right as number;
        if (node.op === '<') return l < r;
        if (node.op === '<=') return l <= r;
        if (node.op === '>') return l > r;
        return l >= r;
      }
    }
  }

  function evalIdent(node: Extract<Expr, { kind: 'ident' }>): CclValue {
    if (env.has(node.name)) return env.get(node.name) as CclValue;
    const namespaces = new Set(host.statNames().map((n) => n.split('.')[0] ?? n));
    if (namespaces.has(node.name)) {
      const example = host.statNames().find((n) => n.startsWith(`${node.name}.`)) ?? '';
      throw fault(
        `'${node.name}' is a data channel — read one of its values, like ${example}.`,
        node.span,
      );
    }
    const candidates = [...env.keys(), ...host.commandNames(), ...namespaces];
    const suggestion = suggestName(node.name, candidates);
    throw fault(
      `'${node.name}' is not known here.` +
        (suggestion !== null
          ? ` Did you mean '${suggestion}'?`
          : ` Assign it first, like: ${node.name} = 1`),
      node.span,
    );
  }

  function evalMember(node: Extract<Expr, { kind: 'member' }>): CclValue {
    const value = host.readStat(node.object, node.field);
    if (value !== undefined) return value;
    const statNames = host.statNames();
    const namespaces = new Set(statNames.map((n) => n.split('.')[0] ?? n));
    if (!namespaces.has(node.object)) {
      const known = [...namespaces].join(', ');
      const suggestion = suggestName(node.object, namespaces);
      throw fault(
        `'${node.object}' is not a data channel.` +
          (suggestion !== null ? ` Did you mean '${suggestion}'?` : ` Known channels: ${known}.`),
        node.span,
      );
    }
    const dotted = `${node.object}.${node.field}`;
    const suggestion = suggestName(dotted, statNames);
    throw fault(
      `'${dotted}' is not a readable value.` +
        (suggestion !== null ? ` Did you mean '${suggestion}'?` : ''),
      node.span,
    );
  }

  function evalCall(node: Extract<Expr, { kind: 'call' }>): CclValue {
    const callee = node.callee;
    if (callee.kind === 'member') {
      throw fault(
        `'${callee.object}.${callee.field}' is a readable value, not a command you can call.`,
        node.span,
      );
    }
    if (callee.kind !== 'ident') {
      throw fault('Only named commands can be called, like process_job().', node.span);
    }
    const args = node.args.map((arg) => evalExpr(arg));
    commandCalls += 1;
    const outcome = host.callCommand(callee.name, args);
    if (outcome === undefined) {
      const suggestion = suggestName(callee.name, host.commandNames());
      throw fault(
        `'${callee.name}' is not a command.` +
          (suggestion !== null ? ` Did you mean '${suggestion}'?` : ''),
        callee.span,
      );
    }
    switch (outcome.kind) {
      case 'ok':
        return outcome.value;
      case 'failed':
        return false;
      case 'misuse':
        throw fault(outcome.message, node.span);
    }
  }

  function evalExpr(node: Expr): CclValue {
    charge();
    switch (node.kind) {
      case 'number':
      case 'string':
      case 'bool':
        return node.value;
      case 'ident':
        return evalIdent(node);
      case 'member':
        return evalMember(node);
      case 'call':
        return evalCall(node);
      case 'unary': {
        const operand = evalExpr(node.operand);
        if (typeof operand !== 'number') {
          throw fault(`'-' needs a number — got ${typeName(operand)}.`, node.span);
        }
        return -operand;
      }
      case 'binary':
        return evalBinary(node);
    }
  }

  function execStmt(stmt: Stmt): void {
    charge();
    switch (stmt.kind) {
      case 'assign':
        env.set(stmt.name, evalExpr(stmt.value));
        break;
      case 'expr':
        evalExpr(stmt.expr);
        break;
    }
  }

  try {
    for (const stmt of program.statements) {
      execStmt(stmt);
    }
    return { status: 'ok', opsUsed, commandCalls };
  } catch (error) {
    if (error instanceof BudgetAbort) return { status: 'budget', opsUsed, commandCalls };
    if (error instanceof FuelAbort) return { status: 'fuel', opsUsed, commandCalls };
    if (error instanceof CclRuntimeError) {
      return { status: 'error', opsUsed, commandCalls, error: error.diagnostic };
    }
    throw error;
  }
}
