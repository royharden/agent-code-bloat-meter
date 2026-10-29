// plan D13 / docs/METRICS.md section 9: in-repo token clone scanner (diagnostic and `clone-first` ordering only; no
// tier rule). Head-side `.ts` / `.tsx` files of all roles. Pure: syntax trees only.
import ts from 'typescript';
import { lineOfPos } from '../core/parse';
import type { Span } from '../core/types';

/** D13 thresholds. */
export const CLONE_MIN_TOKENS = 40;
export const CLONE_MIN_LINES = 3;

/** Normalised token classes (negative so they never collide with a SyntaxKind value). */
const ID = -1;
const STR = -2;
const TPL = -3;
const NUM = -4;
const REGEX = -5;
const JSXTEXT = -6;

/** One normalised leaf token. */
export interface CloneToken {
  id: number;
  startLine: number;
  endLine: number;
}

/** docs/METRICS.md section 9 normalisation of one leaf token kind; keywords and punctuation keep their kind. */
export function normaliseTokenKind(kind: ts.SyntaxKind): number {
  switch (kind) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
      return ID;
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return STR;
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
      return TPL;
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
      return NUM;
    case ts.SyntaxKind.RegularExpressionLiteral:
      return REGEX;
    case ts.SyntaxKind.JsxText:
      return JSXTEXT;
    default:
      return kind;
  }
}

function isJsDocNode(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/**
 * Leaf tokens of the parsed tree in source order (the tokens the scanner produced for `createSourceFile`), trivia
 * dropped, end-of-file excluded, whitespace-only JSX text dropped, JSDoc nodes skipped.
 */
export function leafTokens(sourceFile: ts.SourceFile): CloneToken[] {
  const out: CloneToken[] = [];
  const stack: ts.Node[] = [sourceFile];
  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (isJsDocNode(node)) continue;
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as ts.Node);
      continue;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) continue;
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) continue;
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (end <= start) continue;
    out.push({
      id: normaliseTokenKind(node.kind),
      startLine: lineOfPos(sourceFile, start),
      endLine: lineOfPos(sourceFile, Math.max(start, end - 1)),
    });
  }
  return out;
}

/** One occurrence of a clone pair: lines in one head file. */
export interface CloneOccurrence {
  path: string;
  startLine: number;
  endLine: number;
}

/** A pair of equal, non-overlapping, maximal normalised token sequences (>= 40 tokens, each >= 3 lines). */
export interface ClonePair {
  a: CloneOccurrence;
  b: CloneOccurrence;
  tokens: number;
}

const MOD_1 = 1_000_000_007;
const MOD_2 = 998_244_353;

/**
 * Finds clone pairs across the given head files. Algorithm (deterministic): hash every 40-token window that stays
 * inside one file; group equal windows (verified token by token); visit every earlier non-overlapping partner.
 * Each file-pair/offset diagonal's equal run is extended once. Across files the full run is maximal; within one
 * file a run longer than the separation yields every separation-length slice (each is maximal under the
 * non-overlap constraint). Line thresholds are applied to each resulting pair, never used to prune a partner.
 * Canonical file/pair ordering makes results independent of input permutation. Partner enumeration can be
 * quadratic, and repetitive inputs can also have quadratically many genuine pairs; performance remains deferred.
 */
export function findClonePairs(files: readonly { path: string; tokens: readonly CloneToken[] }[]): ClonePair[] {
  files = [...files].sort((a, b) => compareText(a.path, b.path));
  const ids: number[] = [];
  const fileOf: number[] = [];
  const fileStart: number[] = [];
  const fileEnd: number[] = [];
  files.forEach((file, f) => {
    fileStart.push(ids.length);
    for (const t of file.tokens) {
      ids.push(t.id);
      fileOf.push(f);
    }
    fileEnd.push(ids.length);
  });
  const tokenAt = (pos: number): CloneToken => {
    const f = fileOf[pos] as number;
    return (files[f] as { tokens: readonly CloneToken[] }).tokens[pos - (fileStart[f] as number)] as CloneToken;
  };
  const W = CLONE_MIN_TOKENS;

  // Window hash -> positions; then verified equivalence classes.
  const buckets = new Map<string, number[]>();
  for (let f = 0; f < files.length; f++) {
    const end = fileEnd[f] as number;
    for (let p = fileStart[f] as number; p + W <= end; p++) {
      let h1 = 0;
      let h2 = 0;
      for (let k = 0; k < W; k++) {
        const x = (ids[p + k] as number) + 1024;
        h1 = (h1 * 131 + x) % MOD_1;
        h2 = (h2 * 137 + x) % MOD_2;
      }
      const key = `${h1}:${h2}`;
      const list = buckets.get(key);
      if (list === undefined) buckets.set(key, [p]);
      else list.push(p);
    }
  }
  const sameWindow = (p: number, q: number): boolean => {
    for (let k = 0; k < W; k++) if (ids[p + k] !== ids[q + k]) return false;
    return true;
  };
  const classOf = new Map<number, number[]>();
  for (const positions of buckets.values()) {
    if (positions.length < 2) continue;
    const classes: number[][] = [];
    for (const p of positions) {
      const cls = classes.find((c) => sameWindow(c[0] as number, p));
      if (cls === undefined) classes.push([p]);
      else cls.push(p);
    }
    for (const cls of classes) {
      if (cls.length < 2) continue;
      cls.sort((a, b) => a - b);
      for (const p of cls) classOf.set(p, cls);
    }
  }

  const overlaps = (p: number, q: number, len: number): boolean => fileOf[p] === fileOf[q] && Math.abs(q - p) < len;
  const pairs = new Map<string, ClonePair>();
  const diagonalEnd = new Map<string, number>();
  const positions = [...classOf.keys()].sort((a, b) => a - b);
  for (const q of positions) {
    const cls = classOf.get(q) as number[];
    for (let i = cls.indexOf(q) - 1; i >= 0; i--) {
      const p = cls[i] as number;
      if (overlaps(p, q, W)) continue;
      const diagonal = `${fileOf[p]}:${fileOf[q]}:${q - p}`;
      if (q < (diagonalEnd.get(diagonal) ?? -1)) continue;
      let a = p;
      let b = q;
      while (
        a > (fileStart[fileOf[a] as number] as number) &&
        b > (fileStart[fileOf[b] as number] as number) &&
        ids[a - 1] === ids[b - 1]
      ) {
        a--;
        b--;
      }
      let runLength = q - b + W;
      const aEnd = fileEnd[fileOf[a] as number] as number;
      const bEnd = fileEnd[fileOf[b] as number] as number;
      while (a + runLength < aEnd && b + runLength < bEnd && ids[a + runLength] === ids[b + runLength]) runLength++;
      diagonalEnd.set(diagonal, b + runLength);
      const len = fileOf[a] === fileOf[b] ? Math.min(runLength, b - a) : runLength;
      const lastOffset = runLength - len;
      const occ = (start: number): CloneOccurrence => ({
        path: (files[fileOf[start] as number] as { path: string }).path,
        startLine: tokenAt(start).startLine,
        endLine: tokenAt(start + len - 1).endLine,
      });
      for (let offset = 0; offset <= lastOffset; offset++) {
        const occA = occ(a + offset);
        const occB = occ(b + offset);
        if (occA.endLine - occA.startLine + 1 < CLONE_MIN_LINES) continue;
        if (occB.endLine - occB.startLine + 1 < CLONE_MIN_LINES) continue;
        const pair = { a: occA, b: occB, tokens: len };
        pairs.set(JSON.stringify(pair), pair);
      }
    }
  }
  return [...pairs.values()].sort((a, b) => compareOccurrence(a.a, b.a) || compareOccurrence(a.b, b.b) || a.tokens - b.tokens);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareOccurrence(a: CloneOccurrence, b: CloneOccurrence): number {
  return compareText(a.path, b.path) || a.startLine - b.startLine || a.endLine - b.endLine;
}

/** Per-hunk clone value: head atoms on lines covered by an occurrence, and the other occurrences (origins). */
export function cloneHitsForHunk(
  pairs: readonly ClonePair[],
  path: string,
  headLines: ReadonlySet<number>,
): { duplicatedAddedAtoms: number; origins: Span[] } {
  const covered = new Set<number>();
  const origins = new Map<string, Span>();
  const consider = (own: CloneOccurrence, other: CloneOccurrence): void => {
    if (own.path !== path) return;
    let hit = false;
    for (const line of headLines) {
      if (line >= own.startLine && line <= own.endLine) {
        covered.add(line);
        hit = true;
      }
    }
    if (hit) {
      const span: Span = { path: other.path, side: 'head', startLine: other.startLine, endLine: other.endLine };
      origins.set(`${span.path}:${span.startLine}:${span.endLine}`, span);
    }
  };
  for (const pair of pairs) {
    consider(pair.a, pair.b);
    consider(pair.b, pair.a);
  }
  return { duplicatedAddedAtoms: covered.size, origins: [...origins.values()].sort(compareOccurrence) };
}
