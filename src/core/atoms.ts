// plan 6.2 / docs/ATOMS.md section 6: atoms and per-hunk line sets. Within a hunk, base (deletion) atoms come first in
// ascending line order, then head (addition) atoms in ascending line order. Reading order and budgets are M4
// (src/orderings/slicer.ts). Pure: no filesystem, no network.
import type { Atom, Hunk } from './types';

/** The atoms of one hunk from its unified-diff coordinates. */
export function hunkAtoms(
  path: string,
  baseStart: number,
  baseCount: number,
  headStart: number,
  headCount: number,
): Atom[] {
  const atoms: Atom[] = [];
  for (let i = 0; i < baseCount; i++) atoms.push({ path, side: 'base', line: baseStart + i });
  for (let i = 0; i < headCount; i++) atoms.push({ path, side: 'head', line: headStart + i });
  return atoms;
}

/** Stable string key of an atom (for sets and lookups). */
export function atomKey(atom: Atom): string {
  return `${atom.side}:${atom.line}:${atom.path}`;
}

/** Changed line numbers of one hunk (or one file), per side. */
export interface SideLines {
  base: Set<number>;
  head: Set<number>;
}

export function emptySideLines(): SideLines {
  return { base: new Set<number>(), head: new Set<number>() };
}

/** Line sets of one hunk's atoms. */
export function hunkLineSets(hunk: Hunk): SideLines {
  const lines = emptySideLines();
  for (const atom of hunk.atoms) lines[atom.side].add(atom.line);
  return lines;
}

/** Changed line sets per path, over all hunks of a change. */
export function fileLineSets(hunks: readonly Hunk[]): Map<string, SideLines> {
  const byPath = new Map<string, SideLines>();
  for (const hunk of hunks) {
    let lines = byPath.get(hunk.path);
    if (lines === undefined) {
      lines = emptySideLines();
      byPath.set(hunk.path, lines);
    }
    for (const atom of hunk.atoms) lines[atom.side].add(atom.line);
  }
  return byPath;
}

/** Atom totals of a change: L, and per side. */
export function atomTotals(hunks: readonly Hunk[]): { atoms: number; baseAtoms: number; headAtoms: number } {
  let baseAtoms = 0;
  let headAtoms = 0;
  for (const hunk of hunks) {
    baseAtoms += hunk.baseCount;
    headAtoms += hunk.headCount;
  }
  return { atoms: baseAtoms + headAtoms, baseAtoms, headAtoms };
}

/** True when any line of `lines` lies within [startLine, endLine] (inclusive). */
export function linesHitRange(lines: ReadonlySet<number>, startLine: number, endLine: number): boolean {
  for (const line of lines) {
    if (line >= startLine && line <= endLine) return true;
  }
  return false;
}

/** True when the two sets share a line (iterates the smaller set). */
export function linesIntersect(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const line of small) {
    if (large.has(line)) return true;
  }
  return false;
}
