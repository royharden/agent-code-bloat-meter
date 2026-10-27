// plan 6.3 Function map / docs/METRICS.md section 3, with the per-function cyclomatic (section 4) and statement-count
// (section 6) totals accumulated in the same walk. Pure: syntax trees only; no filesystem, no network.
import ts from 'typescript';
import { linesHitRange, linesIntersect } from '../core/atoms';
import type { SideLines } from '../core/atoms';
import { linesToSpans, nodeSpan } from '../core/parse';
import type { FileRole, FunctionClass, FunctionRecord, Side, Span } from '../core/types';
import { cyclomaticDelta, isDecisionPoint } from './cyclomatic';
import { isCountedStatement, metricValue, unknownValue } from './size';

export const TOP_NAME = '<top>';

/** One function (or `<top>`) on one side of one file, with its folded totals. */
export interface SideFunction {
  path: string;
  side: Side;
  /** The function node; null for `<top>`. */
  node: ts.Node | null;
  /** Keyed name (`get:x` / `set:x` for accessors, `constructor`, `<top>`); null when anonymous. */
  name: string | null;
  /** Bare name (accessor prefix removed); null when anonymous. */
  bareName: string | null;
  /** Lexical parent chain joined by `/` ('' when empty). */
  chain: string;
  /** `path#chain/name` or `path#name`; null when anonymous. */
  key: string | null;
  isTop: boolean;
  /** getStart()..getEnd() span; null for `<top>`. */
  span: Span | null;
  /** `<top>` only: lines of the module-level statements counted into `<top>`. */
  topLines: Set<number>;
  /** Cyclomatic total (1 + folded decision points); 0 for anonymous functions (they fold into `foldsInto`). */
  cyclomatic: number;
  /** Counted statements (folded); 0 for anonymous functions. */
  statements: number;
  /** Anonymous only: the function its decision points and statements fold into (null inside a class body). */
  foldsInto: SideFunction | null;
}

export interface SideFunctionMap {
  path: string;
  side: Side;
  top: SideFunction;
  /** Every function on this side in source order: `<top>` first, then named and anonymous functions. */
  functions: SideFunction[];
}

type FunctionWithBody =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

/** docs/METRICS.md section 3: functions with a body; overloads, signatures and bodiless members are ignored. */
export function isFunctionWithBody(node: ts.Node): node is FunctionWithBody {
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return true;
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body !== undefined;
  }
  return false;
}

/** Property-name text; computed names other than a string or numeric literal give null (anonymous). */
export function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const e = name.expression;
    if (ts.isStringLiteral(e) || ts.isNumericLiteral(e)) return e.text;
  }
  return null;
}

/** Name of the variable declarator, property assignment or property declaration this expression directly initialises. */
function initialisedName(node: ts.Expression): string | null {
  const parent = node.parent;
  if (parent === undefined) return null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return ts.isIdentifier(parent.name) ? parent.name.text : null;
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return propertyNameText(parent.name);
  if (ts.isPropertyDeclaration(parent) && parent.initializer === node) return propertyNameText(parent.name);
  return null;
}

/** docs/METRICS.md section 3 Name. Returns the keyed name, or null for an anonymous function. */
export function functionNameOf(node: FunctionWithBody): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isMethodDeclaration(node)) return propertyNameText(node.name);
  if (ts.isGetAccessorDeclaration(node)) {
    const n = propertyNameText(node.name);
    return n === null ? null : `get:${n}`;
  }
  if (ts.isSetAccessorDeclaration(node)) {
    const n = propertyNameText(node.name);
    return n === null ? null : `set:${n}`;
  }
  // Function expression or arrow function.
  const fromParent = initialisedName(node);
  if (fromParent !== null) return fromParent;
  const parent = node.parent;
  if (parent !== undefined && ts.isShorthandPropertyAssignment(parent) && parent.objectAssignmentInitializer === node) {
    return parent.name.text;
  }
  if (ts.isFunctionExpression(node) && node.name !== undefined) return node.name.text;
  return null;
}

/** Bare name for docs/METRICS.md section 8: accessors `get:x` / `set:x` -> `x`. */
export function bareNameOf(name: string): string {
  return name.startsWith('get:') || name.startsWith('set:') ? name.slice(4) : name;
}

/** Class declarations/expressions name the chain; a class expression may take the variable name it initialises. */
function classNameOf(node: ts.ClassDeclaration | ts.ClassExpression): string | null {
  if (node.name !== undefined) return node.name.text;
  if (ts.isClassExpression(node)) return initialisedName(node);
  return null;
}

function moduleNameOf(node: ts.ModuleDeclaration): string {
  return node.name.text;
}

export function functionKey(path: string, chain: readonly string[], name: string): string {
  return chain.length === 0 ? `${path}#${name}` : `${path}#${chain.join('/')}/${name}`;
}

/**
 * docs/METRICS.md section 3 `<top>`: a module-level statement is NOT part of `<top>` when it is a named function
 * declaration, a class declaration, or a variable statement whose declarators all initialise a function expression
 * or arrow function.
 */
export function isExcludedTopStatement(statement: ts.Statement): boolean {
  if (ts.isFunctionDeclaration(statement)) return statement.name !== undefined;
  if (ts.isClassDeclaration(statement)) return true;
  if (ts.isVariableStatement(statement)) {
    const declarations = statement.declarationList.declarations;
    return (
      declarations.length > 0 &&
      declarations.every(
        (d) => d.initializer !== undefined && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer)),
      )
    );
  }
  return false;
}

interface Frame {
  node: ts.Node;
  owner: SideFunction | null;
  chain: string[];
}

/**
 * Walks one parsed side (iteratively, so deep expressions cannot overflow the stack) and returns its function map.
 * Owner rules: a named function owns its own decision points and statements; an anonymous function folds into the
 * current owner (`<top>` at module level); inside a class body (outside its member functions) there is no owner, so
 * field initialisers and static blocks count nowhere (docs/METRICS.md section 4: decision points inside a class count
 * only in its functions).
 */
export function collectSideFunctions(sourceFile: ts.SourceFile, path: string, side: Side): SideFunctionMap {
  const topLines = new Set<number>();
  for (const statement of sourceFile.statements) {
    if (isExcludedTopStatement(statement)) continue;
    const span = nodeSpan(statement, sourceFile, path, side);
    for (let line = span.startLine; line <= span.endLine; line++) topLines.add(line);
  }
  const top: SideFunction = {
    path,
    side,
    node: null,
    name: TOP_NAME,
    bareName: TOP_NAME,
    chain: '',
    key: `${path}#${TOP_NAME}`,
    isTop: true,
    span: null,
    topLines,
    cyclomatic: 1,
    statements: 0,
    foldsInto: null,
  };
  const functions: SideFunction[] = [top];

  const stack: Frame[] = [];
  for (let i = sourceFile.statements.length - 1; i >= 0; i--) {
    stack.push({ node: sourceFile.statements[i] as ts.Statement, owner: top, chain: [] });
  }
  while (stack.length > 0) {
    const { node, owner, chain } = stack.pop() as Frame;
    let childOwner = owner;
    let childChain = chain;

    if (isFunctionWithBody(node)) {
      const name = functionNameOf(node);
      const expressionBody = ts.isArrowFunction(node) && !ts.isBlock(node.body);
      if (name !== null) {
        const fn: SideFunction = {
          path,
          side,
          node,
          name,
          bareName: bareNameOf(name),
          chain: chain.join('/'),
          key: functionKey(path, chain, name),
          isTop: false,
          span: nodeSpan(node, sourceFile, path, side),
          topLines: new Set<number>(),
          cyclomatic: 1,
          statements: expressionBody ? 1 : 0,
          foldsInto: null,
        };
        functions.push(fn);
        childOwner = fn;
        childChain = [...chain, name];
      } else {
        functions.push({
          path,
          side,
          node,
          name: null,
          bareName: null,
          chain: chain.join('/'),
          key: null,
          isTop: false,
          span: nodeSpan(node, sourceFile, path, side),
          topLines: new Set<number>(),
          cyclomatic: 0,
          statements: 0,
          foldsInto: owner,
        });
        // An expression-bodied arrow counts 1, also when folded into its parent.
        if (expressionBody && owner !== null) owner.statements += 1;
      }
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const className = classNameOf(node);
      childOwner = null;
      if (className !== null) childChain = [...chain, className];
    } else if (ts.isObjectLiteralExpression(node)) {
      const objectName = initialisedName(node);
      if (objectName !== null) childChain = [...chain, objectName];
    } else if (ts.isModuleDeclaration(node)) {
      childChain = [...chain, moduleNameOf(node)];
    }

    if (owner !== null) {
      if (isDecisionPoint(node)) owner.cyclomatic += 1;
      if (isCountedStatement(node)) {
        const excludedFromTop =
          owner.isTop && node.parent === sourceFile && isExcludedTopStatement(node as ts.Statement);
        if (!excludedFromTop) owner.statements += 1;
      }
    }

    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i] as ts.Node, owner: childOwner, chain: childChain });
    }
  }

  functions.sort((a, b) => (a.isTop ? -1 : b.isTop ? 1 : (a.node?.pos ?? 0) - (b.node?.pos ?? 0)));
  return { path, side, top, functions };
}

/** True when a side function's lines (span, or `<top>` lines) contain any of `lines`. */
export function sideFunctionHits(fn: SideFunction | null, lines: ReadonlySet<number>): boolean {
  if (fn === null || lines.size === 0) return false;
  if (fn.isTop) return linesIntersect(fn.topLines, lines);
  return fn.span !== null && linesHitRange(lines, fn.span.startLine, fn.span.endLine);
}

/** Spans of a side function: its span, or `<top>`'s contiguous line runs. */
export function sideFunctionSpans(fn: SideFunction | null): Span[] {
  if (fn === null) return [];
  if (fn.isTop) return linesToSpans(fn.path, fn.side, fn.topLines);
  return fn.span === null ? [] : [fn.span];
}

/** A function-map entry: the public record plus the side functions it was built from. */
export interface FunctionEntry {
  record: FunctionRecord;
  base: SideFunction | null;
  head: SideFunction | null;
}

/** True when the entry's base side hits a base line or its head side hits a head line. */
export function entryHits(entry: FunctionEntry, lines: SideLines): boolean {
  return sideFunctionHits(entry.base, lines.base) || sideFunctionHits(entry.head, lines.head);
}

function makeEntry(
  role: FileRole,
  cls: FunctionClass,
  base: SideFunction | null,
  head: SideFunction | null,
  fileLines: SideLines,
): FunctionEntry {
  const fn = (head ?? base) as SideFunction;
  const baseSpans = sideFunctionSpans(base);
  const headSpans = sideFunctionSpans(head);
  const changed = sideFunctionHits(base, fileLines.base) || sideFunctionHits(head, fileLines.head);
  const anonymous = cls === 'anonymous';
  const record: FunctionRecord = {
    key: fn.key,
    path: fn.path,
    role,
    name: fn.name,
    chain: fn.chain,
    isTop: fn.isTop,
    class: cls,
    baseSpan: base?.span ?? null,
    headSpan: head?.span ?? null,
    changed,
    changeKind: changed ? (cls === 'matched' ? 'modified' : cls === 'new' ? 'added' : null) : null,
    cyclomaticBase:
      base === null ? null : anonymous ? unknownValue<number>(baseSpans) : metricValue(base.cyclomatic, baseSpans),
    cyclomaticHead:
      head === null ? null : anonymous ? unknownValue<number>(headSpans) : metricValue(head.cyclomatic, headSpans),
    cyclomaticDelta: anonymous
      ? unknownValue<number>([...baseSpans, ...headSpans])
      : cyclomaticDelta(cls, base?.cyclomatic ?? null, head?.cyclomatic ?? null, [...baseSpans, ...headSpans]),
    statementCount:
      head === null || anonymous ? unknownValue<number>(headSpans) : metricValue(head.statements, headSpans),
    // Filled by testref.ts (docs/METRICS.md section 8); 'unknown' until then.
    noChangedTestReference: unknownValue<boolean>(),
  };
  if (fn.isTop) {
    record.topLines = {
      base: base === null ? [] : [...base.topLines].sort((a, b) => a - b),
      head: head === null ? [] : [...head.topLines].sort((a, b) => a - b),
    };
  }
  return { record, base, head };
}

function groupByKey(map: SideFunctionMap | null): Map<string, SideFunction[]> {
  const out = new Map<string, SideFunction[]>();
  if (map === null) return out;
  for (const fn of map.functions) {
    if (fn.isTop || fn.key === null) continue;
    const list = out.get(fn.key);
    if (list === undefined) out.set(fn.key, [fn]);
    else list.push(fn);
  }
  return out;
}

/**
 * docs/METRICS.md section 3 classes, per file: `<top>` matched by path (new / deleted for an added / deleted file);
 * a key exactly once on both sides is matched, only on head new, only on base deleted; a key occurring twice on a
 * side is ambiguous (every occurrence of that key, on both sides); unnamed functions are anonymous.
 * `fileLines` are the file's changed lines per side (for `changed`).
 */
export function buildFunctionEntries(
  role: FileRole,
  baseMap: SideFunctionMap | null,
  headMap: SideFunctionMap | null,
  fileLines: SideLines,
): FunctionEntry[] {
  const entries: FunctionEntry[] = [];
  const baseTop = baseMap?.top ?? null;
  const headTop = headMap?.top ?? null;
  if (baseTop !== null || headTop !== null) {
    const cls: FunctionClass = baseTop !== null && headTop !== null ? 'matched' : headTop !== null ? 'new' : 'deleted';
    entries.push(makeEntry(role, cls, baseTop, headTop, fileLines));
  }

  const baseByKey = groupByKey(baseMap);
  const headByKey = groupByKey(headMap);
  const keys = [...headByKey.keys(), ...[...baseByKey.keys()].filter((k) => !headByKey.has(k))];
  for (const key of keys) {
    const b = baseByKey.get(key) ?? [];
    const h = headByKey.get(key) ?? [];
    if (b.length > 1 || h.length > 1) {
      for (const fn of b) entries.push(makeEntry(role, 'ambiguous', fn, null, fileLines));
      for (const fn of h) entries.push(makeEntry(role, 'ambiguous', null, fn, fileLines));
    } else if (b.length === 1 && h.length === 1) {
      entries.push(makeEntry(role, 'matched', b[0] as SideFunction, h[0] as SideFunction, fileLines));
    } else if (h.length === 1) {
      entries.push(makeEntry(role, 'new', null, h[0] as SideFunction, fileLines));
    } else if (b.length === 1) {
      entries.push(makeEntry(role, 'deleted', b[0] as SideFunction, null, fileLines));
    }
  }

  for (const map of [baseMap, headMap]) {
    if (map === null) continue;
    for (const fn of map.functions) {
      if (fn.isTop || fn.key !== null) continue;
      entries.push(
        makeEntry(role, 'anonymous', map.side === 'base' ? fn : null, map.side === 'head' ? fn : null, fileLines),
      );
    }
  }
  return entries;
}
