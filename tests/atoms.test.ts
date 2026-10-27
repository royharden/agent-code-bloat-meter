// plan 6.2 / docs/ATOMS.md section 6: atom order and totals. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import { atomTotals, fileLineSets, hunkAtoms, hunkLineSets, linesHitRange } from '../src/core/atoms';
import { computeFileHunks } from '../src/core/hunks';

describe('atoms', () => {
  it('base atoms first, then head atoms, each ascending', () => {
    expect(hunkAtoms('a.ts', 4, 2, 5, 3)).toEqual([
      { path: 'a.ts', side: 'base', line: 4 },
      { path: 'a.ts', side: 'base', line: 5 },
      { path: 'a.ts', side: 'head', line: 5 },
      { path: 'a.ts', side: 'head', line: 6 },
      { path: 'a.ts', side: 'head', line: 7 },
    ]);
  });

  it('a pure insertion has only head atoms and a pure deletion only base atoms', () => {
    expect(hunkAtoms('a.ts', 2, 0, 3, 1)).toEqual([{ path: 'a.ts', side: 'head', line: 3 }]);
    expect(hunkAtoms('a.ts', 3, 1, 2, 0)).toEqual([{ path: 'a.ts', side: 'base', line: 3 }]);
  });

  it('L counts added plus deleted lines over all hunks', () => {
    const hunks = [
      ...computeFileHunks('c', 'a.ts', 'production', 'a\nb\nc\n', 'a\nB\nc\nd\n'),
      ...computeFileHunks('c', 'b.ts', 'test', '', 'x\ny\n'),
    ];
    expect(atomTotals(hunks)).toEqual({ atoms: 5, baseAtoms: 1, headAtoms: 4 });
    const lines = fileLineSets(hunks).get('a.ts');
    expect([...(lines?.base ?? [])]).toEqual([2]);
    expect([...(lines?.head ?? [])].sort()).toEqual([2, 4]);
    expect([...hunkLineSets(hunks[0]!).head]).toEqual([2]);
  });

  it('range hits are inclusive', () => {
    expect(linesHitRange(new Set([5]), 5, 5)).toBe(true);
    expect(linesHitRange(new Set([4, 9]), 5, 8)).toBe(false);
  });
});
