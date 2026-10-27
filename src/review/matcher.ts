import type { Atom } from '../core/types';
import type { ReviewComment } from './port';

export interface MatchTarget { id: string; requiredAtoms: Atom[] }
export interface LocalizationMatches { hits: string[]; duplicates: number[]; unmatched: number[]; invalid: number[] }
/** Localization only: one hit per target; path and side must agree. A reported span may cover at most ten lines. */
export function matchComments(comments: ReviewComment[], targets: MatchTarget[]): LocalizationMatches {
  if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error('Duplicate target id');
  const hit = new Set<string>();
  const result: LocalizationMatches = { hits: [], duplicates: [], unmatched: [], invalid: [] };
  comments.forEach((c, index) => {
    if (!Number.isSafeInteger(c.startLine) || !Number.isSafeInteger(c.endLine) || c.startLine < 1 ||
      c.endLine < c.startLine || c.endLine - c.startLine + 1 > 10 || !['base', 'head'].includes(c.side)) {
      result.invalid.push(index); return;
    }
    const matches = targets.filter(t => t.requiredAtoms.some(a => a.path === c.path && a.side === c.side &&
      c.endLine >= Math.max(1, a.line - 2) && c.startLine <= a.line + 2));
    if (matches.length === 0) { result.unmatched.push(index); return; }
    const fresh = matches.filter(t => !hit.has(t.id));
    if (fresh.length === 0) result.duplicates.push(index);
    fresh.forEach(t => { hit.add(t.id); result.hits.push(t.id); });
  });
  return result;
}
