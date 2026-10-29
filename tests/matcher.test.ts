import { describe, expect, it } from 'vitest';
import { matchComments } from '../src/review/matcher';
const targets = [{ id: 'engineering-target', requiredAtoms: [{ path: 'x.ts', side: 'base' as const, line: 20 }] }];
describe('localization matching (engineering targets only)', () => {
  it('uses exact path and side with an inclusive two-line expansion and counts a defect once', () => {
    expect(matchComments([
      { path: 'x.ts', side: 'base', startLine: 18, endLine: 18 },
      { path: 'x.ts', side: 'base', startLine: 22, endLine: 22 },
      { path: 'x.ts', side: 'head', startLine: 20, endLine: 20 },
      { path: 'y.ts', side: 'base', startLine: 20, endLine: 20 },
      { path: 'x.ts', side: 'base', startLine: 23, endLine: 23 },
    ], targets)).toEqual({ hits: ['engineering-target'], duplicates: [1], unmatched: [2, 3, 4], invalid: [] });
  });
  it('accepts ten-line reports, refuses broader and malformed reports before matching', () => {
    expect(matchComments([
      { path: 'x.ts', side: 'base', startLine: 11, endLine: 20 },
      { path: 'x.ts', side: 'base', startLine: 10, endLine: 20 },
      { path: 'x.ts', side: 'base', startLine: 0, endLine: 20 },
      { path: 'x.ts', side: 'base', startLine: 20, endLine: 19 },
    ], targets)).toEqual({ hits: ['engineering-target'], duplicates: [], unmatched: [], invalid: [1, 2, 3] });
  });
});
