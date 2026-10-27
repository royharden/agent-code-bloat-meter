// Normal mode ONLY. Independent exhaustive token-start/length enumeration; bounded engineering inputs only.
// Command: npx tsx scripts/clone-reference-check.ts
import assert from 'node:assert/strict';
import { CLONE_MIN_LINES, CLONE_MIN_TOKENS, cloneHitsForHunk, findClonePairs } from '../src/diffmetrics/clones';
import type { CloneOccurrence, ClonePair, CloneToken } from '../src/diffmetrics/clones';

interface File { path: string; tokens: CloneToken[] }

function reference(files: File[]): ClonePair[] {
  const pairs = new Map<string, ClonePair>();
  for (let f = 0; f < files.length; f++) for (let g = f; g < files.length; g++) {
    const left = files[f]!;
    const right = files[g]!;
    for (let p = 0; p + CLONE_MIN_TOKENS <= left.tokens.length; p++) {
      for (let q = f === g ? p + CLONE_MIN_TOKENS : 0; q + CLONE_MIN_TOKENS <= right.tokens.length; q++) {
        const max = Math.min(left.tokens.length - p, right.tokens.length - q, f === g ? q - p : Infinity);
        for (let len = CLONE_MIN_TOKENS; len <= max; len++) {
          if (!Array.from({ length: len }, (_, k) => left.tokens[p + k]!.id === right.tokens[q + k]!.id).every(Boolean)) break;
          const overlapOnExtension = f === g && len === q - p;
          const extendsLeft = !overlapOnExtension && p > 0 && q > 0 && left.tokens[p - 1]!.id === right.tokens[q - 1]!.id;
          const extendsRight = !overlapOnExtension && p + len < left.tokens.length && q + len < right.tokens.length && left.tokens[p + len]!.id === right.tokens[q + len]!.id;
          if (extendsLeft || extendsRight) continue;
          const occurrence = (file: File, start: number): CloneOccurrence => ({ path: file.path, startLine: file.tokens[start]!.startLine, endLine: file.tokens[start + len - 1]!.endLine });
          const a = occurrence(left, p);
          const b = occurrence(right, q);
          if (a.endLine - a.startLine + 1 < CLONE_MIN_LINES || b.endLine - b.startLine + 1 < CLONE_MIN_LINES) continue;
          const pair = { a, b, tokens: len };
          pairs.set(JSON.stringify(pair), pair);
        }
      }
    }
  }
  return [...pairs.values()];
}

const make = (path: string, ids: number[], oneLine = false): File => ({ path, tokens: ids.map((id, i) => ({ id, startLine: oneLine ? 1 : i + 1, endLine: oneLine ? 1 : i + 1 })) });
const unique = Array.from({ length: 45 }, (_, i) => i + 1);
const cases: File[][] = [
  [make('a.ts', unique), make('b.ts', unique, true), make('c.ts', unique)],
  [make('a.ts', unique.slice(0, 39)), make('b.ts', unique.slice(0, 39))],
  [make('a.ts', [...unique, ...unique, ...unique])],
  [make('a.ts', Array(84).fill(1))],
  [make('a.ts', unique), make('b.ts', [...unique.slice(0, 22), -10, ...unique.slice(23)])],
];
// Exhaust every 3-bit prefix in both files around a long common anchor: collisions, boundaries and two disjoint runs.
for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
  const prefix = (n: number) => [n & 1, (n >> 1) & 1, (n >> 2) & 1];
  cases.push([make('a.ts', [...prefix(a), ...unique, ...prefix(b)]), make('b.ts', [...prefix(b), ...unique, ...prefix(a)])]);
}
const keys = (pairs: ClonePair[]) => pairs.map((p) => JSON.stringify(p)).sort();
for (const [index, files] of cases.entries()) {
  const expected = reference(files);
  const actual = findClonePairs(files);
  assert.deepEqual(keys(actual), keys(expected), `pair completeness case ${index}`);
  assert.deepEqual(findClonePairs([...files].reverse()), actual, `permutation case ${index}`);
  for (const file of files) {
    const lines = new Set(file.tokens.map((t) => t.startLine));
    assert.deepEqual(cloneHitsForHunk(actual, file.path, lines), cloneHitsForHunk(expected, file.path, lines), `coverage/origins case ${index} ${file.path}`);
  }
}
console.log(JSON.stringify({ check: 'exhaustive-clone-reference', cases: cases.length, status: 'pass', studyData: false }));
