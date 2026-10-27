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
 * inside one file; group equal windows (verified token by token); for each window position q in ascending order,
 * pair it with the nearest earlier equal window p that does not overlap it, extend the pair left and right to
 * maximal length, truncate so the two occurrences do not overlap, and keep the pair when both occurrences span at
 * least 3 lines. A window starting inside the later occurrence of the previous pair on the same diagonal is skipped.
 * Only the nearest earlier partner is tried, so a window whose nearest pair spans fewer than 3 lines is not retried
 * with a farther partner (implementation bound, disclosed in docs/DEFERRED-VALIDATION.md DV-M3-08).
 */
export function findClonePairs(files: readonly { path: string; tokens: readonly CloneToken[] }[]): ClonePair[] {
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
  const pairs: ClonePair[] = [];
  const diagonalEnd = new Map<number, number>();
  const positions = [...classOf.keys()].sort((a, b) => a - b);
  for (const q of positions) {
    const cls = classOf.get(q) as number[];
    let p = -1;
    for (let i = cls.indexOf(q) - 1; i >= 0; i--) {
      const candidate = cls[i] as number;
      if (!overlaps(candidate, q, W)) {
        p = candidate;
        break;
      }
    }
    if (p < 0) continue;
    const diagonal = q - p;
    // The later occurrence of the last pair on this diagonal ends at `previousEnd`; windows starting before it are
    // already inside that occurrence, and the left extension never reaches back into it (this keeps periodic
    // repeats X X X as the pairs (1, 2) and (2, 3) instead of re-deriving (1, 2)).
    const previousEnd = diagonalEnd.get(diagonal) ?? -1;
    if (q < previousEnd) continue;
    let a = p;
    let b = q;
    while (
      a > (fileStart[fileOf[a] as number] as number) &&
      b > Math.max(fileStart[fileOf[b] as number] as number, previousEnd) &&
      ids[a - 1] === ids[b - 1]
    ) {
      a--;
      b--;
    }
    let len = q - b + W;
    const aEnd = fileEnd[fileOf[a] as number] as number;
    const bEnd = fileEnd[fileOf[b] as number] as number;
    while (a + len < aEnd && b + len < bEnd && ids[a + len] === ids[b + len]) len++;
    // Same file: the two occurrences must not overlap (b - a = q - p >= W, so len stays >= W).
    if (fileOf[a] === fileOf[b] && a + len > b) len = b - a;
    diagonalEnd.set(diagonal, b + len);
    if (len < W) continue;
    const occ = (start: number): CloneOccurrence => ({
      path: (files[fileOf[start] as number] as { path: string }).path,
      startLine: tokenAt(start).startLine,
      endLine: tokenAt(start + len - 1).endLine,
    });
    const occA = occ(a);
    const occB = occ(b);
    if (occA.endLine - occA.startLine + 1 < CLONE_MIN_LINES) continue;
    if (occB.endLine - occB.startLine + 1 < CLONE_MIN_LINES) continue;
    pairs.push({ a: occA, b: occB, tokens: len });
  }
  return pairs;
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
  return { duplicatedAddedAtoms: covered.size, origins: [...origins.values()] };
}
