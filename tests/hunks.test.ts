// plan 6.2 / D15 / D34 / docs/ATOMS.md sections 3-5: hunk coordinates and ids. Never run in Dirty Mode.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normaliseText } from '../src/core/change';
import { hunkIdOf } from '../src/core/hash';
import { computeFileHunks, hunkCoordinates, lineParts } from '../src/core/hunks';

const coords = (base: string | null, head: string | null) =>
  hunkCoordinates(lineParts(normaliseText(base), normaliseText(head)));

describe('normalisation (docs/ATOMS.md section 3)', () => {
  it('CRLF -> LF, CR -> LF, final LF appended, null/empty -> no lines', () => {
    expect(normaliseText('a\r\nb\rc')).toBe('a\nb\nc\n');
    expect(normaliseText('a\n')).toBe('a\n');
    expect(normaliseText('')).toBe('');
    expect(normaliseText(null)).toBe('');
  });
});

describe('hunk coordinates (unified-diff convention)', () => {
  it('pure insertion at file start: baseStart 0', () => {
    expect(coords('b\nc\n', 'a\nb\nc\n')).toEqual([{ baseStart: 0, baseCount: 0, headStart: 1, headCount: 1 }]);
  });

  it('pure insertion after base line n: baseStart n', () => {
    expect(coords('a\nb\nc\n', 'a\nb\nX\nY\nc\n')).toEqual([{ baseStart: 2, baseCount: 0, headStart: 3, headCount: 2 }]);
  });

  it('pure deletion: headStart = head line after which it sits', () => {
    expect(coords('a\nb\nc\nd\n', 'a\nd\n')).toEqual([{ baseStart: 2, baseCount: 2, headStart: 1, headCount: 0 }]);
  });

  it('replacement block and two separate hunks', () => {
    expect(coords('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\nE\nF\n')).toEqual([
      { baseStart: 2, baseCount: 1, headStart: 2, headCount: 1 },
      { baseStart: 5, baseCount: 1, headStart: 5, headCount: 2 },
    ]);
  });

  it('added file (0, 0, 1, n) and deleted file (1, n, 0, 0)', () => {
    expect(coords(null, 'a\nb\n')).toEqual([{ baseStart: 0, baseCount: 0, headStart: 1, headCount: 2 }]);
    expect(coords('a\nb\nc\n', null)).toEqual([{ baseStart: 1, baseCount: 3, headStart: 0, headCount: 0 }]);
  });

  it('identical normalised texts give no hunk', () => {
    expect(coords('a\r\nb', 'a\nb\n')).toEqual([]);
  });
});

describe('hunk ids (docs/ATOMS.md section 5)', () => {
  it('equal sha256 of `changeId|path|baseStart|baseCount|headStart|headCount`', () => {
    const expected = createHash('sha256').update('c1|src/a.ts|2|0|3|2').digest('hex');
    expect(hunkIdOf('c1', 'src/a.ts', 2, 0, 3, 2)).toBe(expected);
  });

  it('reproduces the ENGINEERING-WORKSHEET prefixes (computed with sha256sum)', () => {
    expect(hunkIdOf('ws-1', 'a.ts', 5, 2, 5, 3).startsWith('6379257e')).toBe(true);
    expect(hunkIdOf('ws-1', 'a.ts', 12, 0, 14, 2).startsWith('fd1bbf1d')).toBe(true);
    expect(hunkIdOf('ws-4', 'd.ts', 10, 3, 12, 0).startsWith('cea9ea8d')).toBe(true);
  });

  it('computeFileHunks attaches ids, role and atoms', () => {
    const [h] = computeFileHunks('c1', 'src/a.ts', 'production', 'a\nb\n', 'a\nX\nb\n');
    expect(h).toMatchObject({ path: 'src/a.ts', role: 'production', baseStart: 1, baseCount: 0, headStart: 2, headCount: 1 });
    expect(h?.id).toBe(hunkIdOf('c1', 'src/a.ts', 1, 0, 2, 1));
    expect(h?.atoms).toEqual([{ path: 'src/a.ts', side: 'head', line: 2 }]);
  });
});
