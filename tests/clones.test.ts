// plan D13 / docs/METRICS.md section 9: in-repo token clone scanner. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import { normaliseText } from '../src/core/change';
import { parseSide } from '../src/core/parse';
import type { ChangeV1 } from '../src/core/types';
import { CLONE_MIN_TOKENS, findClonePairs, leafTokens } from '../src/diffmetrics/clones';
import { analyze } from '../src/diffmetrics/index';

/** A 5-line function body of well over 40 normalised tokens. */
function body(name: string, a: string, b: string): string {
  return [
    `export function ${name}(${a}: number[], ${b}: number): number {`,
    `  let total = 0;`,
    `  for (const value of ${a}) { if (value > ${b}) { total += value * 2; } else { total -= 1; } }`,
    `  const scaled = total / (${a}.length + 1);`,
    `  return Math.round(scaled * 100) / 100 + ${b};`,
    `}`,
  ].join('\n');
}

function tokens(text: string, path = 'src/x.ts') {
  return leafTokens(parseSide(path, 'head', 'ts', normaliseText(text)).sourceFile);
}

describe('normalised tokens', () => {
  it('identifiers -> ID, strings -> STR, numbers -> NUM; keywords keep their kind', () => {
    const a = tokens('const a = "x" + 1;').map((t) => t.id);
    const b = tokens("const zz = 'yy' + 42;").map((t) => t.id);
    expect(a).toEqual(b);
    expect(tokens('let a = 1;').map((t) => t.id)).not.toEqual(a);
  });
});

describe('clone pairs', () => {
  it('finds a renamed copy across files (>= 40 tokens, >= 3 lines)', () => {
    const pairs = findClonePairs([
      { path: 'src/a.ts', tokens: tokens(body('first', 'xs', 'limit'), 'src/a.ts') },
      { path: 'src/b.ts', tokens: tokens(body('second', 'items', 'cap'), 'src/b.ts') },
    ]);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.tokens).toBeGreaterThanOrEqual(CLONE_MIN_TOKENS);
    expect(pairs[0]?.a).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 6 });
    expect(pairs[0]?.b).toMatchObject({ path: 'src/b.ts', startLine: 1, endLine: 6 });
  });

  it('ignores short duplicates and single-line duplicates', () => {
    const short = 'export const f = (a: number) => a + 1;\n';
    expect(findClonePairs([{ path: 'a.ts', tokens: tokens(short + short.replace('f', 'g')) }])).toEqual([]);
    const oneLine = body('one', 'xs', 'k').replace(/\n/g, ' ');
    expect(
      findClonePairs([{ path: 'a.ts', tokens: tokens(`${oneLine}\n${oneLine.replace('one', 'two')}\n`) }]),
    ).toEqual([]);
  });

  it('occurrences within one file never overlap', () => {
    const text = `${body('p', 'xs', 'k')}\n${body('q', 'ys', 'm')}\n${body('r', 'zs', 'n')}\n`;
    const pairs = findClonePairs([{ path: 'a.ts', tokens: tokens(text) }]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect(p.a.endLine < p.b.startLine || p.b.endLine < p.a.startLine).toBe(true);
    // Periodic repeats: the third copy (lines 13-18) is covered too, not only the first pair.
    const covered = new Set<number>();
    for (const p of pairs) for (const o of [p.a, p.b]) for (let l = o.startLine; l <= o.endLine; l++) covered.add(l);
    for (let line = 1; line <= 18; line++) expect(covered.has(line)).toBe(true);
  });
});

describe('duplicatedAddedAtoms per hunk', () => {
  it('counts added atoms covered by a clone occurrence; base atoms never count', () => {
    const input: ChangeV1 = {
      schema: 's45.change/1',
      id: 'clones',
      files: [
        { path: 'src/a.ts', base: body('first', 'xs', 'limit'), head: body('first', 'xs', 'limit') },
        { path: 'src/b.ts', base: null, head: body('second', 'items', 'cap') },
      ],
    };
    const a = analyze(input);
    expect(a.metrics.length).toBe(1);
    expect(a.metrics[0]?.duplicatedAddedAtoms.value).toBe(6);
    expect(a.metrics[0]?.duplicatedAddedAtoms.spans).toEqual([
      { path: 'src/a.ts', side: 'head', startLine: 1, endLine: 6 },
    ]);
  });
});
