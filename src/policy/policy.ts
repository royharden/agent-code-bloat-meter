import type { HunkMetrics, Tier } from '../core/types';
export interface Policy { id: string; T: number; N: number }
export const CANDIDATES: readonly Policy[] = [2, 4, 6].flatMap(T => [8, 12].map(N => ({ id: `T${T}-N${N}`, T, N })));
export function validatePolicy(policy: Policy): void {
  if (!CANDIDATES.some(p => p.id === policy.id && p.T === policy.T && p.N === policy.N)) throw new Error('Policy outside declared candidate space');
}
export function assignTier(m: HunkMetrics, policy: Policy): Tier {
  validatePolicy(policy);
  if (m.manual) return 'manual';
  if ((typeof m.maxPositiveDelta.value === 'number' && m.maxPositiveDelta.value >= policy.T)
    || m.catchMaySwallow.value === true
    || (typeof m.untestedChangedStatementMax.value === 'number' && m.untestedChangedStatementMax.value >= policy.N)) return 2;
  return m.t0aTriviaOnly || m.t0bTokenEqual || m.t0cImportReorder || m.t0dTestFile ? 0 : 1;
}
export function tierGroup(tier: Tier): number { return tier === 'manual' ? 2 : tier; }
