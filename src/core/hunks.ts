// plan 6.2 / D15 / D34: hunks from the pinned `diff` package (`diffLines`, default options) on LF-normalised text.
// Rules: docs/ATOMS.md sections 4-5. Pure: no filesystem, no network.
import { diffLines } from 'diff';
import { hunkAtoms } from './atoms';
import { countLineFeeds } from './change';
import { hunkIdOf } from './hash';
import type { FileRole, Hunk } from './types';

export type LinePartKind = 'same' | 'removed' | 'added';

/** One part of the line diff with its line count (number of LF characters in the part's value). */
export interface LinePart {
  kind: LinePartKind;
  lines: number;
}

/**
 * docs/ATOMS.md section 4: `diffLines(baseLF, headLF)` with no options argument. Identical texts and empty sides
 * are answered without calling the library; they have exactly one possible diff, which equals the library's.
 */
export function lineParts(baseLF: string, headLF: string): LinePart[] {
  if (baseLF === headLF) return baseLF === '' ? [] : [{ kind: 'same', lines: countLineFeeds(baseLF) }];
  if (baseLF === '') return [{ kind: 'added', lines: countLineFeeds(headLF) }];
  if (headLF === '') return [{ kind: 'removed', lines: countLineFeeds(baseLF) }];
  const parts: LinePart[] = [];
  for (const part of diffLines(baseLF, headLF)) {
    const lines = countLineFeeds(part.value);
    if (lines === 0) continue;
    parts.push({ kind: part.added ? 'added' : part.removed ? 'removed' : 'same', lines });
  }
  return parts;
}

/** Unified-diff coordinates of one hunk. */
export interface HunkCoordinates {
  baseStart: number;
  baseCount: number;
  headStart: number;
  headCount: number;
}

/**
 * docs/ATOMS.md section 5: a hunk is a maximal run of removed/added parts with no unchanged part inside (zero
 * context). baseStart = b0 + 1 when baseCount > 0, else b0 (the base line after which an insertion sits); headStart
 * likewise. The order of removed and added parts inside a run does not change the coordinates.
 */
export function hunkCoordinates(parts: readonly LinePart[]): HunkCoordinates[] {
  const out: HunkCoordinates[] = [];
  let b = 0;
  let h = 0;
  let run: { b0: number; h0: number; removed: number; added: number } | null = null;
  const flush = (): void => {
    if (run !== null && run.removed + run.added > 0) {
      out.push({
        baseStart: run.removed > 0 ? run.b0 + 1 : run.b0,
        baseCount: run.removed,
        headStart: run.added > 0 ? run.h0 + 1 : run.h0,
        headCount: run.added,
      });
    }
    run = null;
  };
  for (const part of parts) {
    if (part.kind === 'same') {
      flush();
      b += part.lines;
      h += part.lines;
      continue;
    }
    if (run === null) run = { b0: b, h0: h, removed: 0, added: 0 };
    if (part.kind === 'removed') {
      run.removed += part.lines;
      b += part.lines;
    } else {
      run.added += part.lines;
      h += part.lines;
    }
  }
  flush();
  return out;
}

/** All hunks of one file, in file order, with ids (docs/ATOMS.md section 5) and atoms (section 6). */
export function computeFileHunks(
  changeId: string,
  path: string,
  role: FileRole,
  baseLF: string,
  headLF: string,
): Hunk[] {
  return hunkCoordinates(lineParts(baseLF, headLF)).map((c) => ({
    id: hunkIdOf(changeId, path, c.baseStart, c.baseCount, c.headStart, c.headCount),
    path,
    role,
    baseStart: c.baseStart,
    baseCount: c.baseCount,
    headStart: c.headStart,
    headCount: c.headCount,
    atoms: hunkAtoms(path, c.baseStart, c.baseCount, c.headStart, c.headCount),
  }));
}
