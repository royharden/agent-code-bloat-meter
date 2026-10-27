// plan 6.3 Cyclomatic / docs/METRICS.md sections 4-5. Decision points are counted per owning function by the walk in
// functions.ts (anonymous functions fold into the nearest named enclosing function, else `<top>`). Pure.
import ts from 'typescript';
import type { FunctionClass, MetricValue, Span } from '../core/types';
import { metricValue, unknownValue } from './size';

/** Binary / logical-assignment operators that add one decision point each. */
const LOGICAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/**
 * docs/METRICS.md section 4: +1 per `if`, `for`, `for-in`, `for-of`, `while`, `do`, conditional expression, non-default
 * `case`, `catch`, and each binary `&&`, `||`, `??`, `&&=`, `||=`, `??=`. TSX markup, `?.`, default values, `else`,
 * type-level conditionals and `default:` add nothing.
 */
export function isDecisionPoint(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.CatchClause:
      return true;
    case ts.SyntaxKind.BinaryExpression:
      return LOGICAL_OPERATORS.has((node as ts.BinaryExpression).operatorToken.kind);
    default:
      return false;
  }
}

/**
 * docs/METRICS.md section 4 delta: matched head - base; new head - 1; deleted, anonymous and ambiguous 'unknown'
 * (deleted functions are not used for growth).
 */
export function cyclomaticDelta(
  cls: FunctionClass,
  base: number | null,
  head: number | null,
  spans: Span[],
): MetricValue<number> {
  if (cls === 'matched' && base !== null && head !== null) return metricValue(head - base, spans);
  if (cls === 'new' && head !== null) return metricValue(head - 1, spans);
  return unknownValue<number>(spans);
}
