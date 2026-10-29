import type { Atom, Hunk } from '../core/types';
export function atomIdentity(a: Atom): string { return JSON.stringify([a.path, a.side, a.line]); }
export interface Slice { selectedAtoms: Atom[]; partialHunkIds: string[]; fullHunkIds: string[]; budgetAtoms: number; totalAtoms: number }
/** Strict whole-hunk mode stops at the first overflow, never skips ahead to a smaller hunk. */
export function sliceHunks(hunks: readonly Hunk[], percent: number, wholeHunk = false): Slice {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Budget must be an integer percent in [0,100]');
  if (new Set(hunks.map(h => h.id)).size !== hunks.length) throw new Error('Duplicate hunk in reading order');
  const totalAtoms = hunks.reduce((n, h) => n + h.atoms.length, 0), budgetAtoms = Math.floor(percent * totalAtoms / 100);
  const selectedAtoms: Atom[] = [], partialHunkIds: string[] = [], fullHunkIds: string[] = [];
  for (const hunk of hunks) {
    const available = budgetAtoms - selectedAtoms.length;
    if (available <= 0) break;
    if (hunk.atoms.length <= available) { selectedAtoms.push(...hunk.atoms); fullHunkIds.push(hunk.id); }
    else {
      if (!wholeHunk) { selectedAtoms.push(...hunk.atoms.slice(0, available)); partialHunkIds.push(hunk.id); }
      break;
    }
  }
  return { selectedAtoms, partialHunkIds, fullHunkIds, budgetAtoms, totalAtoms };
}
export function allRequiredExposed(required: readonly Atom[], selected: readonly Atom[]): boolean {
  if (required.length === 0) throw new Error('Defect must require at least one atom');
  const keys = new Set(selected.map(atomIdentity));
  return required.every(a => keys.has(atomIdentity(a)));
}
