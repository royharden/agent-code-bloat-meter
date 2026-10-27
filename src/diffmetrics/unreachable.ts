// plan D14 / docs/METRICS.md section 10: unreachable-statement diagnostic (never a tier rule). Syntactic only: a
// statement after an unconditional `return` / `throw` in the same statement list. Pure: syntax trees only.
import ts from 'typescript';
import { linesHitRange } from '../core/atoms';
import { nodeSpan } from '../core/parse';
import type { Span } from '../core/types';

/** Hoisted or effect-free declarations are exempt. */
function isExempt(statement: ts.Statement): boolean {
  return (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  );
}

function statementListOf(node: ts.Node): readonly ts.Statement[] | null {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) return node.statements;
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements;
  return null;
}

/**
 * Head-side unreachable statements: in each statement list (source file, block, module block, case/default clause),
 * a non-exempt statement immediately following a `return` or `throw`. Exempt declarations/empty statements are
 * still list entries: they do not carry adjacency across to a later statement.
 */
export function findUnreachableStatements(sourceFile: ts.SourceFile, path: string): Span[] {
  const spans: Span[] = [];
  const stack: ts.Node[] = [sourceFile];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    const list = statementListOf(node);
    if (list !== null) {
      let previousExited = false;
      for (const statement of list) {
        if (previousExited && !isExempt(statement)) spans.push(nodeSpan(statement, sourceFile, path, 'head'));
        previousExited = ts.isReturnStatement(statement) || ts.isThrowStatement(statement);
      }
    }
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return spans.sort((a, b) => a.startLine - b.startLine);
}

/** Unreachable statements whose span intersects a head atom of the hunk. */
export function unreachableHit(spans: readonly Span[], headLines: ReadonlySet<number>): Span[] {
  return spans.filter((s) => linesHitRange(headLines, s.startLine, s.endLine));
}
