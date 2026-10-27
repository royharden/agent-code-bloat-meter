// plan 6.3 Function map / docs/METRICS.md section 3. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import { normaliseText } from '../src/core/change';
import { parseSide } from '../src/core/parse';
import type { ChangeV1, FunctionRecord } from '../src/core/types';
import { collectSideFunctions } from '../src/diffmetrics/functions';
import { analyze } from '../src/diffmetrics/index';

function sideMap(text: string, path = 'src/m.ts') {
  const parsed = parseSide(path, 'head', path.endsWith('.tsx') ? 'tsx' : 'ts', normaliseText(text));
  expect(parsed.failed).toBe(false);
  return collectSideFunctions(parsed.sourceFile, path, 'head');
}

function keys(text: string): (string | null)[] {
  return sideMap(text).functions.map((f) => f.key);
}

function record(input: ChangeV1, key: string): FunctionRecord {
  const r = analyze(input).functions.find((f) => f.key === key);
  if (r === undefined) throw new Error(`no record ${key}`);
  return r;
}

describe('names and keys', () => {
  it('declarations, methods, constructors and accessors', () => {
    const src = [
      'export function f() {}',
      'class C {',
      '  constructor() {}',
      '  m() {}',
      '  get v() { return 1; }',
      '  set v(x: number) {}',
      '  #p() {}',
      '}',
    ].join('\n');
    expect(keys(src)).toEqual([
      'src/m.ts#<top>',
      'src/m.ts#f',
      'src/m.ts#C/constructor',
      'src/m.ts#C/m',
      'src/m.ts#C/get:v',
      'src/m.ts#C/set:v',
      'src/m.ts#C/#p',
    ]);
    expect(sideMap(src).functions.find((f) => f.name === 'get:v')?.bareName).toBe('v');
  });

  it('function expressions and arrows take the name they directly initialise', () => {
    const src = [
      'const a = () => 1;',
      'const o = { b: () => 2, c: function () {}, d() {} };',
      'class K { e = () => 3; }',
      'const g = function named() {};',
      '({ h = () => 4 } = {} as { h?: () => number });', // shorthand property initialiser (assignment pattern)
      'call(function own() {});',
      'call(() => 5);',
    ].join('\n');
    expect(keys(src)).toEqual([
      'src/m.ts#<top>',
      'src/m.ts#a',
      'src/m.ts#o/b',
      'src/m.ts#o/c',
      'src/m.ts#o/d',
      'src/m.ts#K/e',
      'src/m.ts#g',
      'src/m.ts#h',
      'src/m.ts#own',
      null,
    ]);
  });

  it('chains: classes, named functions, named object literals and namespaces; anonymous parents skipped', () => {
    const src = [
      'namespace N { export function inner() { const helper = () => 0; return helper; } }',
      'const A = class { run() {} };',
      'call(() => { function deep() {} });',
      'function outer() { return { m() {} }; }',
    ].join('\n');
    expect(keys(src)).toEqual([
      'src/m.ts#<top>',
      'src/m.ts#N/inner',
      'src/m.ts#N/inner/helper',
      'src/m.ts#A/run',
      null,
      'src/m.ts#deep',
      'src/m.ts#outer',
      'src/m.ts#outer/m',
    ]);
  });

  it('computed names other than string/numeric literals are anonymous; literal ones are named', () => {
    const src = ["const o = { ['x']() {}, [k]() {}, 'y-z': () => 1, 2: () => 2 };"].join('\n');
    expect(keys(src)).toEqual(['src/m.ts#<top>', 'src/m.ts#o/x', null, 'src/m.ts#o/y-z', 'src/m.ts#o/2']);
  });

  it('overloads and bodiless members are ignored', () => {
    const src = [
      'export function f(a: string): void;',
      'export function f(a: number): void;',
      'export function f(a: unknown): void {}',
      'abstract class B { abstract m(): void; }',
      'declare function d(): void;',
    ].join('\n');
    expect(keys(src)).toEqual(['src/m.ts#<top>', 'src/m.ts#f']);
  });
});

describe('<top>', () => {
  it('excludes named function, class and all-function variable statements', () => {
    const src = [
      "import { x } from './x';", // 1 top
      'export interface I { a: number }', // 2 top
      'export function f() {}', // 3 excluded
      'class C {}', // 4 excluded
      'const g = () => 1, h = function () {};', // 5 excluded
      'const v = 1, w = () => 2;', // 6 top (not all functions)
      'if (x) { run(); }', // 7 top
      'export default () => 0;', // 8 top
    ].join('\n');
    const top = sideMap(src).top;
    expect([...top.topLines].sort((a, b) => a - b)).toEqual([1, 2, 6, 7, 8]);
    // statements: const v (1) + if (1) + run() (1) + folded expression-bodied default arrow (1); imports/interface not counted
    expect(top.statements).toBe(4);
    // cyclomatic: 1 + if
    expect(top.cyclomatic).toBe(2);
  });
});

describe('classes and change status', () => {
  const input: ChangeV1 = {
    schema: 's45.change/1',
    id: 'fn-classes',
    files: [
      {
        path: 'src/a.ts',
        base: 'export function kept() {\n  return 1;\n}\nexport function gone() {\n  return 2;\n}\n',
        head: 'export function kept() {\n  return 3;\n}\nexport function fresh() {\n  return 4;\n}\n',
      },
      {
        path: 'src/dup.ts',
        base: 'function f() {}\n',
        head: 'function f() {}\nfunction f() { return 1; }\n',
      },
    ],
  };

  it('matched / new / deleted with modified / added change kinds', () => {
    expect(record(input, 'src/a.ts#kept')).toMatchObject({ class: 'matched', changed: true, changeKind: 'modified' });
    expect(record(input, 'src/a.ts#fresh')).toMatchObject({ class: 'new', changed: true, changeKind: 'added' });
    expect(record(input, 'src/a.ts#gone')).toMatchObject({ class: 'deleted', changed: true, changeKind: null });
  });

  it('a duplicate key on a side is ambiguous and makes touching production hunks manual', () => {
    const a = analyze(input);
    const dup = a.functions.filter((f) => f.path === 'src/dup.ts' && f.key === 'src/dup.ts#f');
    expect(dup.length).toBe(3);
    expect(dup.every((f) => f.class === 'ambiguous')).toBe(true);
    const hunk = a.hunks.find((h) => h.path === 'src/dup.ts');
    const m = a.metrics.find((x) => x.hunkId === hunk?.id);
    expect(m).toMatchObject({ manual: true, manualReasons: ['ambiguous_function'] });
    expect(a.issues.map((i) => i.code)).toContain('ambiguous_function');
  });

  it('a parse failure on either side makes every hunk of the file manual (D35)', () => {
    const a = analyze({
      schema: 's45.change/1',
      id: 'fn-parse',
      files: [{ path: 'src/p.ts', base: 'const a = 1;\n', head: 'const a = ;\n' }],
    });
    expect(a.files[0]?.headParseFailed).toBe(true);
    expect(a.metrics[0]).toMatchObject({ manual: true, manualReasons: ['parse_failure'] });
    expect(a.metrics[0]?.maxPositiveDelta.value).toBe('unknown');
  });

  it('ambiguity never makes a test hunk manual', () => {
    const a = analyze({
      schema: 's45.change/1',
      id: 'fn-test-dup',
      files: [{ path: 'src/a.test.ts', base: null, head: 'function f() {}\nfunction f() {}\n' }],
    });
    expect(a.metrics[0]?.manual).toBe(false);
  });
});
