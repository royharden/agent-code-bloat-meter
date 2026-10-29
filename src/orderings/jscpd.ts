import type { BaselineContext, BaselineOrdering, BaselineReceipt } from './sarif';
import { validateBaselineReceipt, orderByBaselineCounts, mappedPath } from './sarif';

function segments(raw: string, mapping: Record<string, string>): { path: string; start: number; end: number }[] {
  const doc = JSON.parse(raw);
  if (!Array.isArray(doc.duplicates)) throw new Error('Expected jscpd JSON duplicates array');
  return doc.duplicates.flatMap((duplicate: { firstFile?: unknown; secondFile?: unknown }) =>
    [duplicate.firstFile, duplicate.secondFile].map(part => {
      const p = part as { name?: string; start?: number; end?: number } | undefined;
      const path = mappedPath(mapping, p?.name);
      if (!path || !Number.isSafeInteger(p?.start) || !Number.isSafeInteger(p?.end) || (p?.start ?? 0) < 1 ||
        (p?.end ?? 0) < (p?.start ?? 0)) throw new Error('Unmapped jscpd segment');
      return { path, start: p!.start!, end: p!.end! };
    }));
}
export function jscpdOrdering(context: BaselineContext, capture?: { base: string; head: string; receipt: BaselineReceipt }): BaselineOrdering {
  if (!capture) return { status: 'not captured', note: 'jscpd 4.3.0 Normal-mode probe pending', hunks: [] };
  try {
    validateBaselineReceipt('jscpd', capture.receipt, capture.base, capture.head, context);
    segments(capture.base, context.mapping); // Both sides must be valid captures of the bound source trees.
    const clones = segments(capture.head, context.mapping);
    const counts = new Map(context.analysis.hunks.map(h => [h.id, h.atoms.filter(a => a.side === 'head' &&
      clones.some(c => c.path === a.path && a.line >= c.start && a.line <= c.end)).length]));
    return { status: 'captured', note: 'Distinct duplicated added atoms; not the in-repo token metric', hunks: orderByBaselineCounts(context, counts) };
  } catch (error) { return { status: 'invalid capture', note: error instanceof Error ? error.message : 'Invalid jscpd', hunks: [] }; }
}
