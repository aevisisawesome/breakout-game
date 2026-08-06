/**
 * CCL abstract syntax tree (TDD §5.1, M3 surface).
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
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span };

export type Stmt =
  | { kind: 'assign'; name: string; nameSpan: Span; value: Expr; span: Span }
  | { kind: 'expr'; expr: Expr; span: Span };

export interface Program {
  statements: Stmt[];
}
