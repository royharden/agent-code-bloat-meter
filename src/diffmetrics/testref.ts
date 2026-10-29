// plan D6 / 6.3 / docs/METRICS.md section 8: `no_changed_test_reference`. A reference is only a name occurrence in the
// head syntax tree of a test file the change adds or modifies; unchanged tests are not scanned (trap N7 by design).
// Pure: syntax trees only.
import ts from 'typescript';
import { nodeSpan } from '../core/parse';
import type { MetricValue, Span } from '../core/types';
import type { FunctionEntry, SideFunction } from './functions';
import { metricValue, unknownValue } from './size';

export interface TestReferenceContext {
  /**
   * True when uniqueness or references cannot be established: a production file failed to parse on its head side
   * (its function names are unknown) or a scanned test file failed to parse on its head side. Every value is then
   * 'unknown'.
   */
  blocked: boolean;
  /** Bare-name occurrence counts over all head-side named production functions of the change (all files). */
  bareNameCounts: Map<string, number>;
  /** Identifier text -> spans of its occurrences in the head trees of added or modified test files. */
  references: Map<string, Span[]>;
}

/** Collects every `Identifier` node of one test head tree, in source order. */
export function collectIdentifiers(sourceFile: ts.SourceFile, path: string, into: Map<string, Span[]>): void {
  const stack: ts.Node[] = [sourceFile];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (ts.isIdentifier(node)) {
      const span = nodeSpan(node, sourceFile, path, 'head');
      const list = into.get(node.text);
      if (list === undefined) into.set(node.text, [span]);
      else list.push(span);
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as ts.Node);
  }
}

/**
 * @param productionHeadFunctions every head-side function of every parsed production file (all files of the change)
 * @param changedTestHeads head trees of the test files the change adds or modifies
 * @param blocked see TestReferenceContext.blocked
 */
export function buildTestReferenceContext(
  productionHeadFunctions: readonly SideFunction[],
  changedTestHeads: readonly { path: string; sourceFile: ts.SourceFile }[],
  blocked: boolean,
): TestReferenceContext {
  const bareNameCounts = new Map<string, number>();
  for (const fn of productionHeadFunctions) {
    if (fn.isTop || fn.bareName === null) continue;
    bareNameCounts.set(fn.bareName, (bareNameCounts.get(fn.bareName) ?? 0) + 1);
  }
  const references = new Map<string, Span[]>();
  if (!blocked) {
    for (const test of changedTestHeads) collectIdentifiers(test.sourceFile, test.path, references);
  }
  return { blocked, bareNameCounts, references };
}

/**
 * Defined for a changed (modified or added) production function whose bare name is unique among head-side production
 * functions: true when no test identifier has that text, false when one does (spans: the identifiers). 'unknown' for
 * `<top>`, anonymous, ambiguous, deleted, unchanged, non-production and non-unique functions.
 */
export function testReferenceValue(entry: FunctionEntry, ctx: TestReferenceContext): MetricValue<boolean> {
  const r = entry.record;
  if (ctx.blocked) return unknownValue<boolean>();
  if (r.role !== 'production' || r.isTop || !r.changed) return unknownValue<boolean>();
  if (r.class !== 'matched' && r.class !== 'new') return unknownValue<boolean>();
  const bare = entry.head?.bareName ?? null;
  if (bare === null || (ctx.bareNameCounts.get(bare) ?? 0) !== 1) return unknownValue<boolean>();
  const refs = ctx.references.get(bare);
  return refs === undefined || refs.length === 0 ? metricValue(true) : metricValue(false, refs);
}
