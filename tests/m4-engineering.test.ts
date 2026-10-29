// Builder engineering cases only. No corpus, labels, witnesses or independent worksheet authored here.
import { describe, expect, it } from 'vitest';
import type { Atom, Hunk } from '../src/core/types';
import { allRequiredExposed, sliceHunks } from '../src/orderings/slicer';
import { wilson95 } from '../src/stats/wilson';
import { mulberry32, shuffled } from '../src/stats/prng';
import { percentileInterval, quantile7 } from '../src/stats/bootstrap';
const atom = (line: number, side: 'base' | 'head' = 'head'): Atom => ({ path: 'engineering.ts', side, line });
const hunk = (id: string, atoms: Atom[]): Hunk => ({ id, atoms, path: 'engineering.ts', role: 'production', baseStart: 0, baseCount: 0, headStart: 1, headCount: atoms.length });
describe('M4 engineering slicer', () => {
  it('uses integer budgets and requires both R-del-gap neighbours', () => {
    const hunks = [hunk('E', [10, 11, 12, 13, 14].map(n => atom(n))), hunk('F', [atom(20, 'base'), atom(25), atom(26)])];
    expect(sliceHunks(hunks, 10).selectedAtoms).toEqual([]);
    const read = sliceHunks(hunks, 30);
    expect(read.selectedAtoms).toEqual([atom(10), atom(11)]);
    expect(read.partialHunkIds).toEqual(['E']);
    expect(allRequiredExposed([atom(11), atom(12)], read.selectedAtoms)).toBe(false);
    expect(allRequiredExposed([atom(10)], sliceHunks(hunks, 20).selectedAtoms)).toBe(true);
  });
  it('strict whole-hunk prefix stops instead of skipping overflow', () => {
    expect(sliceHunks([hunk('big', [1, 2, 3, 4].map(n => atom(n))), hunk('small', [atom(8)])], 20, true).selectedAtoms).toEqual([]);
  });
  it('null exposure equals K/L at zero, rounding and full budget for each permutation', () => {
    const hs = [hunk('replace', [atom(2, 'base'), atom(3, 'base'), atom(2)]), hunk('insert', [atom(7), atom(8)])];
    for (const order of [hs, [...hs].reverse()]) for (const budget of [0, 10, 20, 30, 100]) {
      const read = sliceHunks(order, budget);
      const exposed = hs.flatMap(h => h.atoms).filter(a => allRequiredExposed([a], read.selectedAtoms)).length;
      expect(exposed / 5).toBe(Math.floor(budget * 5 / 100) / 5);
    }
  });
});
describe('M4 hand statistical answers (runtime unverified)', () => {
  it('Wilson 0/10, 5/10, 10/10 to four decimal places', () => {
    for (const [successes, low, high] of [[0, 0, .2775], [5, .2366, .7634], [10, .7225, 1]]) {
      const interval = wilson95(successes!, 10)!;
      expect(Number(interval.low.toFixed(4))).toBe(low);
      expect(Number(interval.high.toFixed(4))).toBe(high);
    }
    expect(wilson95(0, 0)).toBeNull();
  });
  it('enumerates all 27 draws of three one-defect roots', () => {
    const draws: number[] = [];
    for (const a of [0, 1, 1]) for (const b of [0, 1, 1]) for (const c of [0, 1, 1]) draws.push((a + b + c) / 3);
    // One zero draw, six 1/3 draws, twelve 2/3 draws, eight one draws.
    expect(draws.filter(x => x === 0)).toHaveLength(1);
    expect(draws.filter(x => x === 1 / 3)).toHaveLength(6);
    expect(percentileInterval(draws)!.low).toBeCloseTo(.21666666666666667);
    expect(percentileInterval(draws)!.high).toBe(1);
    expect(quantile7([0, 10], .25)).toBe(2.5);
    expect(percentileInterval([null, null, 1])).toBeNull();
  });
  it('mulberry32 seed-1 golden vector — independently unverified', () => {
    const next = mulberry32(1);
    expect([next(), next(), next()]).toEqual([2693262067, 11749833, 2265367787]);
    expect(shuffled([1, 2, 3], 45)).toEqual(shuffled([1, 2, 3], 45));
  });
});
