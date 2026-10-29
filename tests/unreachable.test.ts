// D14 immediate adjacency regressions. Engineering inputs only; written, never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import { parseSide } from '../src/core/parse';
import { findUnreachableStatements, unreachableHit } from '../src/diffmetrics/unreachable';

function spans(text: string) {
  return findUnreachableStatements(parseSide('a.ts', 'head', 'ts', text).sourceFile, 'a.ts');
}

describe('D14 direct statement-list adjacency', () => {
  it('counts only the direct successor, not the entire tail after an exit', () => {
    const found = spans('function f() {\n return;\n a();\n b();\n}');
    expect(found).toEqual([{ path: 'a.ts', side: 'head', startLine: 3, endLine: 3 }]);
    expect(unreachableHit(found, new Set([4]))).toEqual([]);
  });

  it('each return/throw can supply adjacency, without crossing a block boundary', () => {
    expect(spans('function f() {\n throw 1;\n return;\n a();\n b();\n}\nc();').map((s) => s.startLine)).toEqual([3, 4]);
  });

  it.each(['function g() {}', 'class C {}', 'interface I {}', 'type T = number;', ';'])(
    'exempts %s without carrying exit adjacency through it',
    (declaration) => {
      expect(spans(`function f() {\n return;\n ${declaration}\n a();\n}`)).toEqual([]);
    },
  );

  it('handles case/default statement lists independently', () => {
    expect(spans('function f(x: number) { switch(x) {\n case 1: return;\n a();\n b();\n default: throw 1;\n c();\n d();\n }}').map((s) => s.startLine)).toEqual([3, 6]);
  });
});
