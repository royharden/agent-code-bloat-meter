// Normal mode ONLY. Bounded engineering checks, no study authorship. Prints differences, never writes data.
// Commands: npx tsx scripts/scanner-crosscheck.ts --engineering
// Optional admitted dev input: npx tsx scripts/scanner-crosscheck.ts --change corpus/dev/inputs/change.json
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import ts from 'typescript';
import { hunkLineSets } from '../src/core/atoms';
import { normaliseText, sourceKindOf } from '../src/core/change';
import { lineOfPos, parseSide } from '../src/core/parse';
import type { ScannedToken } from '../src/core/parse';
import { assertAcceptable } from '../src/core/safety';
import type { ChangeV1 } from '../src/core/types';
import { analyze } from '../src/diffmetrics/index';

function astTokens(sourceFile: ts.SourceFile): ScannedToken[] {
  const out: ScannedToken[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sourceFile);
    if (children.length > 0) { children.forEach(visit); return; }
    if (node.kind === ts.SyntaxKind.EndOfFileToken || node.kind === ts.SyntaxKind.SyntaxList) return;
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) return;
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (end <= start) return;
    out.push({ kind: node.kind, text: sourceFile.text.slice(start, end), startLine: lineOfPos(sourceFile, start), endLine: lineOfPos(sourceFile, end - 1) });
  };
  visit(sourceFile);
  return out;
}

function compare(change: ChangeV1): { hunks: number; differences: unknown[]; skipped: unknown[] } {
  assertAcceptable(change);
  const analysis = analyze(change);
  const differences: unknown[] = [];
  const skipped: unknown[] = [];
  for (const hunk of analysis.hunks) {
    const file = change.files.find((f) => f.path === hunk.path)!;
    const kind = sourceKindOf(file.path);
    if (kind === null) continue;
    const lineSets = hunkLineSets(hunk);
    const seq: Record<'base' | 'head', ScannedToken[]> = { base: [], head: [] };
    let failed = false;
    for (const side of ['base', 'head'] as const) {
      if (file[side] === null) continue;
      const parsed = parseSide(file.path, side, kind, normaliseText(file[side]!));
      if (parsed.failed) { failed = true; break; }
      // Exact token kind + raw text, NOT clone-normalised IDs/literals. AST leaves omit all comment trivia,
      // including entire multiline comments; tokens spanning changed lines are retained once in source order.
      seq[side] = astTokens(parsed.sourceFile).filter((t) => [...lineSets[side]].some((l) => l >= t.startLine && l <= t.endLine));
    }
    if (failed) { skipped.push({ changeId: change.id, hunkId: hunk.id, reason: 'parse_failure' }); continue; }
    const t0a = seq.base.length === 0 && seq.head.length === 0;
    const t0b = seq.base.length === seq.head.length && seq.base.every((t, i) => t.kind === seq.head[i]!.kind && t.text === seq.head[i]!.text);
    const actual = analysis.metrics.find((m) => m.hunkId === hunk.id)!;
    if (t0a !== actual.t0aTriviaOnly || t0b !== actual.t0bTokenEqual) {
      differences.push({ changeId: change.id, path: file.path, hunkId: hunk.id, scanner: { t0a: actual.t0aTriviaOnly, t0b: actual.t0bTokenEqual }, ast: { t0a, t0b } });
    }
  }
  return { hunks: analysis.hunks.length, differences, skipped };
}

function engineering(): ChangeV1[] {
  const pairs = [
    ['a.ts', 'const value = 1;\n', ' const value = 1; // kept\n'],
    ['b.ts', '/* comment\n old\n */\nconst value = 1;\n', '/* comment\n new\n */\nconst value = 1;\n'],
    ['c.ts', 'const t = `hello ${name} done`;\n', 'const t = `hello ${name} done`; // comment\n'],
    ['d.ts', 'if (ok) /a b/.test(value);\n', 'if (ok) /a  b/.test(value);\n'],
    ['e.tsx', 'const el = <p>Hello world</p>;\n', 'const el = <p>Hello  world</p>;\n'],
  ];
  return pairs.map(([path, base, head], i) => ({ schema: 's45.change/1', id: `engineering-scanner-${i}`, files: [{ path: path!, base: base!, head: head! }] }));
}

const args = process.argv.slice(2);
let inputs: ChangeV1[];
if (args.length === 1 && args[0] === '--engineering') inputs = engineering();
else if (args.length === 2 && args[0] === '--change') {
  const filename = realpathSync(resolve(args[1]!));
  // Explicit source input only. No directory crawl, labels, sealed data, private lanes or default corpus reads.
  if (filename.split(/[\\/]/).some((s) => /^(sealed|heldout|labels|\.thinking|\.creds)$/i.test(s) || s.startsWith(','))) throw new Error('restricted source path');
  if (!filename.endsWith('.json') || statSync(filename).size > 32 * 1024 * 1024) throw new Error('expected ChangeV1 JSON <= 32 MiB');
  if (!filename.startsWith(resolve('.') + sep)) throw new Error('source input must be inside the current repo');
  inputs = [JSON.parse(readFileSync(filename, 'utf8')) as ChangeV1];
} else throw new Error('usage: scanner-crosscheck.ts --engineering | --change <explicit-admitted-dev-ChangeV1.json>');
const report = inputs.map((input) => ({ changeId: input.id, ...compare(input) }));
console.log(JSON.stringify({ check: 'scanner-vs-exact-AST-leaves', report }, null, 2));
if (report.some((r) => r.differences.length > 0 || r.skipped.length > 0)) process.exitCode = 1;
