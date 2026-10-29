// plan 6.3 Size and Statement count; the shared MetricValue constructor. docs/METRICS.md sections 6 and 12.
// Size is an effort denominator and a baseline ordering, never a quality label. Pure: no filesystem, no network.
import ts from 'typescript';
import type { Hunk, MetricValue, RuleVersion, Span } from '../core/types';

export const RULE_VERSION: RuleVersion = 'm1';

/** plan 6.3: `{ value | 'unknown', ruleVersion: 'm1', spans }`. */
export function metricValue<T>(value: T | 'unknown', spans: Span[] = []): MetricValue<T> {
  return { value, ruleVersion: RULE_VERSION, spans };
}

export function unknownValue<T>(spans: Span[] = []): MetricValue<T> {
  return metricValue<T>('unknown', spans);
}

/**
 * docs/METRICS.md section 6 counted statement kinds: variable, expression, return, throw, if, for, for-in, for-of,
 * while, do, switch, try, break, continue, labelled, debugger. Not counted: Block, EmptyStatement, function/class
 * declarations, import/export/interface/type-alias/enum declarations.
 */
const COUNTED_STATEMENT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.DebuggerStatement,
]);

export function isCountedStatement(node: ts.Node): boolean {
  return COUNTED_STATEMENT_KINDS.has(node.kind);
}

/** docs/METRICS.md section 12: per-hunk size. */
export function hunkSize(hunk: Hunk): { atomCount: number; baseAtomCount: number; headAtomCount: number } {
  return { atomCount: hunk.baseCount + hunk.headCount, baseAtomCount: hunk.baseCount, headAtomCount: hunk.headCount };
}
