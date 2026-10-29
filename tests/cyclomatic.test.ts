// plan 6.3 Cyclomatic / docs/METRICS.md sections 4-6. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import { normaliseText } from '../src/core/change';
import { parseSide } from '../src/core/parse';
import type { ChangeV1 } from '../src/core/types';
import { collectSideFunctions } from '../src/diffmetrics/functions';
import { analyze } from '../src/diffmetrics/index';

function fn(text: string, name: string, path = 'src/m.ts') {
  const parsed = parseSide(path, 'head', path.endsWith('.tsx') ? 'tsx' : 'ts', normaliseText(text));
  expect(parsed.failed).toBe(false);
  const found = collectSideFunctions(parsed.sourceFile, path, 'head').functions.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no function ${name}`);
  return found;
}

describe('decision points', () => {
  it('counts each listed construct once', () => {
    const src = `function f(a: any, b: any) {
  if (a) {} else if (b) {}
  for (let i = 0; i < 1; i++) {}
  for (const k in a) {}
  for (const v of b) {}
  while (a) {}
  do {} while (b);
  const c = a ? 1 : 2;
  switch (a) { case 1: break; case 2: break; default: break; }
  try {} catch {}
  const d = (a && b) || (c ?? 0);
  a &&= b; a ||= b; a ??= b;
}`;
    // 1 + if + else-if + for + for-in + for-of + while + do + ?: + 2 cases + catch + && + || + ?? + &&= + ||= + ??=
    expect(fn(src, 'f').cyclomatic).toBe(1 + 2 + 5 + 1 + 2 + 1 + 3 + 3);
  });

  it('optional chaining, default values, destructuring defaults, else and default: add nothing', () => {
    const src = `function g(a = 1, { b = 2 } = {}) {
  const c = a?.toString?.();
  switch (a) { default: break; }
  if (c) {} else {}
  return b;
}`;
    expect(fn(src, 'g').cyclomatic).toBe(2);
  });

  it('TSX markup adds nothing; conditional rendering operators count', () => {
    const src = 'export function V({ x }: { x?: number }) {\n  return <div>{x && <b>{x > 1 ? "a" : "b"}</b>}</div>;\n}\n';
    expect(fn(src, 'V', 'src/v.tsx').cyclomatic).toBe(3);
  });

  it('anonymous functions fold into the nearest named function: .map(x => x > 0 ? a : b) adds +1, not +2', () => {
    const src = 'function f(xs: number[]) {\n  return xs.map((x) => (x > 0 ? 1 : 2));\n}\n';
    const f = fn(src, 'f');
    expect(f.cyclomatic).toBe(2);
    // return + the folded expression-bodied arrow
    expect(f.statements).toBe(2);
  });

  it('nested named functions count only in themselves', () => {
    const src = 'function outer(a: boolean) {\n  function inner(b: boolean) { if (b) return 1; return 0; }\n  if (a) return inner(a);\n  return 0;\n}\n';
    expect(fn(src, 'outer').cyclomatic).toBe(2);
    expect(fn(src, 'inner').cyclomatic).toBe(2);
    // outer: if, return, return (inner declaration and its body not counted)
    expect(fn(src, 'outer').statements).toBe(3);
  });

  it('class field initialisers count in no function', () => {
    const src = 'function f(a: any) {\n  class K { v = a ?? 1; m() { return a || 2; } }\n  return K;\n}\n';
    expect(fn(src, 'f').cyclomatic).toBe(1);
    expect(fn(src, 'm').cyclomatic).toBe(2);
  });
});

describe('statement count kinds', () => {
  it('counts the listed kinds recursively, not blocks, empty statements or declarations', () => {
    const src = `function s(a: any) {
  let x = 0;
  ;
  {
    x++;
  }
  label: for (;;) { break label; }
  try { throw new Error(); } catch { debugger; } finally { x--; }
  switch (a) { case 1: x = 1; break; default: continue_(); }
  while (a) { continue; }
  do { x += 1; } while (false);
  type T = number;
  interface I { a: T }
  return x;
}
function continue_() {}`;
    // let, x++, labelled, for, break, try, throw, debugger, x--, switch, x = 1, break, continue_(), while, continue,
    // do, x += 1, return
    expect(fn(src, 's').statements).toBe(18);
  });
});

describe('deltas and maxPositiveDelta', () => {
  const input: ChangeV1 = {
    schema: 's45.change/1',
    id: 'cyc-delta',
    files: [
      {
        path: 'src/a.ts',
        base: 'export function m(a: number) {\n  return a;\n}\n',
        head: 'export function m(a: number) {\n  if (a > 1) return 1;\n  return a > 0 ? a : 0;\n}\nexport function n(b: boolean) {\n  return b && !b;\n}\n',
      },
      {
        path: 'src/a.test.ts',
        base: null,
        head: "import { it } from 'vitest';\nit('x', () => { if (1) { if (2) { if (3) { if (4) {} } } } });\n",
      },
    ],
  };

  it('matched head - base, new head - 1; test files never contribute', () => {
    const a = analyze(input);
    expect(a.functions.find((f) => f.key === 'src/a.ts#m')?.cyclomaticDelta.value).toBe(2);
    expect(a.functions.find((f) => f.key === 'src/a.ts#n')?.cyclomaticDelta.value).toBe(1);
    const prodHunks = a.hunks.filter((h) => h.path === 'src/a.ts');
    const values = prodHunks.map((h) => a.metrics.find((m) => m.hunkId === h.id)?.maxPositiveDelta.value);
    expect(Math.max(...(values as number[]))).toBe(2);
    const testHunk = a.hunks.find((h) => h.path === 'src/a.test.ts');
    expect(a.metrics.find((m) => m.hunkId === testHunk?.id)?.maxPositiveDelta.value).toBe(0);
  });
});
