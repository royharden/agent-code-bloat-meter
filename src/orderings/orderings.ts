import type { AnalysisV1, Hunk, HunkMetrics } from '../core/types';
import { assignTier, tierGroup } from '../policy/policy';
import type { Policy } from '../policy/policy';
import { compareText, tieKey } from '../policy/tiekey';
import { shuffled, changeRandomSeed } from '../stats/prng';
export type Ordering = 'tier-policy' | 'size-desc' | 'size-asc' | 'file-type' | 'complexity-only' | 'clone-first' | 'random';
export const PREDICTIVE_ORDERINGS: readonly Ordering[] = ['tier-policy', 'size-desc', 'size-asc', 'file-type', 'complexity-only', 'clone-first', 'random'];
export function orderHunks(analysis: AnalysisV1, ordering: Ordering, policy: Policy, randomSeed = 4500): Hunk[] {
  const byId = new Map(analysis.metrics.map(m => [m.hunkId, m]));
  const metric = (h: Hunk): HunkMetrics => { const m = byId.get(h.id); if (!m) throw new Error('Missing hunk metrics'); return m; };
  const tie = (a: Hunk, b: Hunk) => compareText(tieKey(analysis.changeId, a.id), tieKey(analysis.changeId, b.id)) || compareText(a.id, b.id);
  const number = (x: number | 'unknown') => typeof x === 'number' ? x : 0;
  const fileType = (h: Hunk) => h.role === 'test' ? 2 : h.role === 'config' ? 3 : h.path.endsWith('.tsx') ? 0 : 1;
  const sorted = [...analysis.hunks].sort(tie);
  if (ordering === 'random') return shuffled(sorted, changeRandomSeed(randomSeed, analysis.changeId));
  return sorted.sort((a, b) => {
    let delta = 0;
    switch (ordering) {
      case 'tier-policy': delta = tierGroup(assignTier(metric(b), policy)) - tierGroup(assignTier(metric(a), policy)); break;
      case 'size-asc': delta = a.atoms.length - b.atoms.length; break;
      case 'size-desc': delta = b.atoms.length - a.atoms.length; break;
      case 'file-type': delta = fileType(a) - fileType(b); break;
      case 'complexity-only': delta = number(metric(b).maxPositiveDelta.value) - number(metric(a).maxPositiveDelta.value); break;
      case 'clone-first': delta = number(metric(b).duplicatedAddedAtoms.value) - number(metric(a).duplicatedAddedAtoms.value); break;
    }
    return delta || tie(a, b);
  });
}
