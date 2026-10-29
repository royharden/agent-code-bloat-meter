// plan 6.3 Changed catch / docs/METRICS.md section 7: `catch_may_swallow` ("may be intentional"). Production files only,
// head side only. Pure: syntax trees only.
import ts from 'typescript';
import { linesHitRange } from '../core/atoms';
import { nodeSpan } from '../core/parse';
import type { Span } from '../core/types';

/** docs/METRICS.md section 7: callee identifiers (or property-access objects) treated as logging. */
export const LOGGER_NAMES: readonly string[] = Object.freeze([
  'log',
  'logger',
  'logError',
  'warn',
  'report',
  'reportError',
  'track',
  'telemetry',
]);

const LOGGER_SET: ReadonlySet<string> = new Set(LOGGER_NAMES);

/** A call statement counts as logging when its callee is `console.*`, a logger name, or `<logger name>.*`. */
function isLoggingCallStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const callee = statement.expression.expression;
  if (ts.isIdentifier(callee)) return LOGGER_SET.has(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const object = callee.expression.text;
    return object === 'console' || LOGGER_SET.has(object);
  }
  return false;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** No `throw`, no `return`, no assignment (`=`, compound, `++`/`--`) anywhere inside the block. */
function blockHasEscapeOrAssignment(block: ts.Block): boolean {
  const stack: ts.Node[] = [block];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (ts.isThrowStatement(node) || ts.isReturnStatement(node)) return true;
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) return true;
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return true;
    }
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return false;
}

/** docs/METRICS.md section 7 predicate on one catch clause (independent of the diff). */
export function catchMaySwallow(clause: ts.CatchClause): boolean {
  const statements = clause.block.statements;
  if (!statements.every(isLoggingCallStatement)) return false;
  return !blockHasEscapeOrAssignment(clause.block);
}

/** Every head-side catch clause that satisfies the predicate, with its clause span. */
export function findSwallowingCatches(sourceFile: ts.SourceFile, path: string): Span[] {
  const spans: Span[] = [];
  const stack: ts.Node[] = [sourceFile];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (ts.isCatchClause(node) && catchMaySwallow(node)) spans.push(nodeSpan(node, sourceFile, path, 'head'));
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return spans.sort((a, b) => a.startLine - b.startLine);
}

/**
 * The flag applies to every hunk with a head atom inside a flagged clause span (such a clause then intersects a head
 * atom of the change). Returns the flagged clause spans hit by the hunk's head lines.
 */
export function swallowingCatchesHit(catchSpans: readonly Span[], headLines: ReadonlySet<number>): Span[] {
  return catchSpans.filter((s) => linesHitRange(headLines, s.startLine, s.endLine));
}
