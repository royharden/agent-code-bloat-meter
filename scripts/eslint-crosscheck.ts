// plan D32 / docs/METRICS.md section 14: Normal-mode ONLY cross-check of the m1 cyclomatic count against ESLint core
// `complexity`. Never run in Dirty Mode. Runs after Gate 1 on dev inputs; lists every disagreement, asserts none.
//
// Usage: `npx tsx scripts/eslint-crosscheck.ts <change.json>...` or `npx tsx scripts/eslint-crosscheck.ts --dir <dir>`
// (every `*.json` ChangeV1 in <dir>). Prints a Markdown report to stdout; writes no files; no network.
//
// Method. ESLint core cannot parse TypeScript, so each side is first turned into JavaScript with Node's
// `module.stripTypeScriptTypes(code, { mode: 'strip' })` (Node >= 22.13), which blanks types with whitespace and keeps
// every line and column. `.tsx` sides and sides with non-erasable syntax (enum, namespace, parameter properties) are
// reported as "not cross-checked". ESLint is run with `complexity: ['error', { max: 0 }]` so every function is
// reported, and its units are matched to m1 functions by the line of the function head (the `=>` token for arrows,
// the node start otherwise). m1 folds anonymous functions into their nearest named function, ESLint does not, so the
// comparison value for a named function f is eslint(f) + sum over anonymous a folded into f of (eslint(a) - 1).
// `<top>` and class-field units have no counterpart and are listed separately. Known rule differences (default
// parameter values, optional chaining, class field initialisers in some ESLint versions) show up as disagreements
// and are recorded by rule in docs/METRICS.md section 14 after the run.
import { readdirSync, readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { join } from 'node:path';
import { Linter } from 'eslint';
import ts from 'typescript';
import { normaliseText, sidePresent, sourceKindOf } from '../src/core/change';
import { parseSide } from '../src/core/parse';
import { assertAcceptable } from '../src/core/safety';
import type { ChangeV1, Side } from '../src/core/types';
import { collectSideFunctions } from '../src/diffmetrics/functions';
import type { SideFunction } from '../src/diffmetrics/functions';

type StripFn = (code: string, options?: { mode?: 'strip' | 'transform' }) => string;

export interface CrosscheckRow {
  changeId: string;
  path: string;
  side: Side;
  key: string;
  m1: number;
  eslint: number | null;
  status: 'agree' | 'disagree' | 'unmatched';
}

export interface CrosscheckSkip {
  changeId: string;
  path: string;
  side: Side;
  reason: string;
}

function stripper(): StripFn {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: StripFn }).stripTypeScriptTypes;
  if (strip === undefined) throw new Error('module.stripTypeScriptTypes is unavailable: run with Node >= 22.13');
  return strip;
}

function headLine(fn: SideFunction, sourceFile: ts.SourceFile): number | null {
  const node = fn.node;
  if (node === null) return null;
  const pos = ts.isArrowFunction(node) ? node.equalsGreaterThanToken.getStart(sourceFile) : node.getStart(sourceFile);
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** ESLint complexity per function-head line (several units on one line are kept apart). */
function eslintUnits(linter: Linter, js: string): Map<number, number[]> {
  const messages = linter.verify(
    js,
    [
      {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { complexity: ['error', { max: 0 }] },
      },
    ],
    { filename: 'crosscheck.js' },
  );
  const byLine = new Map<number, number[]>();
  for (const m of messages) {
    if (m.ruleId !== 'complexity') continue;
    const match = /complexity of (\d+)/.exec(m.message);
    if (match === null) continue;
    const list = byLine.get(m.line) ?? [];
    list.push(Number.parseInt(match[1] as string, 10));
    byLine.set(m.line, list);
  }
  return byLine;
}

export function crosscheckChange(
  change: ChangeV1,
  linter: Linter,
  strip: StripFn,
): { rows: CrosscheckRow[]; skips: CrosscheckSkip[]; eslintOnly: { path: string; side: Side; line: number }[] } {
  const rows: CrosscheckRow[] = [];
  const skips: CrosscheckSkip[] = [];
  const eslintOnly: { path: string; side: Side; line: number }[] = [];
  for (const file of change.files) {
    const kind = sourceKindOf(file.path);
    if (kind === null) continue;
    for (const side of ['base', 'head'] as const) {
      const text = file[side];
      if (!sidePresent(text)) continue;
      const skip = (reason: string): void => {
        skips.push({ changeId: change.id, path: file.path, side, reason });
      };
      if (kind === 'tsx') {
        skip('tsx: stripTypeScriptTypes does not support JSX');
        continue;
      }
      const textLF = normaliseText(text);
      const parsed = parseSide(file.path, side, kind, textLF);
      if (parsed.failed) {
        skip('parse failure (D35)');
        continue;
      }
      let js: string;
      try {
        js = strip(textLF, { mode: 'strip' });
      } catch (error) {
        skip(`strip failed: ${(error as Error).message}`);
        continue;
      }
      const units = eslintUnits(linter, js);
      const map = collectSideFunctions(parsed.sourceFile, file.path, side);
      const oursByLine = new Map<number, SideFunction[]>();
      for (const fn of map.functions) {
        const line = headLine(fn, parsed.sourceFile);
        if (line === null) continue;
        oursByLine.set(line, [...(oursByLine.get(line) ?? []), fn]);
      }
      const eslintOf = new Map<SideFunction, number>();
      for (const [line, fns] of oursByLine) {
        const values = units.get(line) ?? [];
        if (fns.length === 1 && values.length === 1) eslintOf.set(fns[0] as SideFunction, values[0] as number);
      }
      for (const line of units.keys()) {
        if (!oursByLine.has(line)) eslintOnly.push({ path: file.path, side, line });
      }
      for (const fn of map.functions) {
        if (fn.isTop || fn.key === null) continue;
        const folded = map.functions.filter((a) => a.key === null && a.foldsInto === fn);
        const own = eslintOf.get(fn);
        const parts = folded.map((a) => eslintOf.get(a));
        if (own === undefined || parts.some((p) => p === undefined)) {
          rows.push({ changeId: change.id, path: file.path, side, key: fn.key, m1: fn.cyclomatic, eslint: null, status: 'unmatched' });
          continue;
        }
        const expected = own + parts.reduce<number>((sum, p) => sum + ((p as number) - 1), 0);
        rows.push({
          changeId: change.id,
          path: file.path,
          side,
          key: fn.key,
          m1: fn.cyclomatic,
          eslint: expected,
          status: expected === fn.cyclomatic ? 'agree' : 'disagree',
        });
      }
    }
  }
  return { rows, skips, eslintOnly };
}

function inputPaths(argv: readonly string[]): string[] {
  if (argv[0] === '--dir' && argv[1] !== undefined) {
    const dir = argv[1];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(dir, name));
  }
  if (argv.length === 0) throw new Error('usage: eslint-crosscheck <change.json>... | --dir <dir>');
  return [...argv];
}

function main(argv: readonly string[]): number {
  const strip = stripper();
  const linter = new Linter({ configType: 'flat' });
  const rows: CrosscheckRow[] = [];
  const skips: CrosscheckSkip[] = [];
  const eslintOnly: { path: string; side: Side; line: number }[] = [];
  for (const path of inputPaths(argv)) {
    const change: unknown = JSON.parse(readFileSync(path, 'utf8'));
    assertAcceptable(change);
    const result = crosscheckChange(change, linter, strip);
    rows.push(...result.rows);
    skips.push(...result.skips);
    eslintOnly.push(...result.eslintOnly);
  }
  const count = (s: CrosscheckRow['status']): number => rows.filter((r) => r.status === s).length;
  const out: string[] = [
    '# ESLint complexity cross-check (m1)',
    '',
    `functions: ${rows.length}; agree: ${count('agree')}; disagree: ${count('disagree')}; unmatched: ${count('unmatched')}; ` +
      `sides not cross-checked: ${skips.length}; ESLint-only units: ${eslintOnly.length}`,
    '',
    '| change | path | side | key | m1 | eslint (folded) | status |',
    '|---|---|---|---|---|---|---|',
    ...rows
      .filter((r) => r.status !== 'agree')
      .map((r) => `| ${r.changeId} | ${r.path} | ${r.side} | \`${r.key}\` | ${r.m1} | ${r.eslint ?? '—'} | ${r.status} |`),
    '',
    '## Not cross-checked',
    '',
    ...skips.map((s) => `- ${s.changeId} ${s.path} (${s.side}): ${s.reason}`),
    '',
    '## ESLint units without an m1 function head on the same line',
    '',
    ...eslintOnly.map((e) => `- ${e.path} (${e.side}) line ${e.line}`),
  ];
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && entry.replace(/\\/g, '/').endsWith('scripts/eslint-crosscheck.ts')) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
